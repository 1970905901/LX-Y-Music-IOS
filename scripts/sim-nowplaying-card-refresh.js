/**
 * sim-nowplaying-card-refresh.js
 *
 * 「控制中心 / 灵动岛按钮图标必须跟着播放态刷新」契约（2026-10-03）。
 *
 * 用户实锤（正常播放歌曲，最新构建）：控制中心与灵动岛的播放/暂停按钮仍然
 * 「按一下没反应、要按两下」。
 *
 * 机制：iOS 的媒体卡片（按钮图标 + 歌词 + 进度）**只认**「把 playbackState 切到相反值
 * 再切回」这条刷新链路（见 AppDelegate 的 LXForceNowPlayingCardRepaint 注释：只重发
 * nowPlayingInfo 不会让卡片重绘）。而 4a0b5ad 为了「别在用户手指底下把图标翻转吞掉按压」，
 * 在用户按下后的 1.2s 静默窗口里**直接 return 丢掉**重绘请求 —— 于是这次播放态变化
 * 只能等下一次歌词换行才可见：按钮图标停在旧播放态，用户再按时系统发的还是同一个方向
 * （对已满足的方向是空操作）→ 表现为「按一下没反应、要按两下」。
 *
 * 修法：静默窗口内不再丢弃，改为**延迟补绘**（LXScheduleDeferredNowPlayingCardRepaint）：
 *   - 命令到达后 LXNowPlayingCommandSettleDelayMs(500ms) 再翻转（用户这一按早已结束）；
 *   - 单飞（scheduled 标志）+ 顺延：补绘前又有新命令（间隔 < LXNowPlayingCommandSafetyGapMs
 *     250ms）就推迟，绝不在用户连按的当拍翻转；
 *   - 遥控命令入口与播放态发布（LXSetNowPlayingPlaybackState）都会安排这次补绘。
 *
 * 第二轮根因（2026-10-03 用户再报「控制中心和灵动岛按钮又出问题」）：
 * 上面的延迟补绘自带一道「App 前台（applicationState == Active）就 return」的门控，而这道门正好把需要
 * 补绘的场景全部杀掉：
 *   · 灵动岛展开/点按是系统覆盖层，App 全程停在 Active → 100% 拦死；
 *   · 控制中心按完 500ms 落点时面板已收起、App 回到 Active → 同样拦死；
 *   · 锁屏/后台本来就是非 Active → 这道门从未起过作用（纯负担）。
 * 结果：「用户刚按过之后的 1.2s 静默窗口」把所有重绘汇进延迟补绘，而延迟补绘把它们
 * 全部丢弃 —— 音乐确实切了，卡片图标不动，再按还是同一个方向。修法：删掉两道门控，
 * 「没人看」改由翻转实现里的 hasInfo（没有 nowPlayingInfo 就没有卡片）兜底。
 *
 * 运行：node scripts/sim-nowplaying-card-refresh.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const APP_DELEGATE = 'ios/LxMusicMobile/AppDelegate.mm'
const real = fs.readFileSync(path.join(ROOT, APP_DELEGATE), 'utf8').replace(/\r\n/g, '\n')

const windowBetween = (src, startAnchor, endAnchor, fallback = 3000) => {
  const start = src.indexOf(startAnchor)
  if (start < 0) return ''
  const end = src.indexOf(endAnchor, start + startAnchor.length)
  return end < 0 ? src.slice(start, start + fallback) : src.slice(start, end)
}

const invariants = (src) => {
  const reasons = []

  // ① 静默窗口内必须「安排补绘」而不是直接丢弃
  const quietWindow = windowBetween(src, 'static void LXForceNowPlayingCardRepaint(void) {', 'static UIViewController *LXTopViewController', 2000)
  if (!quietWindow) {
    reasons.push('找不到 LXForceNowPlayingCardRepaint（卡片重绘入口）')
  } else if (!/LXNowPlayingRepaintQuietWindowMs\) \{[\s\S]{0,200}?LXScheduleDeferredNowPlayingCardRepaint\(\);/.test(quietWindow)) {
    reasons.push('静默窗口内直接丢弃重绘请求（按钮图标要等下一次歌词换行才刷新 → 按一下没反应）')
  }

  // ② 真正翻转的函数里不得再带静默判断（否则补绘会被自己挡掉）
  const flip = windowBetween(src, 'static void LXPerformNowPlayingCardRepaintFlip(void) {', 'static void LXScheduleDeferredNowPlayingCardRepaint(void) {', 3000)
  if (!flip) {
    reasons.push('找不到 LXPerformNowPlayingCardRepaintFlip（真正的翻转实现）')
  } else {
    if (/LXNowPlayingRepaintQuietWindowMs/.test(flip)) {
      reasons.push('翻转实现里又带上静默判断（延迟补绘会被自己挡掉）')
    }
    if (!/center\.playbackState = opposite;/.test(flip) || !/center\.playbackState = current;/.test(flip)) {
      reasons.push('翻转实现没有「切反再切回」playbackState（iOS 不会重绘卡片）')
    }
    // 「没人看」的兜底：去掉前台门控后，只能由 hasInfo 判定到底有没有卡片
    if (!/hasInfo = LXNowPlayingInfoCache\.count > 0;/.test(flip) || !/if \(!hasInfo\) return;/.test(flip)) {
      reasons.push('无卡片仍无意义翻转（flip 里的 hasInfo 兜底被删了）')
    }
  }

  // ③ 延迟补绘：单飞 + 顺延 + 使用命令后的 settle 延迟 + **禁止按 App 状态门控**
  const scheduler = windowBetween(src, 'static void LXScheduleDeferredNowPlayingCardRepaint(void) {', 'static void LXForceNowPlayingCardRepaint(void) {', 3000)
  if (!scheduler) {
    reasons.push('找不到 LXScheduleDeferredNowPlayingCardRepaint（延迟补绘）')
  } else {
    if (!/static BOOL scheduled = NO;[\s\S]{0,200}?if \(scheduled\) return;/.test(scheduler)) {
      reasons.push('延迟补绘没有单飞保护（歌词/元数据高频调用会叠加多次翻转）')
    }
    if (/applicationState == UIApplicationStateActive/.test(scheduler)) {
      reasons.push('延迟补绘按 applicationState 门控（灵动岛/前台控制中心下 App 停在 Active，补绘会被全部丢弃 → 按钮图标不动）')
    }
    if (!/LXNowPlayingCommandSettleDelayMs - sinceCommandMs/.test(scheduler)) {
      reasons.push('延迟补绘没有按「命令后 settle 延迟」计算等待时间')
    }
    if (!/LXNowPlayingCommandSafetyGapMs\) \{[\s\S]{0,200}?LXScheduleDeferredNowPlayingCardRepaint\(\);/.test(scheduler)) {
      reasons.push('延迟补绘没有「又有新命令就顺延」（会在用户连按的当拍翻转，吞掉按压）')
    }
    if (!/LXPerformNowPlayingCardRepaintFlip\(\);/.test(scheduler)) {
      reasons.push('延迟补绘没有真正执行翻转')
    }
  }

  // ④ 两个触发点：遥控命令入口 + 播放态发布
  const commandHandler = windowBetween(src, 'static MPRemoteCommandHandlerStatus LXHandleRemoteCommandEvent(NSString *command) {', 'static MPRemoteCommandHandlerStatus LXHandleRemoteChangePlaybackPositionEvent', 1200)
  if (!/LXScheduleDeferredNowPlayingCardRepaint\(\);/.test(commandHandler)) {
    reasons.push('遥控命令入口没有安排补绘（状态变化后卡片不会刷新）')
  }
  const stateSetter = windowBetween(src, 'static void LXSetNowPlayingPlaybackState(MPNowPlayingPlaybackState state, NSDictionary *options) {', 'static void LXClearNowPlayingInfo(void) {', 4000)
  if (!/LXScheduleDeferredNowPlayingCardRepaint\(\);/.test(stateSetter)) {
    reasons.push('播放态发布没有安排补绘（JS/中断/定时暂停的卡片图标不会刷新）')
  }

  // ⑤ 换歌（上一首/下一首）必须重绘，且不得按 app 状态跳过：这一处的 app-state 门控
  //   是「上一首/下一首按了没反应」的正体（换歌后整张卡片冻在上一首；没歌词的歌连
  //   原生歌词时钟那条兜底重绘也不会触发）
  const infoSetter = windowBetween(src,
    'static void LXSetNowPlayingInfo(NSDictionary *metadata) {',
    'static NSMutableArray<NSDictionary<NSString *, id> *> *LXNowPlayingLyricLines = nil;',
    6000)
  if (!infoSetter) {
    reasons.push('找不到 LXSetNowPlayingInfo（JS 元数据发布入口）')
  } else if (!/if \(isNewSong \|\| \[UIApplication sharedApplication\]\.applicationState != UIApplicationStateActive\) \{\s*LXForceNowPlayingCardRepaint\(\);/.test(infoSetter)) {
    reasons.push('换歌没有重绘卡片（上一首/下一首后卡片冻在上一首 → 看起来「按了没反应」）')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：卡片刷新时机（旧=丢弃；新=延迟补绘 + 顺延）
// ---------------------------------------------------------------------------
const makeCard = () => ({ state: 'playing', rendered: 'playing', flips: 0 })
const tapCommand = (card, command) => { card.state = command === 'pause' ? 'paused' : 'playing' }
const renderNow = (card) => { card.rendered = card.state; card.flips += 1 }

const oldRepaint = (card, { msSinceCommand, quietMs = 1200 }) => {
  if (msSinceCommand < quietMs) return false // 直接丢弃
  renderNow(card)
  return true
}
const newRepaint = (card, { msSinceCommand, quietMs = 1200, settleMs = 500 }) => {
  if (msSinceCommand >= quietMs) {
    renderNow(card)
    return true
  }
  const wait = Math.max(0, settleMs - msSinceCommand)
  if (wait > 0) return 'deferred'
  renderNow(card)
  return true
}
/** 用户按下的按钮方向取决于「卡片当前渲染出来的状态」（图标） */
const directionFromCard = (card) => (card.rendered === 'playing' ? 'pause' : 'play')
/** 命令对已满足的方向是空操作 */
const applyCommand = (card, command) => {
  const noop = (command === 'pause' && card.state === 'paused') || (command === 'play' && card.state === 'playing')
  if (!noop) tapCommand(card, command)
  return !noop
}

const models = []
{
  // 场景：音乐在播，用户点「暂停」→ 状态变了，但重绘被静默窗口丢弃
  const card = makeCard()
  card.state = 'paused' // 状态已变
  const rendered = oldRepaint(card, { msSinceCommand: 100 }) // 被丢弃
  // 用户再按：卡片图标仍是「暂停」→ 系统发 pause → 对已暂停是空操作
  const again = applyCommand(card, directionFromCard(card))
  models.push([
    '旧行为：静默窗口丢弃重绘 → 图标停在旧态，第二次按压发同一方向（空操作）= 按两下才生效',
    rendered === false && again === false,
  ])
}
{
  // 新行为：静默窗口内安排补绘，500ms 后翻转刷新 → 图标正确
  const card = makeCard()
  card.state = 'paused'
  const now = newRepaint(card, { msSinceCommand: 100 }) // 安排延迟补绘（不立即翻转）
  if (now === 'deferred') newRepaint(card, { msSinceCommand: 500 }) // 延迟到点：翻转刷新
  const direction = directionFromCard(card)
  models.push([
    '新行为：延迟补绘后图标跟到新状态 → 下一次按压方向正确（播放/暂停一次生效）',
    now === 'deferred' && card.rendered === 'paused' && direction === 'play',
  ])
}
{
  // 顺延：用户在补绘前又按了一次（100ms 内）→ 不翻转（避免吞按压），再顺延
  const within = newRepaint(makeCard(), { msSinceCommand: 120, quietMs: 1200, settleMs: 500 })
  const afterSafetyGap = newRepaint(makeCard(), { msSinceCommand: 600, quietMs: 1200, settleMs: 500 })
  models.push([
    '顺延规则：命令后 120ms 不翻转（推迟），≥500ms 才真正补绘',
    within === 'deferred' && afterSafetyGap === true,
  ])
}
{
  // 前台（灵动岛）也必须补绘：展开/点按灵动岛是系统覆盖层，App 全程 Active。
  // 若调度器按 applicationState 门控，这个场景的补绘 100% 被丢弃 → 音乐切了但图标不动。
  const schedulerWindow = windowBetween(real, 'static void LXScheduleDeferredNowPlayingCardRepaint(void) {', 'static void LXForceNowPlayingCardRepaint(void) {', 3000)
  const foregroundGated = /applicationState == UIApplicationStateActive/.test(schedulerWindow)
  const flipWindow = windowBetween(real, 'static void LXPerformNowPlayingCardRepaintFlip(void) {', 'static void LXScheduleDeferredNowPlayingCardRepaint(void) {', 3000)
  models.push([
    '前台/灵动岛同样补绘：调度器不按 applicationState 丢弃，「没人看」交给 flip 的 hasInfo 兜底',
    !foregroundGated && /hasInfo/.test(flipWindow),
  ])
}

{
  // 换歌场景：新歌发布元数据后必须重绘，否则卡片停在上一首。
  // 没有歌词的歌尤其致命：原生歌词时钟靠「行变化」触发重绘，无歌词就永不触发。
  const infoWin = windowBetween(real,
    'static void LXSetNowPlayingInfo(NSDictionary *metadata) {',
    'static NSMutableArray<NSDictionary<NSString *, id> *> *LXNowPlayingLyricLines = nil;',
    6000)
  models.push([
    '换歌即重绘：isNewSong 时无条件重绘，不被 app 状态门控挡住',
    /if \(isNewSong \|\|/.test(infoWin),
  ])
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

checkCase('C1 静默窗口退回「直接丢弃」',
  tamper(real, '    LXScheduleDeferredNowPlayingCardRepaint();\n    return;\n  }\n  LXPerformNowPlayingCardRepaintFlip();', '    return;\n  }\n  LXPerformNowPlayingCardRepaintFlip();'),
  '直接丢弃重绘请求')

checkCase('C2 延迟补绘去掉顺延（连按当拍翻转会吞按压）',
  tamper(real, 'CACurrentMediaTime() * 1000.0 - LXNowPlayingLastRemoteCommandAtMs < LXNowPlayingCommandSafetyGapMs)', 'false)'),
  '又有新命令就顺延')

checkCase('C3 去掉单飞保护',
  tamper(real, '  static BOOL scheduled = NO;\n  if (scheduled) return;', '  static BOOL scheduled = NO;\n  if (false && scheduled) return;'),
  '单飞保护')

checkCase('C4 播放态发布不再安排补绘',
  tamper(real, '  // 播放态变化同样要刷新卡片按钮（详情见 LXScheduleDeferredNowPlayingCardRepaint）\n  LXScheduleDeferredNowPlayingCardRepaint();\n}', '}'),
  '播放态发布没有安排补绘')

checkCase('C5 延迟补绘按 applicationState 门控（灵动岛/前台控制中心补绘被全部丢弃）',
  tamper(real, '  if (scheduled) return;\n', '  if (scheduled) return;\n  if ([UIApplication sharedApplication].applicationState == UIApplicationStateActive) return;\n'),
  '补绘按 applicationState 门控')

checkCase('C6 flip 里的 hasInfo 兜底被删（无卡片时会无意义翻转）',
  tamper(real, 'hasInfo = LXNowPlayingInfoCache.count > 0;', 'hasInfo = YES;'),
  '无卡片仍无意义翻转')

checkCase('C7 换歌重绘退回「仅非前台」（上一首/下一首后卡片冻在上一首）',
  tamper(real, 'if (isNewSong || [UIApplication sharedApplication].applicationState != UIApplicationStateActive) {', 'if ([UIApplication sharedApplication].applicationState != UIApplicationStateActive) {'),
  '换歌没有重绘卡片')

const missed = cases.filter(([, ok]) => !ok)

console.log('行为模型（按钮图标为什么「按一下没反应」）')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of cases) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')

let failed = 0
const realReasons = invariants(real)
if (realReasons.length) {
  console.error(`FAIL  卡片刷新契约未通过（${realReasons.length} 项）：`)
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
  console.log(`PASS  控制中心/灵动岛按钮图标随播放态刷新契约通过（结构不变量 4 组 + 行为模型 ${models.length} 例 + 反例 ${cases.length} 例）`)
  process.exit(0)
}
process.exit(1)
