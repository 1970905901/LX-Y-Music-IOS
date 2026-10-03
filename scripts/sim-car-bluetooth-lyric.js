/**
 * sim-car-bluetooth-lyric.js
 *
 * 「车载蓝牙歌词」字段布局契约（2026-10-03）。
 *
 * 用户实锤：连着车机（蓝牙）时车机屏幕**不显示歌词**。
 *
 * 事实：车机（AVRCP）大多只显示/优先显示媒体信息的 `title`；Android 端与本项目参考实现
 * 都是「歌词行进 title、歌名·歌手进 artist」。iOS 端此前把歌词行放 `artist`
 * （title = 歌名 - 歌手），于是手机控制中心/锁屏能看到歌词，而只读 title 的车机看不到。
 *
 * 修法（ios/LxMusicMobile/AppDelegate.mm，纯原生）：
 *   ① 记住 JS 发布的原始 title（歌名行 LXNowPlayingSongLine）与当前歌词行
 *      （LXNowPlayingCurrentLyricLine）；
 *   ② LXApplyNowPlayingTitleArtistFields()：**蓝牙输出 + 确有歌词行**时做字段对调
 *      （title = 当前行 / artist = 歌名行），其它情况保持原布局（title = 歌名行 /
 *      artist = 当前行）——外放、有线耳机、关闭「显示蓝牙歌词」都不变；
 *   ③ 元数据发布（LXSetNowPlayingInfo）与原生歌词时钟换行（LXNowPlayingLyricStep）
 *      都走这个 helper，保证两条通路字段一致；
 *   ④ 「换歌」判定必须用 LXNowPlayingSongLine 而不是 cache.title —— 蓝牙模式下
 *      cache.title 已被换成歌词行，拿它判定会把每次换行都当成换歌（时间轴被清空）；
 *   ⑤ 路由变化（车机接入/断开）立即重排字段并重发，不等下一次换行。
 *
 * 运行：node scripts/sim-car-bluetooth-lyric.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const APP_DELEGATE = 'ios/LxMusicMobile/AppDelegate.mm'
const real = fs.readFileSync(path.join(ROOT, APP_DELEGATE), 'utf8').replace(/\r\n/g, '\n')

const windowBetween = (src, startAnchor, endAnchor, fallback = 2500) => {
  const start = src.indexOf(startAnchor)
  if (start < 0) return ''
  const end = src.indexOf(endAnchor, start + startAnchor.length)
  return end < 0 ? src.slice(start, start + fallback) : src.slice(start, end)
}

const invariants = (src) => {
  const reasons = []

  // ① 两个「还原值」静态量
  if (!/static NSString \*LXNowPlayingSongLine = nil;/.test(src) ||
      !/static NSString \*LXNowPlayingCurrentLyricLine = nil;/.test(src)) {
    reasons.push('缺 LXNowPlayingSongLine / LXNowPlayingCurrentLyricLine（字段对调无法还原）')
  }

  // ② helper：蓝牙 + 有歌词行才对调；其它情况保持原布局
  const helper = windowBetween(src, 'static void LXApplyNowPlayingTitleArtistFields(NSMutableDictionary *info) {', 'static void LXSetNowPlayingInfo(NSDictionary *metadata) {')
  if (!helper) {
    reasons.push('缺 LXApplyNowPlayingTitleArtistFields（字段布局无处统一）')
  } else {
    if (!/LXHasBluetoothAudioRoute\(\) && LXNowPlayingCurrentLyricLine\.length > 0/.test(helper)) {
      reasons.push('字段对调没有限定「蓝牙输出 + 确有歌词行」（会改到外放/耳机下的卡片布局，或关闭开关时出错）')
    }
    if (!/info\[MPMediaItemPropertyTitle\] = LXNowPlayingCurrentLyricLine;/.test(helper) ||
        !/info\[MPMediaItemPropertyArtist\] = LXNowPlayingSongLine \?: @"";/.test(helper)) {
      reasons.push('蓝牙布局没有把歌词行写进 title / 把歌名行写进 artist（车机只读 title 依旧看不到歌词）')
    }
    if (!/info\[MPMediaItemPropertyTitle\] = LXNowPlayingSongLine;/.test(helper) ||
        !/info\[MPMediaItemPropertyArtist\] = LXNowPlayingCurrentLyricLine \?: @"";/.test(helper)) {
      reasons.push('非蓝牙布局未保持原样（title = 歌名行 / artist = 歌词行）')
    }
  }

  // ③ 两条通路都要走 helper
  const setInfo = windowBetween(src, 'static void LXSetNowPlayingInfo(NSDictionary *metadata) {', 'static void LXClearNowPlayingInfo(void) {', 4000)
  if (!/LXApplyNowPlayingTitleArtistFields\(info\);/.test(setInfo)) {
    reasons.push('元数据发布（LXSetNowPlayingInfo）没有走字段布局 helper')
  }
  const step = windowBetween(src, 'static void LXNowPlayingLyricStep(void) {', 'static void LXStartNowPlayingLyricTimer(void) {', 5000)
  if (!/LXApplyNowPlayingTitleArtistFields\(LXNowPlayingInfoCache\);/.test(step)) {
    reasons.push('原生歌词时钟换行没有走字段布局 helper（车机歌词停在旧布局）')
  }
  if (!/LXNowPlayingCurrentLyricLine = text;/.test(step)) {
    reasons.push('原生歌词时钟没有记录当前歌词行（字段布局拿不到最新行）')
  }

  // ④ 换歌判定用歌名行，不用 cache.title
  if (!/NSString \*previousTitle = LXNowPlayingSongLine;/.test(setInfo)) {
    reasons.push('换歌判定没用 LXNowPlayingSongLine（蓝牙模式下 cache.title 是歌词行，会把每次换行当成换歌）')
  }

  // ⑤ 路由变化立即重排 + 重发
  const routeObserver = windowBetween(src, 'LXNowPlayingRouteObserver = [[NSNotificationCenter defaultCenter] addObserverForName:AVAudioSessionRouteChangeNotification', 'LXNowPlayingInterruptionObserver', 2000)
  if (!/LXApplyNowPlayingTitleArtistFields\(LXNowPlayingInfoCache\);/.test(routeObserver)) {
    reasons.push('路由变化（车机接入/断开）没有立即重排字段布局')
  }

  // ⑥ 清时间轴/清会话要同时清「当前行」，避免旧行留在 title 上
  const clearLines = windowBetween(src, 'static void LXClearNowPlayingLyricLines(void) {', 'static void LXNowPlayingLyricStep(void) {', 800)
  if (!/LXNowPlayingCurrentLyricLine = nil;/.test(clearLines)) {
    reasons.push('清歌词时间轴时没有清当前歌词行（旧行会留在卡片/车机上）')
  }
  const clearInfo = windowBetween(src, 'static void LXClearNowPlayingInfo(void) {', 'static void LXHandleTrackPlayerLifecycleNotification', 1200)
  if (!/LXNowPlayingSongLine = nil;/.test(clearInfo)) {
    reasons.push('清空会话时没有清歌名行（下一首会拿旧歌名做还原值）')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：字段布局 + 换歌判定
// ---------------------------------------------------------------------------
const mapFields = ({ bt, songLine, lyricLine }) => {
  if (bt && lyricLine && lyricLine.length > 0) {
    return { title: lyricLine, artist: songLine || '' }
  }
  return { title: songLine || '', artist: lyricLine || '' }
}

const detectNewSong = ({ mode, previousSongLine, cacheTitle, incomingTitle }) => {
  const baseline = mode === 'songLine' ? previousSongLine : cacheTitle
  return incomingTitle != null && baseline != null && baseline.length > 0 && incomingTitle !== baseline
}

const models = []
{
  const car = mapFields({ bt: true, songLine: '歌名 - 歌手', lyricLine: '这一句是歌词' })
  models.push(['蓝牙 + 有歌词行 → title = 歌词行、artist = 歌名·歌手（车机看 title 即见歌词）',
    car.title === '这一句是歌词' && car.artist === '歌名 - 歌手'])
}
{
  const carOff = mapFields({ bt: true, songLine: '歌名 - 歌手', lyricLine: null })
  models.push(['蓝牙 + 关闭蓝牙歌词（无歌词行）→ 仍是 title = 歌名·歌手、artist 空',
    carOff.title === '歌名 - 歌手' && carOff.artist === ''])
}
{
  const phone = mapFields({ bt: false, songLine: '歌名 - 歌手', lyricLine: '这一句是歌词' })
  models.push(['非蓝牙（外放/有线耳机）→ 保持原布局（title = 歌名·歌手、artist = 歌词行）',
    phone.title === '歌名 - 歌手' && phone.artist === '这一句是歌词'])
}
{
  // 蓝牙模式下，cache.title 是歌词行：用 cache.title 判换歌会在每次换行误判
  const withCache = detectNewSong({ mode: 'cacheTitle', previousSongLine: '歌名 - 歌手', cacheTitle: '上一句歌词', incomingTitle: '歌名 - 歌手' })
  const withSongLine = detectNewSong({ mode: 'songLine', previousSongLine: '歌名 - 歌手', cacheTitle: '上一句歌词', incomingTitle: '歌名 - 歌手' })
  const realNewSong = detectNewSong({ mode: 'songLine', previousSongLine: '歌名 - 歌手', cacheTitle: '歌词', incomingTitle: '另一首歌 - 某歌手' })
  models.push(['换歌判定：用 cache.title 会把同歌的逐行发布误判成换歌（时间轴被清空），用歌名行才正确',
    withCache === true && withSongLine === false && realNewSong === true])
}

const failedModels = models.filter(([, ok]) => !ok)

// ---------------------------------------------------------------------------
// 反例自检
// ---------------------------------------------------------------------------
const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.split(find).join(replace)
}
const cases = []
const checkCase = (name, src, expectSubstr) => {
  let reasons = []
  try {
    reasons = invariants(src)
  } catch (err) {
    cases.push([name, false, `抛异常: ${err.message}`])
    return
  }
  const hit = reasons.some((r) => r.includes(expectSubstr))
  cases.push([name, hit, hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）`])
}

checkCase('C1 去掉蓝牙字段对调（退回只写 artist）',
  tamper(real, '  BOOL useBluetoothLayout = LXHasBluetoothAudioRoute() && LXNowPlayingCurrentLyricLine.length > 0;', '  BOOL useBluetoothLayout = NO;'),
  '没有限定「蓝牙输出 + 确有歌词行」')

checkCase('C2 换歌判定退回 cache.title',
  tamper(real, '    NSString *previousTitle = LXNowPlayingSongLine;', '    NSString *previousTitle = LXNowPlayingInfoCache[MPMediaItemPropertyTitle];'),
  '没用 LXNowPlayingSongLine')

checkCase('C3 原生时钟换行不走 helper',
  tamper(real, '    LXApplyNowPlayingTitleArtistFields(LXNowPlayingInfoCache);\n    // 热路径（每次换行）不得写 NSLog', '    // 热路径（每次换行）不得写 NSLog'),
  '原生歌词时钟换行没有走字段布局 helper')

checkCase('C4 路由变化不重排字段',
  tamper(real, '          LXApplyNowPlayingTitleArtistFields(LXNowPlayingInfoCache);\n          LXApplyNowPlayingInfo();', '          LXApplyNowPlayingInfo();'),
  '没有立即重排字段布局')

const missed = cases.filter(([, ok]) => !ok)

console.log('行为模型（字段布局 / 换歌判定）')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of cases) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')

let failed = 0
const realReasons = invariants(real)
if (realReasons.length) {
  console.error(`FAIL  车载蓝牙歌词字段布局契约未通过（${realReasons.length} 项）：`)
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
  console.log(`PASS  车载蓝牙歌词字段布局契约通过（结构不变量 6 组 + 行为模型 ${models.length} 例 + 反例 ${cases.length} 例）`)
  process.exit(0)
}
process.exit(1)
