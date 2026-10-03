/**
 * sim-remote-command-resilience.js
 *
 * 「控制中心 / 灵动岛的播放暂停、上一首下一首必须一次按下就生效，且永不彻底失效」契约
 * （2026-10-03，用户反馈：播放/暂停要按两下才生效；上一首/下一首完全没反应）。
 *
 * 两个已定位的机制（本脚本逐条守）：
 *   ① 上一首/下一首被「在途布尔量」永久锁死：dfcaa92 给切歌命令加了去重，用的却是
 *      「一个布尔量 + Promise.finally 复位」。只要 playNext/playPrev 的 Promise 因后台
 *      挂起/引擎切换一直不 settle（控制中心、灵动岛本来就只在 App 非活跃时使用），
 *      或 run() 在挂到 .finally 之前同步抛错，布尔量就永久停在 true —— 这两个键从此
 *      彻底失效直到重启。修法：改成**时间窗去重**（只压掉一次按键被重复投递），
 *      并给 run() 加 try/catch + .catch，任何异常都不能影响后续按键。
 *   ② 播放/暂停方向看的是滞后的 JS 播放态：控制中心/灵动岛发的是 togglePlayPause，
 *      而 togglePlay() 读 playerState.isPlay —— 系统中断、蓝牙路由抖动、nativeFlac
 *      引擎切换后它可能滞后一拍，那一拍里执行的是「其实已经满足」的动作（按下像没反应），
 *      要按第二下才生效。修法：以 getUnifiedPlaybackState()（引擎真实状态）决定方向。
 *   ③ 附带：卡片重绘要把 playbackState 切反再切回（否则控制中心歌词不刷新），翻转期间
 *      按钮图标是反的、正好按下就会被系统发成「另一边」的命令而吞掉这一次按压。
 *      修法：用户刚操作过的 1.2s 内跳过翻转（歌词行刷新让位给按键语义正确）。
 *
 * 运行：node scripts/sim-remote-command-resilience.js
 * 退出码：不变量全过、且所有反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  remoteCommand: 'src/core/init/player/remoteCommand.ts',
  appDelegate: 'ios/LxMusicMobile/AppDelegate.mm',
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const REAL = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]))

const structuralReasons = (files) => {
  const reasons = []
  const js = files.remoteCommand
  const mm = files.appDelegate

  // ① 切歌去重必须是时间窗，不得再用「在途布尔量」
  if (!/NAV_COMMAND_DEDUP_MS/.test(js) || !/now - lastNavCommandAt </.test(js) || !/const now = Date\.now\(\)/.test(js)) {
    reasons.push('remoteCommand 的切歌去重不是时间窗（会被永不 settle 的 Promise 永久锁死）')
  }
  if (/navCommandInFlight/.test(js)) {
    reasons.push('remoteCommand 又用回了「在途布尔量」去重（上一首/下一首可能彻底失效）')
  }
  if (!/run\(\)\.catch\(/.test(js) || !/try \{\s*\n\s*void run\(\)/.test(js)) {
    reasons.push('run() 没有同时用 try/catch 与 .catch 兜住（同步/异步异常都会影响后续按键）')
  }

  // ② 播放/暂停方向必须以引擎真实状态为准
  if (!/getUnifiedPlaybackState\(\)/.test(js)) {
    reasons.push('toggle 分支没有查询引擎真实播放态（滞后一拍时会要按两下）')
  }
  if (/case 'toggle':\s*\n\s*togglePlay\(\)/.test(js)) {
    reasons.push('toggle 分支又直接 togglePlay()（读滞后的 playerState.isPlay）')
  }

  // ③ 原生：用户刚操作过的窗口内不得翻转 playbackState
  if (!/LXNowPlayingLastRemoteCommandAtMs/.test(mm)) {
    reasons.push('原生没有记录「最近一次遥控命令时刻」（翻转会吞掉用户按压）')
  }
  const stampCount = (mm.match(/LXNowPlayingLastRemoteCommandAtMs = CACurrentMediaTime\(\) \* 1000\.0;/g) || []).length
  if (stampCount < 2) {
    reasons.push('原生的播放/暂停与 seek 遥控入口没有都记录命令时刻')
  }
  if (!/CACurrentMediaTime\(\) \* 1000\.0 - LXNowPlayingLastRemoteCommandAtMs < LXNowPlayingRepaintQuietWindowMs/.test(mm)) {
    reasons.push('原生卡片重绘没有「用户刚操作过就先不动翻转」的静默窗口（改为延迟补绘也要有这道门）')
  }

  return reasons
}

const realReasons = structuralReasons(REAL)

// ---------------------------------------------------------------------------
// 行为模型：复刻两种切歌去重策略，验证「旧模型会被永久锁死、新模型可自愈」
// ---------------------------------------------------------------------------
const models = []

/** 旧模型：在途布尔量 + Promise.finally 复位 */
const createLegacyGate = () => {
  let inFlight = false
  let runs = 0
  return {
    get runs() { return runs },
    run(settle) {
      if (inFlight) return false
      inFlight = true
      try {
        const p = settle()
        void p.finally(() => { inFlight = false })
      } catch (err) {
        // 同步抛错：.finally 根本挂不上 → inFlight 永久为 true
        void err
      }
      return true
    },
  }
}

/** 新模型：时间窗去重（只压掉窗口内的重复投递，之后自然恢复） */
const createWindowGate = (windowMs = 350) => {
  let lastAt = 0
  let runs = 0
  return {
    get runs() { return runs },
    run(now, settle) {
      if (now - lastAt < windowMs) return false
      lastAt = now
      runs++
      try {
        void Promise.resolve(settle()).catch(() => {})
      } catch (err) {
        void err
      }
      return true
    },
  }
}

{
  // 情景一：切歌 Promise 永不 settle（后台挂起），3 秒后再按一次
  const never = () => new Promise(() => {})
  const legacy = createLegacyGate()
  legacy.run(never)
  const legacySecond = legacy.run(never) // 仍然在途 → 被吞
  const window = createWindowGate()
  window.run(1000, never)
  const windowSecond = window.run(4000, never) // 时间窗过了 → 仍可执行
  models.push([
    '情景一 切歌 Promise 永不 settle：旧模型永久吞掉后续按键，新模型 3s 后仍能执行',
    legacySecond === false && windowSecond === true,
  ])
}

{
  // 情景二：run() 同步抛错（连 .finally 都挂不上）
  const legacy = createLegacyGate()
  legacy.run(() => { throw new Error('sync boom') })
  const legacySecond = legacy.run(() => Promise.resolve())
  const window = createWindowGate()
  window.run(1000, () => { throw new Error('sync boom') })
  const windowSecond = window.run(2000, () => Promise.resolve())
  models.push([
    '情景二 切歌同步抛错：旧模型被锁死，新模型仍可继续',
    legacySecond === false && windowSecond === true,
  ])
}

{
  // 情景三：同一次物理按键被重复投递（越狱 CarPlay 实锤）必须被压掉
  const window = createWindowGate()
  const first = window.run(1000, () => Promise.resolve())
  const duplicate = window.run(1080, () => Promise.resolve()) // 80ms 内重复 → 吞掉
  const nextPress = window.run(1600, () => Promise.resolve()) // 600ms 后真按第二下 → 执行
  models.push(['情景三 一次按键重复投递被压掉、真实连按不被吞', first === true && duplicate === false && nextPress === true])
}

const failedModels = models.filter(([, pass]) => !pass)

// ---------------------------------------------------------------------------
// 结构反例（必须被拦下）
// ---------------------------------------------------------------------------
const cases = []
{
  const tampered = { ...REAL, remoteCommand: REAL.remoteCommand.replace('Date.now() - lastNavCommandAt < NAV_COMMAND_DEDUP_MS', 'false') + '\n// navCommandInFlight 回归\n' }
  const caught = structuralReasons(tampered).some((r) => r.includes('在途布尔量'))
  cases.push(['切歌去重改回在途布尔量', caught])
}
{
  const tampered = {
    ...REAL,
    remoteCommand: REAL.remoteCommand.replace(
      /case 'toggle':[\s\S]*?\n {8}break/,
      "case 'toggle':\n        togglePlay()\n        break",
    ),
  }
  const caught = structuralReasons(tampered).some((r) => r.includes('直接 togglePlay'))
  cases.push(['播放/暂停改回读滞后的 playerState', caught])
}
{
  const tampered = {
    ...REAL,
    appDelegate: REAL.appDelegate.replace(
      // 静默窗口块：窗口内不再翻转，改为延迟补绘（见 sim-nowplaying-card-refresh）
      / {2}if \(LXNowPlayingLastRemoteCommandAtMs > 0 &&\n {6}CACurrentMediaTime\(\) \* 1000\.0 - LXNowPlayingLastRemoteCommandAtMs < LXNowPlayingRepaintQuietWindowMs\) \{\n[\s\S]{0,320}?\n {2}\}\n/,
      '',
    ),
  }
  const caught = structuralReasons(tampered).some((r) => r.includes('静默窗口'))
  cases.push(['原生去掉「刚操作过就不翻转」的静默窗口', caught])
}

const failedCases = cases.filter(([, caught]) => !caught)

// ---------------------------------------------------------------------------
console.log('去重策略行为模型')
for (const [name, pass] of models) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, caught] of cases) console.log(`${caught ? 'PASS' : 'FAIL'}  ${name} —— ${caught ? '已拦下' : '未拦下'}`)
console.log('')

let failed = 0
if (realReasons.length) {
  console.error(`FAIL  遥控命令可用性契约未通过（${realReasons.length} 项）：`)
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
  console.log(`PASS  控制中心/灵动岛遥控命令一次生效且不会永久失效（结构不变量 6 组 + 行为模型 ${models.length} 例 + 结构反例 ${cases.length} 例）`)
  process.exit(0)
}
process.exit(1)
