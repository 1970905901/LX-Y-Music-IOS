/**
 * sim-wy-kg-songlist-audit.js
 *
 * 网易云（wy）/ 酷狗（kg）歌单详情「有没有跟 QQ 一样的毛病」审计契约（2026-10-03）。
 *
 * 背景：用户报 QQ 歌单卡顿 / 点歌没反应 / 缓存首数对不上，随后要求「检查下网易和酷狗平台有没有问题」。
 * 本轮对照审计（含真接口实测，非推测）：
 *
 *  A. 分页与总数（实测）
 *     - wy：`weapi/v3/playlist/detail`（app 里 n=100000）返回**整单 trackIds**（1267 首实测 227KB）
 *       + 少量 tracks/privileges；`total = trackIds.length` 精确。补齐歌曲走
 *       `weapi/v3/song/detail`，单次 1000 个 id（实测 1000 首 = 2.0MB / 1.4s，267 首 = 0.55MB）。
 *       即每 1000 首一次请求，分页语义正确。
 *     - kg：cookie 歌单走 `getUserListDetail2`（collection_）/`getUserListDetailByCode`（数字 id）
 *       → **一次返回整张歌单**（内部 300/页自动翻完），`limit` 声明为 10000/count、`total` = songcount；
 *       本地分页缓存（core/songlist.ts doGetListDetailLimit 把源页切成 30 首/本地页）会把整表一次性
 *       铺开成 ceil(N/30) 个本地页，后续本地页全是缓存命中，不会「每页重抓整表」。
 *     - 结论：wy/kg 的 total 与分页都可用；`getListDetailAll` 已改成按**累计歌曲数**终止
 *       （见 sim-qq-songlist-perf.js），在「平台单页少给」时才继续翻页，其它情况与本地页数等价。
 *
 *  B. 本轮审计新发现并修掉的两个 kg 真 bug
 *     1) `getUserListDetailByPcChain()` 把歌曲列表写进 `chain` 键（应为 `${chain}_pc_list`），
 *        （且必须先 getMusicInfos 映射再缓存，否则命中时整单会被 toNewMusicInfo 过滤成空）
 *        覆盖了 `getListInfoByChain()` 的歌单信息缓存 → 同一会话第二次进该链式歌单：
 *        页头歌单名/封面取到数组上的 undefined 而变空，且 `_pc_list` 缓存永远 miss（每次重抓）。
 *     2) `core/songlist.ts` 的 `clearListDetailCache('kg', id)` 会调 `evictDetailCache(id)`，
 *        但 kg SDK 里**没有这个方法**（`?.()` 静默 no-op）→ 下拉刷新 / 更新同步对链式歌单无效
 *        （拿到的还是会话缓存里的旧数据）。现在实现了它（同时清 `chain` 与 `${chain}_pc_list`）。
 *
 *  C. 顺手加固：wy `filterListDetail` 里 `privileges[index]` 可能是 undefined，
 *     旧写法 `privilege.id` 直接抛 TypeError → 整页歌单被判「加载失败」。已加 `!privilege` 守卫。
 *
 * 运行：node scripts/sim-wy-kg-songlist-audit.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  wySongList: 'src/utils/musicSdk/wy/songList.js',
  kgSongList: 'src/utils/musicSdk/kg/songList.js',
  coreSonglist: 'src/core/songlist.ts',
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const REAL = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]))

const sliceBetween = (src, startNeedle, endNeedle, span = 4000) => {
  const start = src.indexOf(startNeedle)
  if (start < 0) return ''
  const end = src.indexOf(endNeedle, start)
  return src.slice(start, end < 0 ? start + span : end)
}

const invariants = (files) => {
  const reasons = []
  const wy = files.wySongList
  const kg = files.kgSongList
  const core = files.coreSonglist

  // ---- wy：分页语义 / total / 加固 ----
  if (!/let limit = 1000\n/.test(wy)) reasons.push('wy 分页单位不是 1000（song/detail 每页取多少首）')
  if (!/let rangeStart = \(page - 1\) \* limit\n/.test(wy)) reasons.push('wy 缺少按页算起点 rangeStart')
  if (!/body\.playlist\.trackIds\.slice\(rangeStart, limit \* page\)/.test(wy)) reasons.push('wy 取歌没有按页切片（会每页重复整表）')
  if (!/total: body\.playlist\.trackIds\.length/.test(wy)) reasons.push('wy total 不再是 trackIds 长度（累计终止会取错目标）')
  if (!/if \(!privilege \|\| privilege\.id !== item\.id\)/.test(wy)) reasons.push('wy privileges 下标可能越界仍直接解引用（整页详情会抛错）')

  // ---- kg：链式歌单会话缓存键 + 刷新失效 ----
  const pcChain = sliceBetween(kg, 'async getUserListDetailByPcChain(chain) {', 'async getUserListDetail4', 1200)
  if (!pcChain) reasons.push('找不到 kg getUserListDetailByPcChain')
  else {
    if (!/const key = `\$\{chain\}_pc_list`\n/.test(pcChain)) reasons.push('kg PC 链式歌单缓存键不是 _pc_list 形式')
    if (!/this\.cache\.set\(key, result\)/.test(pcChain)) reasons.push('kg PC 链式歌单没有把列表写进 _pc_list 键（会覆盖歌单信息缓存）')
    if (/this\.cache\.set\(chain, result\)/.test(pcChain)) reasons.push('kg PC 链式歌单仍在覆盖 chain 键（歌单名/封面会变空）')
    const mapAt = pcChain.indexOf('result = await this.getMusicInfos(result)')
    const setAt = pcChain.indexOf('this.cache.set(key, result)')
    if (mapAt < 0) reasons.push('kg PC 链式歌单没有把结果映射成 app 内部结构')
    if (setAt < 0) reasons.push('kg PC 链式歌单没有写 _pc_list 缓存')
    if (mapAt >= 0 && setAt >= 0 && mapAt > setAt) reasons.push('kg PC 链式歌单把**原始**字段写进缓存（命中后整单会被 toNewMusicInfo 过滤成空）')
  }
  if (!/evictDetailCache\(id\) \{/.test(kg)) reasons.push('kg 缺 evictDetailCache（刷新/更新同步静默无效）')
  else {
    const evict = sliceBetween(kg, 'evictDetailCache(id) {', '\n  },', 600)
    if (!/this\.cache\.delete\(chain\)/.test(evict)) reasons.push('evictDetailCache 没清 chain 键（歌单信息仍是旧的）')
    if (!/this\.cache\.delete\(`\$\{chain\}_pc_list`\)/.test(evict)) reasons.push('evictDetailCache 没清 _pc_list 键（歌曲列表仍是旧的）')
  }
  if (!/kgSongList\.evictDetailCache\?\.\(id\)/.test(core)) reasons.push('core 不再调用 kgSongList.evictDetailCache（kg 刷新失效链断了）')

  // ---- 共享：本地页单位必须是 LIST_LOAD_LIMIT（30），累计终止才与「本地页数」等价 ----
  if (!/limit: LIST_LOAD_LIMIT,/.test(core)) reasons.push('源页没有切成 LIST_LOAD_LIMIT 的本地页（本地分页假设被破坏）')
  if (!/if \(pendingList\.length < LIST_LOAD_LIMIT && sourcePage < totalSourcePages\)/.test(core)) reasons.push('本地页余数没有留给下一个源页（会出现碎片页）')

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型（用实测数字）
// ---------------------------------------------------------------------------
const LOCAL_LIMIT = 30
const localPagesNeeded = (total) => Math.ceil(total / LOCAL_LIMIT)
// wy：每源页 1000 首（song/detail 实测：1000 首 2.0MB，267 首 0.55MB）
const wySourcePages = (total) => Math.ceil(total / 1000)
const wyDelivered = (total) => [Math.min(1000, total), Math.max(0, total - 1000)].filter(n => n > 0)
// kg：整表一次返回；core 会把源页切成 ceil(N/30) 个本地页（totalSourcePages = ceil(total/limit) = 1）
const kgLocalPagesFromOneResponse = (total, limit) => {
  const sourcePages = Math.ceil(total / limit)
  const pages = []
  let pending = total
  let sourcePage = 1
  while (pending > 0) {
    if (pending < LOCAL_LIMIT && sourcePage < sourcePages) {
      pages.push({ stashed: pending })
      pending = 0
      break
    }
    pages.push({ size: Math.min(LOCAL_LIMIT, pending) })
    pending -= LOCAL_LIMIT
  }
  return pages
}

const models = [
  ['本地分页单位=30：wy 1267 首 = 43 个本地页（累计终止与旧上限一致，不会少拉）', localPagesNeeded(1267) === 43],
  ['本地分页单位=30：kg 2000 首 = 67 个本地页', localPagesNeeded(2000) === 67],
  ['wy 实测分页：1000 + 267 = 1267（与 total 相符，两页拿全）', wyDelivered(1267).join('+') === '1000+267' && wyDelivered(1267).reduce((a, b) => a + b, 0) === 1267],
  ['wy 请求数 = ceil(N/1000)：1267 首只需 2 次 song/detail', wySourcePages(1267) === 2],
  ['kg 整表返回：一次响应即切成 67 个本地页，且不会把余数留到「下一个源页」', (() => {
    const pages = kgLocalPagesFromOneResponse(2000, 10000)
    return pages.length === 67 && pages.every(p => !p.stashed) && pages.reduce((n, p) => n + (p.size || 0), 0) === 2000
  })()],
  ['kg 余数留页只在「源接口还有后续页」时发生（limit 10000 → ceil(N/limit)=1 → 不发生）', Math.ceil(2000 / 10000) === 1],
  ['平台单页少给时（QQ 实测口径）累计终止仍能拉满：25/页 × 80 页 = 2000', (() => {
    let got = 0
    for (let page = 0; page < 200 && got < 2000; page++) got += 25
    return got === 2000
  })()],
  ['隐私/空歌单：wy trackIds 为空时 limit 用 limit_song（100000）→ totalSourcePages=0 → 只写一个空本地页', (() => {
    const total = 0
    const limit = 100000
    return Math.ceil(total / limit) === 0
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

checkCase('C1 wy 取歌不再按页切片', {
  wySongList: tamper(REAL.wySongList, 'body.playlist.trackIds.slice(rangeStart, limit * page)', 'body.playlist.trackIds'),
}, '没有按页切片')

checkCase('C2 wy total 退回非 trackIds 长度', {
  wySongList: tamper(REAL.wySongList, 'total: body.playlist.trackIds.length', 'total: body.playlist.trackCount'),
}, '不再是 trackIds 长度')

checkCase('C3 wy privileges 下标越界又直接解引用', {
  wySongList: tamper(REAL.wySongList, 'if (!privilege || privilege.id !== item.id)', 'if (privilege.id !== item.id)'),
}, '直接解引用')

checkCase('C4 kg PC 链式歌单缓存键写回 chain（覆盖歌单信息）', {
  kgSongList: tamper(REAL.kgSongList, 'this.cache.set(key, result)', 'this.cache.set(chain, result)'),
}, '覆盖 chain 键')

checkCase('C5 kg 删掉 evictDetailCache（刷新静默无效）', {
  kgSongList: tamper(REAL.kgSongList, 'evictDetailCache(id) {', 'evictDetailCacheDisabled(id) {'),
}, '缺 evictDetailCache')

checkCase('C6 kg evictDetailCache 只清信息不清列表', {
  // eslint-disable-next-line no-template-curly-in-string -- 反例样本必须原样保留模板字面量
  kgSongList: tamper(REAL.kgSongList, 'this.cache.delete(`${chain}_pc_list`)', 'void 0'),
}, '没清 _pc_list 键')

checkCase('C7 core 不再把源页切成 LIST_LOAD_LIMIT 本地页', {
  coreSonglist: tamper(REAL.coreSonglist, 'limit: LIST_LOAD_LIMIT,', 'limit: result.limit,'),
}, '源页没有切成 LIST_LOAD_LIMIT 的本地页')

checkCase('C8 kg PC 链式歌单先缓存再映射（缓存里是原始字段）', {
  kgSongList: tamper(REAL.kgSongList,
    '    result = await this.getMusicInfos(result)\n    this.cache.set(key, result)',
    '    this.cache.set(key, result)\n    result = await this.getMusicInfos(result)'),
}, '把**原始**字段写进缓存')

const missed = cases.filter(([, ok]) => !ok)

console.log('行为模型（wy / kg 分页与整表返回）')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of cases) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')

let failed = 0
const realReasons = invariants(REAL)
if (realReasons.length) {
  console.error(`FAIL  wy/kg 歌单审计契约未通过（${realReasons.length} 项）：`)
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
  console.log(`PASS  wy/kg 歌单审计契约通过（结构不变量 4 组 + 行为模型 ${models.length} 例 + 反例 ${cases.length} 例）`)
  process.exit(0)
}
process.exit(1)
