/**
 * sim-playlist-cache-sync.js
 *
 * 「cookie 歌单缓存」可见性与写入失败提示契约（2026-10-03）。
 *
 * 用户反馈：cookie 登录 QQ 音乐后，QQ 歌单「存入缓存有问题，好像写不进缓存了」。
 *
 * 事实：这里其实有**两套互不相干的缓存**：
 *   ① 歌单索引（playlistIndexCache，utils/data/playlistIndex.ts）= 歌单**列表本身**，
 *      由「我的歌单」页第一次打开 / 设置页「刷新歌单」写入；
 *   ② 歌单详情（songlistDetailCache，utils/data/songlistDetail.ts）= 每张歌单里的**歌曲**，
 *      只有「进过那张歌单」才会写。
 * 而设置页「cookie 歌单缓存与同步」旧实现**只统计 ②**：登录 QQ 后点「刷新歌单」，
 * 索引其实写成功了，但页面数字仍是 0 张 · 0 首（刷新提示也不带任何数字）→
 * 用户据此判断「写不进缓存」。
 *
 * 修法：
 *   - 设置页把两套缓存分开统计并显示（每行：索引 N 张 · 详情 M 张 / K 首），
 *     点「刷新歌单」后的提示带上写入后的索引条数（证明确实写进去了）；
 *   - getPlaylistIndex 把「写入缓存失败」单独包一条明确错误（区分拉取失败）；
 *   - storage 的覆盖写（JSON.stringify + 落盘）必须在 try 内，失败要落日志
 *     （否则页面只看到「像没写进去」，没有任何线索）。
 *
 * 运行：node scripts/sim-playlist-cache-sync.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  syncPage: 'src/screens/Home/Views/Setting/settings/Basic/SonglistCacheSync.tsx',
  playlistIndex: 'src/core/playlistIndex.ts',
  storage: 'src/plugins/storage.ts',
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const REAL = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]))

const invariants = (files) => {
  const reasons = []
  const page = files.syncPage
  const index = files.playlistIndex
  const storage = files.storage

  // ① 设置页必须统计并显示「歌单索引」缓存
  if (!/import \{ getPlaylistIndex, getCachedPlaylistIndexCount \} from '@\/core\/playlistIndex'/.test(page)) {
    reasons.push('设置页没有引入 getCachedPlaylistIndexCount（无法统计歌单索引缓存）')
  }
  if (!/const indexCount = cookie[\s\S]{0,200}?getCachedPlaylistIndexCount\(source as LX\.OnlineSource\)/.test(page)) {
    reasons.push('refreshStats 没有按平台读取歌单索引缓存条数')
  }
  if (!/索引 \$\{row\.indexCount\} 张/.test(page)) {
    reasons.push('页面行没有显示歌单索引条数（只统计详情缓存 → 只刷新列表时看起来像没写进缓存）')
  }
  if (!/已缓存 歌单索引 \{cachedInfo\.reduce\(\(n, row\) => n \+ row\.indexCount, 0\)\} 张/.test(page)) {
    reasons.push('顶部汇总没有把歌单索引缓存计入（只列详情 = 数字永远为 0）')
  }

  // ② 刷新成功提示必须带写入后的索引条数
  if (!/return await getCachedPlaylistIndexCount\(source\)\.catch\(\(\) => 0\)/.test(page)) {
    reasons.push('refreshOne 没有把写入后的索引条数返回给调用方')
  }
  if (!/toast\(`已刷新：\$\{sourceName\(source\)\} 歌单（索引 \$\{count\} 张）`\)/.test(page)) {
    reasons.push('刷新成功提示不带索引条数（用户无法确认是否写进缓存）')
  }

  // ③ 写入缓存失败要有独立、明确的错误
  if (!/await savePlaylistIndexCache\(source, loginKey, lists\)/.test(index)) {
    reasons.push('getPlaylistIndex 不再写歌单索引缓存')
  }
  if (!/catch \(err: any\) \{[\s\S]{0,300}?写入缓存失败/.test(index)) {
    reasons.push('歌单索引写盘失败没有独立错误提示（与「拉取失败」混在一起）')
  }

  // ④ 覆盖写（JSON.stringify + 落盘）必须在 try 内（失败要落日志）
  //    实现：saveData / saveDataMultiple → prepareWrite（序列化）→ commitWrites（批量落盘 + 指针提交）
  const commitAt = storage.indexOf('const commitWrites = async(')
  if (storage.indexOf('JSON.stringify(value)') < 0 || commitAt < 0 ||
      !storage.slice(commitAt).includes('await AsyncStorage.multiSet(')) {
    reasons.push('storage 缺少「先批量落盘、再提交指针、后回收旧分片」的覆盖写实现（commitWrites）')
  }
  const saveData = (() => {
    const start = storage.indexOf('export const saveData = async')
    if (start < 0) return ''
    const end = storage.indexOf('export const getData =', start)
    return storage.slice(start, end < 0 ? start + 900 : end)
  })()
  const saveCallAt = saveData.indexOf('await commitWrites(')
  const saveTryAt = saveData.indexOf('try {')
  if (saveCallAt < 0 || saveTryAt < 0 || saveCallAt < saveTryAt) {
    reasons.push('saveData 的覆盖写在 try 之外：序列化/写入失败不会落日志')
  }
  const saveMultiple = (() => {
    const start = storage.indexOf('export const saveDataMultiple = async')
    if (start < 0) return ''
    const end = storage.indexOf('export const removeDataMultiple', start)
    return storage.slice(start, end < 0 ? start + 900 : end)
  })()
  const multiCallAt = saveMultiple.indexOf('await commitWrites(')
  const multiTryAt = saveMultiple.indexOf('try {')
  if (multiCallAt < 0 || multiTryAt < 0 || multiCallAt < multiTryAt) {
    reasons.push('saveDataMultiple 的覆盖写在 try 之外：序列化/写入失败不会落日志')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：页面该显示什么（旧=只统计详情；新=索引与详情分开）
// ---------------------------------------------------------------------------
const formatOld = ({ detailPlaylists, detailSongs }) => `${detailPlaylists} 张 · ${detailSongs} 首`
const formatNew = ({ indexPlaylists, detailPlaylists, detailSongs }) =>
  `索引 ${indexPlaylists} 张 · 详情 ${detailPlaylists} 张 / ${detailSongs} 首`

const models = [
  ['只刷新了歌单列表（索引 12 张）、还没进过歌单：旧显示「0 张 · 0 首」（像没写进缓存）',
    formatOld({ detailPlaylists: 0, detailSongs: 0 }) === '0 张 · 0 首'],
  ['同一场景新显示「索引 12 张 · 详情 0 张 / 0 首」（能看出索引确实写进去了）',
    formatNew({ indexPlaylists: 12, detailPlaylists: 0, detailSongs: 0 }) === '索引 12 张 · 详情 0 张 / 0 首'],
  ['进过 2 张歌单（缓存 300 首）：索引与详情都显示，互不覆盖',
    formatNew({ indexPlaylists: 12, detailPlaylists: 2, detailSongs: 300 }) === '索引 12 张 · 详情 2 张 / 300 首'],
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

checkCase('C1 行文案退回「只统计详情」', {
  // eslint-disable-next-line no-template-curly-in-string -- 反例样本必须原样保留模板字面量
  syncPage: tamper(REAL.syncPage, '索引 ${row.indexCount} 张 · 详情 ${row.playlistCount} 张 / ${row.songCount} 首', '${row.playlistCount} 张 · ${row.songCount} 首'),
}, '没有显示歌单索引条数')

checkCase('C2 刷新提示退回不带条数', {
  // eslint-disable-next-line no-template-curly-in-string -- 反例样本必须原样保留模板字面量
  syncPage: tamper(REAL.syncPage, 'toast(`已刷新：${sourceName(source)} 歌单（索引 ${count} 张）`)', 'toast(`已刷新：${sourceName(source)} 歌单`)'),
}, '刷新成功提示不带索引条数')

checkCase('C3 索引写盘失败不再单独提示', {
  playlistIndex: tamper(REAL.playlistIndex, '写入缓存失败', '失败'),
}, '没有独立错误提示')

checkCase('C4 序列化退回 try 之外', {
  storage: tamper(REAL.storage,
    '  try {\n    const previous = await AsyncStorage.getItem(key)',
    '  await commitWrites([prepareWrite(key, value)], [[key, previous]])\n  try {\n    const previous = await AsyncStorage.getItem(key)'),
}, '在 try 之外')

const missed = cases.filter(([, ok]) => !ok)

console.log('行为模型（缓存数字该显示什么）')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of cases) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')

let failed = 0
const realReasons = invariants(REAL)
if (realReasons.length) {
  console.error(`FAIL  cookie 歌单缓存契约未通过（${realReasons.length} 项）：`)
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
  console.log(`PASS  cookie 歌单缓存可见性与写入失败提示契约通过（结构不变量 4 组 + 行为模型 ${models.length} 例 + 反例 ${cases.length} 例）`)
  process.exit(0)
}
process.exit(1)
