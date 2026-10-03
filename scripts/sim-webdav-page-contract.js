/**
 * sim-webdav-page-contract.js
 *
 * 「WebDAV 页面回来了，而且真的能用」契约（2026-10-03，用户要求重新加回并修复）。
 *
 * 背景：WebDAV 列表功能一度被整体删除（用户先说「不能正常使用」→ 删；随后又要求
 * 「重新加回，因为是有问题的：之前太割裂，而且不能正常使用，顺便修复」）。
 * 现在页面已恢复，本脚本把「能正常使用」和「不割裂」两件事钉住，防止回归。
 *
 * 修复前实测的四处硬伤（本脚本逐条守）：
 *   ① 配置态一次性冻结：hasConfig 用 useMemo(..., []) 只在挂载时算一次 ——
 *      用户先在设置里配好再回到本页，页面仍认定「未配置」，扫描/下载/目录按钮全灰。
 *   ② 下载路径设置无效：下载目录读的是不存在的 'sync.webdav.downloadPath'
 *      （真实键是 'webdav.downloadPath'），用户选的目录被忽略。
 *   ③ 标签读出来存不下：updateWebDAVMusicMeta 只认 picUrl/filePath，
 *      名称/艺术家/专辑被静默丢弃；而 getWebDAVConfig 又每次用文件名重解析 name/singer，
 *      把读到的标签再洗回去 —— 等于「读标签」白读。
 *   ④ 远程路径冒充本地文件：扫描把远程路径写进 meta.filePath，
 *      导致「已下载」判定、读/编辑标签、下拉刷新全都在拿远程路径当本地文件用
 *      （下拉刷新永远假成功）。
 *
 * 「不割裂」：连接配置（地址/账号/密码 + 测试连接）直接在页面内的「配置」页可改，
 * 与 设置 → 数据同步 → WebDAV 同步 共用同一批 sync.webdav.* 键（同源，不会分叉）；
 * 目录浏览并入「目录」页，不再一半藏在「配置」里。
 *
 * 运行：node scripts/sim-webdav-page-contract.js
 * 退出码：不变量全过、且所有反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

const FILES = {
  constant: 'src/config/constant.ts',
  verticalMain: 'src/screens/Home/Vertical/Main.tsx',
  horizontalMain: 'src/screens/Home/Horizontal/Main.tsx',
  page: 'src/screens/Home/Views/WebDAV/index.tsx',
  action: 'src/screens/Home/Views/WebDAV/WebDAVListAction.ts',
  drive: 'src/core/webdavMusic/drive.ts',
  syncScreen: 'src/screens/Home/Views/Setting/settings/Sync/index.tsx',
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

/** 去掉注释后再做「键名」类断言：注释里会提到历史错键，不能算引用。
 *  `(^|[^:])` 避免把 `https://` 当成行注释。 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
const REAL = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]))

const structuralReasons = (files, pageDirExists) => {
  const reasons = []

  // ① 入口必须存在（我的页功能网格 / 首页 PagerView / 侧边栏都由 NAV_MENUS 派生）
  if (!/id: 'nav_webdav'/.test(files.constant)) reasons.push('NAV_MENUS 缺少 nav_webdav（我的页入口消失）')
  if (!/Views\/WebDAV/.test(files.verticalMain)) reasons.push('竖屏 Home 未注册 WebDAV 页面')
  if (!/Views\/WebDAV/.test(files.horizontalMain)) reasons.push('横屏 Home 未注册 WebDAV 页面')
  if (!pageDirExists) reasons.push('src/screens/Home/Views/WebDAV 页面目录不存在')

  // ② 配置态必须是响应式的（不得再一次性冻结）
  if (!/useSettingValue\('sync\.webdav\.url'\)/.test(files.page)) reasons.push('页面没有响应式读取 sync.webdav.url')
  if (!/useSettingValue\('sync\.webdav\.username'\)/.test(files.page)) reasons.push('页面没有响应式读取 sync.webdav.username')
  if (/const hasConfig = useMemo\(/.test(files.page)) reasons.push('hasConfig 又变回 useMemo（配置改动不会刷新，按钮永远禁用）')

  // ③ 页面内即可配置 + 测试连接（去割裂）
  if (!/InputItem/.test(files.page)) reasons.push('配置页没有可编辑的连接输入项')
  for (const key of ['sync.webdav.url', 'sync.webdav.username', 'sync.webdav.password']) {
    if (!files.page.includes(`'${key}'`)) reasons.push(`配置页缺少 ${key} 的写入`)
  }
  if (!/resetClient\(\)/.test(files.page)) reasons.push('改完连接配置没有 resetClient（新凭据不生效）')
  if (!/testConnection\(\)/.test(files.page)) reasons.push('配置页缺少「测试连接」')

  // ④ 下载目录必须读真实设置键
  if (!/settings\['webdav\.downloadPath'\]/.test(files.action)) {
    reasons.push("下载目录没读 'webdav.downloadPath'（用户选的下载路径不生效）")
  }
  for (const [rel, src] of Object.entries(files)) {
    if (/sync\.webdav\.downloadPath/.test(stripComments(src))) {
      reasons.push(`${rel} 仍引用不存在的 'sync.webdav.downloadPath'`)
    }
  }

  // ⑤ 标签字段必须能落库
  if (!/interface WebDAVMusicMetaUpdate[\s\S]{0,400}?name\?: string[\s\S]{0,200}?singer\?: string/.test(files.drive)) {
    reasons.push('WebDAVMusicMetaUpdate 没支持 name/singer（读标签的结果存不下来）')
  }
  if (!/if \(update\.name\) song\.name = update\.name/.test(files.drive)) reasons.push('updateWebDAVMusicMeta 没有应用 name')
  if (!/if \(update\.singer\) song\.singer = update\.singer/.test(files.drive)) reasons.push('updateWebDAVMusicMeta 没有应用 singer')

  // ⑥ 远程路径不得冒充本地文件 + 名称/歌手不得被文件名洗掉
  if (!/filePath: '',\n\s*remotePath: path,/.test(files.drive)) {
    reasons.push('扫描结果仍把远程路径写进 meta.filePath（未下载会被当成已下载）')
  }
  if (!/if \(remotePath && musicInfo\.meta\.filePath === remotePath\) musicInfo\.meta\.filePath = ''/.test(files.drive)) {
    reasons.push('缺少旧数据迁移：meta.filePath === remotePath 时应清空')
  }
  if (/musicInfo\.name = title\.name\n\s*musicInfo\.singer = title\.singer/.test(files.drive)) {
    reasons.push('normalizeWebDAVMusicInfo 又无条件用文件名覆盖 name/singer（标签会被洗掉）')
  }

  // ⑦ 下拉刷新只处理已下载到本地的文件，且不再假报成功
  if (!/const localSongs = songs\.filter\(song => !!song\.meta\.filePath\)/.test(files.page)) {
    reasons.push('下拉刷新没有只挑本地已下载的歌曲（会对远程路径读标签）')
  }
  if (/'标签加载完成'/.test(files.page)) reasons.push('下拉刷新仍在假报「标签加载完成」')

  // ⑧ 编辑标签前必须确认本地文件存在
  if (!/请先下载歌曲，再编辑标签/.test(files.page)) reasons.push('编辑标签没有「请先下载」的守卫')

  // ⑨ 设置里的 WebDAV 同步必须保留（两处同源，缺一不可）
  if (!/sync\.webdav\.url/.test(files.syncScreen)) reasons.push('设置→数据同步 的 WebDAV 同步配置界面不见了')

  return reasons
}

const pageDir = path.join(ROOT, 'src/screens/Home/Views/WebDAV')
const realReasons = structuralReasons(REAL, fs.existsSync(pageDir))

// ---------------------------------------------------------------------------
// 行为模型（复刻关键纯逻辑 + 反例自检）
// ---------------------------------------------------------------------------
const models = []

// —— 模型1：下载目录取值 ——
const resolveDownloadDir = (settings) => settings['webdav.downloadPath']?.trim() || '/private/webdav'
{
  const modern = { 'webdav.downloadPath': '/Documents/音乐' }
  const legacyKeyOnly = { 'sync.webdav.downloadPath': '/Documents/音乐' } // 旧实现的错键
  const ok = resolveDownloadDir(modern) === '/Documents/音乐' && resolveDownloadDir({}) === '/private/webdav'
  const counter = resolveDownloadDir(legacyKeyOnly) !== '/Documents/音乐'
  models.push(['下载目录读 webdav.downloadPath（错键取值不生效）', ok && counter])
}

// —— 模型2：标签归一化 ——
const normalize = (song) => {
  const remotePath = song.meta.remotePath
  if (remotePath && song.meta.filePath === remotePath) song.meta.filePath = ''
  const raw = song.meta.fileName || song.name || ''
  const dot = raw.lastIndexOf('.')
  const base = dot > 0 ? raw.slice(0, dot) : raw
  const parts = base.split('-')
  const title = { name: parts[0].trim(), singer: parts.slice(1).join('-').trim() }
  if (!song.name) song.name = title.name
  if (!song.singer) song.singer = title.singer
  return song
}
{
  // 旧数据：filePath 是远程路径 → 必须清空
  const legacy = normalize({ name: '稻香', singer: '周杰伦', meta: { fileName: '稻香-周杰伦.flac', filePath: '/音乐/稻香-周杰伦.flac', remotePath: '/音乐/稻香-周杰伦.flac' } })
  // 读到的标签（与文件名不同）不得被覆盖
  const tagged = normalize({ name: '晴天 (Live)', singer: '周杰伦', meta: { fileName: '01-track03.flac', filePath: '/var/mobile/Downloads/01-track03.flac', remotePath: '/音乐/01-track03.flac' } })
  // 缺名称时才用文件名兜底
  const fallback = normalize({ name: '', singer: '', meta: { fileName: '七里香-周杰伦.mp3', filePath: '', remotePath: '/音乐/七里香-周杰伦.mp3' } })
  const ok = legacy.meta.filePath === '' &&
    tagged.name === '晴天 (Live)' && tagged.singer === '周杰伦' && tagged.meta.filePath === '/var/mobile/Downloads/01-track03.flac' &&
    fallback.name === '七里香' && fallback.singer === '周杰伦'
  models.push(['归一化：清远程 filePath / 不洗标签 / 缺省才兜底', ok])
}

// —— 模型3：标签更新落库 ——
const applyMetaUpdate = (song, update) => {
  if (update.picUrl !== undefined) song.meta.picUrl = update.picUrl
  if (update.filePath !== undefined) song.meta.filePath = update.filePath || ''
  if (update.name) song.name = update.name
  if (update.singer) song.singer = update.singer
  if (update.albumName !== undefined) song.meta.albumName = update.albumName
  return song
}
{
  const song = applyMetaUpdate({ name: 'old', singer: '', meta: { picUrl: '', filePath: '', albumName: '' } }, {
    name: '新歌名', singer: '新歌手', albumName: '新专辑', picUrl: 'file://x.jpg', filePath: '/var/a.flac',
  })
  const ok = song.name === '新歌名' && song.singer === '新歌手' && song.meta.albumName === '新专辑' &&
    song.meta.picUrl === 'file://x.jpg' && song.meta.filePath === '/var/a.flac'
  models.push(['标签更新：name/singer/albumName/picUrl/filePath 全部落库', ok])
}

const failedModels = models.filter(([, pass]) => !pass)

// ---------------------------------------------------------------------------
// 反例自检：把 5 处真实历史缺陷塞回源码，必须全部被拦下
// ---------------------------------------------------------------------------
const cases = []

{
  const tampered = {
    ...REAL,
    page: REAL.page.replace(
      '  const hasConfig = !!(webdavUrl && webdavUsername)',
      '  const hasConfig = useMemo(() => !!(webdavUrl && webdavUsername), [])',
    ),
  }
  const caught = structuralReasons(tampered, true).some((r) => r.includes('hasConfig 又变回 useMemo'))
  cases.push(['hasConfig 改回一次性 useMemo', caught])
}
{
  const tampered = {
    ...REAL,
    action: REAL.action.replace("settings['webdav.downloadPath']", "settings['sync.webdav.downloadPath']"),
  }
  const caught = structuralReasons(tampered, true).some((r) => r.includes('sync.webdav.downloadPath'))
  cases.push(['下载目录键写回 sync.webdav.downloadPath', caught])
}
{
  const tampered = {
    ...REAL,
    drive: REAL.drive.replace("  filePath: '',\n      remotePath: path,", '  filePath: path,\n      remotePath: path,'),
  }
  const caught = structuralReasons(tampered, true).some((r) => r.includes('仍把远程路径写进 meta.filePath'))
  cases.push(['扫描把远程路径写回 meta.filePath', caught])
}
{
  const tampered = {
    ...REAL,
    drive: REAL.drive.replace(
      "  const title = parseFileName(musicInfo.meta.fileName || musicInfo.name || '')\n  if (!musicInfo.name) musicInfo.name = title.name\n  if (!musicInfo.singer) musicInfo.singer = title.singer",
      "  const title = parseFileName(musicInfo.meta.fileName || musicInfo.name || '')\n  musicInfo.name = title.name\n  musicInfo.singer = title.singer",
    ),
  }
  const caught = structuralReasons(tampered, true).some((r) => r.includes('又无条件用文件名覆盖 name/singer'))
  cases.push(['归一化改回无条件覆盖 name/singer', caught])
}
{
  const tampered = {
    ...REAL,
    page: REAL.page.replace(
      'const localSongs = songs.filter(song => !!song.meta.filePath)',
      'const localSongs = songs',
    ),
  }
  const caught = structuralReasons(tampered, true).some((r) => r.includes('没有只挑本地已下载的歌曲'))
  cases.push(['下拉刷新改回对所有歌曲读标签（远程路径）', caught])
}

const failedCases = cases.filter(([, caught]) => !caught)

// ---------------------------------------------------------------------------
console.log('行为模型（复刻关键纯逻辑）')
for (const [name, pass] of models) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, caught] of cases) console.log(`${caught ? 'PASS' : 'FAIL'}  ${name} —— ${caught ? '已拦下' : '未拦下'}`)
console.log('')

let failed = 0
if (realReasons.length) {
  console.error(`FAIL  WebDAV 页面契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
  failed++
}
if (failedModels.length) {
  console.error(`FAIL  行为模型未通过（${failedModels.length} 项）`)
  failed++
}
if (failedCases.length) {
  console.error(`FAIL  有反例未被拦下（${failedCases.length} 项，断言无区分力）`)
  failed++
}

if (!failed) {
  console.log(
    `PASS  WebDAV 页面可用性契约通过（9 组结构不变量 + ${models.length} 例行为模型 + ${cases.length} 例反例）`,
  )
  process.exit(0)
}
process.exit(1)
