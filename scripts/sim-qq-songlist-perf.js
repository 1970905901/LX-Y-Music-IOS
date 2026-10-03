/**
 * sim-qq-songlist-perf.js
 *
 * QQ 歌单（cookie 登录）拉全 + 点歌卡顿契约（2026-10-03）。
 *
 * 用户反馈：cookie 登录 QQ 音乐后，点进 QQ 歌单列表卡顿；点列表里的歌「大概率没反应」，
 * 页面卡住连返回都困难；QQ「我喜欢」有 2000 首，平台设置里显示的数字对不上 2000。
 *
 * 实测（2026-10，QQ 公开歌单 1270 首，node fetch 直连）：
 *   - 分页接口 musicu.fcg（music.srfDissInfo.DissInfo / CgiGetDiss）song_num=100 正常分页，
 *     单页响应约 200KB，`total_song_num` 准确（1270）。
 *   - 旧详情接口 fcg_ucc_getcdinfo_byids_cp **忽略** num / song_begin / onlysong，一次返回
 *     整张歌单：约 1.9MB（1270 首）。老实现每翻一页都请求它一次。
 *
 * 四条根因与对应修复：
 *  ① 单页 30 首 + 每页一次 1.9MB 整单请求 → 2000 首 = 67 次请求 / 上百 MB 解析，
 *     JS 线程被占满（卡顿、点了没反应、返回迟钝）。修：100 首/页 + 歌单信息整单只请求一次
 *     （listMetaCache，TTL 10 分钟），并给 CgiGetDiss 的 total 加 meta.total 兜底。
 *  ② getListDetailAll 用 ceil(total/limit) 预计算总页数，平台单页给不满时提前停下
 *     → 2000 首只缓存到一部分（平台设置页数字对不上）。修：按**累计歌曲数**终止。
 *  ③ 点歌路径 await setTempList（等整张列表落盘）之后才 playList → 点了要等几百 ms~数秒。
 *     修：playTempList 先同步写内存 → 立刻 playList，落盘放后台。
 *  ④ 点歌传的是「界面显示下标」，后台补全期间 store 比界面短（搜索过滤后更短）
 *     → getList(index) 取到 undefined，静默不播。修：onPlayList 把被点中的那首歌也给出去，
 *     由 fullListRef 回推真实下标；同时 syncFullList 把 store 与界面保持同源。
 *
 * 运行：node scripts/sim-qq-songlist-perf.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  txSongList: 'src/utils/musicSdk/tx/songList.js',
  coreSonglist: 'src/core/songlist.ts',
  coreList: 'src/core/list.ts',
  detailAction: 'src/screens/SonglistDetail/listAction.ts',
  detailMusicList: 'src/screens/SonglistDetail/MusicList.tsx',
  onlineList: 'src/components/OnlineList/List.tsx',
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const REAL = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]))

const sliceBetween = (src, startNeedle, endNeedle, span = 6000) => {
  const start = src.indexOf(startNeedle)
  if (start < 0) return ''
  const end = src.indexOf(endNeedle, start)
  return src.slice(start, end < 0 ? start + span : end)
}

const invariants = (files) => {
  const reasons = []
  const tx = files.txSongList
  const all = sliceBetween(files.coreSonglist, 'export const getListDetailAll = async', 'export const clearListDetailCache')

  // ① QQ 单页 100 首（旧值 30 → 2000 首要 67 次串行请求）
  if (!/const pageSize = 100\n/.test(tx)) reasons.push('QQ 歌单详情单页不是 100 首（请求数偏多，进歌单会长时间卡顿）')
  if (/const pageSize = 30\n/.test(tx)) reasons.push('QQ 歌单详情仍是 30 首/页')

  // ①b 整单信息接口（约 2MB）必须只请求一次：有缓存 Map + TTL，且只在 getListMeta 里调用
  if (!/const LIST_META_TTL = 10 \* 60 \* 1000\n/.test(tx)) reasons.push('缺歌单信息缓存 TTL（整单接口会每页重复请求）')
  if (!/const listMetaCache = new Map\(\)\n/.test(tx)) reasons.push('缺歌单信息内存缓存 listMetaCache')
  if (!/async getListMeta\(id, data\) \{/.test(tx)) reasons.push('缺 getListMeta（歌单信息 + 总曲目数缓存入口）')
  if (!/listMetaCache\.get\(cacheKey\)/.test(tx)) reasons.push('getListMeta 不查缓存（每页都会打整单接口）')
  if (!/listMetaCache\.set\(cacheKey, \{ at: Date\.now\(\), meta \}\)/.test(tx)) reasons.push('getListMeta 命中后不写缓存')
  const urlUses = tx.split('this.getListDetailUrl(id)').length - 1
  if (urlUses !== 1) reasons.push(`整单接口调用点应为 1 处（getListMeta 内），实际 ${urlUses} 处`)
  if (!/const meta = await this\.getListMeta\(id, data\)/.test(tx)) reasons.push('getListDetailNew 没有用缓存后的歌单信息')
  if (!/data\.total_song_num \|\| meta\.total \|\| data\.songlist\.length/.test(tx)) reasons.push('total 没有 meta.total 兜底')

  // ② 全量拉取必须按累计歌曲数终止（不能 ceil(total/limit) 预计算）
  if (!all) reasons.push('找不到 getListDetailAll')
  else {
    if (!/const expectedTotal = result\.total > 0 \? result\.total : 0/.test(all)) reasons.push('getListDetailAll 没有取平台自报总数 expectedTotal')
    if (!/if \(expectedTotal > 0 && allSongs\.length >= expectedTotal\) break/.test(all)) reasons.push('getListDetailAll 没有按累计歌曲数终止（平台单页给不满时提前停 = 缓存数量对不上）')
    if (!/const MAX_DETAIL_PAGES = 200/.test(all)) reasons.push('getListDetailAll 缺翻页兜底上限')
    if (/page <= maxPage/.test(all) || /Math\.ceil\(result\.total \/ result\.limit\)/.test(all)) reasons.push('getListDetailAll 仍在用 ceil(total/limit) 预计算页数')
    if (!/if \(addedCount === 0\) break/.test(all)) reasons.push('getListDetailAll 缺「无新增即停止」保护')
  }

  // ③ 点歌不得等落盘：playTempList 先同步写内存再 playList
  const coreList = files.coreList
  if (!/export const playTempList = \(id: string, list: LX\.Music\.MusicInfoOnline\[\], index: number\) => \{/.test(coreList)) {
    reasons.push('缺 playTempList（点歌仍会 await 整表落盘）')
  } else {
    const fn = sliceBetween(coreList, 'export const playTempList', '\nexport const setFetchingListStatus', 900)
    const setAt = fn.indexOf('setMusicList(LIST_IDS.TEMP, list)')
    const playAt = fn.indexOf('void playList(LIST_IDS.TEMP, index)')
    const persistAt = fn.indexOf('void overwriteListMusics(LIST_IDS.TEMP, list)')
    if (setAt < 0) reasons.push('playTempList 没有同步写内存（setMusicList）')
    if (playAt < 0) reasons.push('playTempList 没有立即 playList')
    if (persistAt < 0) reasons.push('playTempList 没有后台落盘（overwriteListMusics）')
    if (setAt >= 0 && playAt >= 0 && setAt > playAt) reasons.push('playTempList 先播放后写内存（点歌会取不到歌）')
    if (/await overwriteListMusics\(LIST_IDS\.TEMP, list\)/.test(fn)) reasons.push('playTempList 又 await 落盘了（等于没修）')
  }

  const action = files.detailAction
  if (!/playTempList\(listId, \[\.\.\.list\], startIndex\)/.test(action)) reasons.push('SonglistDetail 点歌没有走 playTempList（仍在等整表落盘）')
  if (/await setTempList\(listId, \[\.\.\.list\]\)/.test(action)) reasons.push('SonglistDetail 点歌仍 await setTempList')
  if (!/Number\.isInteger\(index\) && index >= 0 && index < list\.length \? index : 0/.test(action)) reasons.push('点歌下标越界没有兜底（会静默不播）')

  // ④ 显示下标 ≠ 全量下标：点歌要用被点中的那首歌回推，store 与界面同源
  const musicList = files.detailMusicList
  if (!/const targetIndex = item \? list\.findIndex\(m => m\.id === item\.id\) : index/.test(musicList)) {
    reasons.push('MusicList 点歌没有按被点中的歌回推下标（搜索/补全期间会播错歌或不播）')
  }
  if (!/: OnlineListProps\['onPlayList'\] = \(index, item\)/.test(musicList)) reasons.push('MusicList 没有拿到被点中的 item（显示下标无法回推真实位置）')
  if (!/songlistState\.listDetailInfo\.list = songs/.test(musicList)) reasons.push('后台补全时 store 与界面不同源（点歌下标错位 → 点了没反应）')
  if (!/onPlayList\(index, item\)/.test(files.onlineList)) reasons.push('OnlineList 没有把被点击的行传给 onPlayList')

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型 1：全量拉取（旧 = 预计算页数；新 = 累计歌曲数）
// 模拟平台「单页实际给不满请求量」（QQ CgiGetDiss 会少给）时的累计结果
// ---------------------------------------------------------------------------
const fetchAllPages = ({ total, requestedPerPage, actualPerPage, mode }) => {
  let got = 0
  const maxPages = mode === 'old' ? Math.max(2, Math.ceil(total / requestedPerPage)) : 200
  for (let page = 1; page <= maxPages; page++) {
    if (mode === 'new' && got >= total) break
    const take = Math.min(actualPerPage, total - got)
    if (take <= 0) break
    got += take
  }
  return got
}

// 实测口径：每源页 100 首 ≈ 200KB；整单信息接口 ≈ 1.9MB（1270 首歌单实测，按 2000 首线性放大）
const QQ_PAGE_BYTES = 200 * 1024
const QQ_META_BYTES = Math.round(1.9 * 1024 * 1024 * 2000 / 1270)
const dataVolume = ({ mode }) => {
  const sourcePages = mode === 'old' ? Math.ceil(2000 / 30) : Math.ceil(2000 / 100)
  const metaCalls = mode === 'old' ? sourcePages : 1
  return sourcePages * (QQ_PAGE_BYTES * (mode === 'old' ? 0.3 : 1)) + metaCalls * QQ_META_BYTES
}

const models = [
  ['平台 2000 首、单页只给 25 首（请求 30）：旧（预计算页数）只拉到 1675 首', fetchAllPages({ total: 2000, requestedPerPage: 30, actualPerPage: 25, mode: 'old' }) === 1675],
  ['同一场景新逻辑按累计数翻页，拉满 2000 首（平台设置页详情首数才对得上）', fetchAllPages({ total: 2000, requestedPerPage: 30, actualPerPage: 25, mode: 'new' }) === 2000],
  ['单页给满 100 首时新逻辑也正好停在 2000（不会多翻）', fetchAllPages({ total: 2000, requestedPerPage: 100, actualPerPage: 100, mode: 'new' }) === 2000],
  ['进 2000 首歌单的数据量：新逻辑（1 次整单 + 20 x 200KB）不到旧逻辑的 1/10', dataVolume({ mode: 'new' }) * 10 < dataVolume({ mode: 'old' })],
  ['点歌下标：界面 800 首 / store 100 首时，点第 300 行 —— 旧（用显示下标取 store）取不到歌', (() => {
    const storeList = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}` }))
    return storeList[299] === undefined
  })()],
  ['同一场景：按被点中的那首歌回推（新逻辑）拿到的是界面里那首', (() => {
    const uiList = Array.from({ length: 800 }, (_, i) => ({ id: `s${i}` }))
    const tapped = uiList[299]
    return uiList.findIndex((m) => m.id === tapped.id) === 299
  })()],
  ['搜索过滤后点第 1 行：显示下标 0 不能直接当全量下标用（旧逻辑会播错歌）', (() => {
    const uiList = Array.from({ length: 800 }, (_, i) => ({ id: `s${i}` }))
    const filtered = uiList.filter((m) => m.id.endsWith('7')).slice(0, 5)
    const tapped = filtered[0]
    const wrong = uiList[0]
    const right = uiList[uiList.findIndex((m) => m.id === tapped.id)]
    return wrong.id !== tapped.id && right.id === tapped.id
  })()],
]

const failedModels = models.filter(([, ok]) => !ok)

// ---------------------------------------------------------------------------
// 反例自检
// ---------------------------------------------------------------------------
const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.split(find).join(replace)
}
const cases = []
const checkCase = (name, mutated, expectSubstr) => {
  let reasons = []
  try {
    reasons = invariants({ ...REAL, ...mutated })
  } catch (err) {
    cases.push([name, false, `抛异常: ${err.message}`])
    return
  }
  const hit = reasons.some((r) => r.includes(expectSubstr))
  cases.push([name, hit, hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）`])
}

checkCase('C1 QQ 单页退回 30 首', {
  txSongList: tamper(REAL.txSongList, 'const pageSize = 100\n', 'const pageSize = 30\n'),
}, '单页不是 100 首')

checkCase('C2 整单信息接口退回每页请求', {
  txSongList: tamper(REAL.txSongList, 'listMetaCache.get(cacheKey)', 'undefined'),
}, '不查缓存')

checkCase('C3 全量拉取退回 ceil(total/limit) 预计算', {
  coreSonglist: tamper(REAL.coreSonglist,
    '    if (expectedTotal > 0 && allSongs.length >= expectedTotal) break\n',
    '    if (page > Math.ceil(result.total / result.limit)) break\n'),
}, '没有按累计歌曲数终止')

checkCase('C4 点歌退回 await setTempList 后播放', {
  detailAction: tamper(REAL.detailAction,
    'playTempList(listId, [...list], startIndex)',
    'await setTempList(listId, [...list])\n    void playList(LIST_IDS.TEMP, startIndex)'),
}, '没有走 playTempList')

checkCase('C5 playTempList 先播放后写内存', {
  coreList: tamper(REAL.coreList,
    'setMusicList(LIST_IDS.TEMP, list)\n  listAction.setTempListMeta({ id })\n  void overwriteListMusics(LIST_IDS.TEMP, list)\n  void playList(LIST_IDS.TEMP, index)',
    'void playList(LIST_IDS.TEMP, index)\n  setMusicList(LIST_IDS.TEMP, list)'),
}, '先播放后写内存')

checkCase('C6 点歌不再回推真实下标（直接用显示下标）', {
  detailMusicList: tamper(REAL.detailMusicList,
    'const targetIndex = item ? list.findIndex(m => m.id === item.id) : index',
    'const targetIndex = index'),
}, '没有按被点中的歌回推下标')

checkCase('C7 OnlineList 不传被点击的行', {
  onlineList: tamper(REAL.onlineList, 'onPlayList(index, item)', 'onPlayList(index)'),
}, '没有把被点击的行传给 onPlayList')

const missed = cases.filter(([, ok]) => !ok)

console.log('行为模型（QQ 歌单拉全 / 点歌）')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of cases) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')

let failed = 0
const realReasons = invariants(REAL)
if (realReasons.length) {
  console.error(`FAIL  QQ 歌单拉全 + 点歌契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
  failed += 1
}
if (failedModels.length) {
  console.error(`FAIL  行为模型未通过（${failedModels.length} 项）`)
  failed += 1
}
if (missed.length) {
  console.error(`FAIL  有反例未被拦下（${missed.length} 项，断言无区分力）`)
  failed += 1
}
if (!failed) {
  console.log(`PASS  QQ 歌单拉全 + 点歌契约通过（结构不变量 4 组 + 行为模型 ${models.length} 例 + 反例 ${cases.length} 例）`)
  process.exit(0)
}
process.exit(1)
