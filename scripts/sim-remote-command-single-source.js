/**
 * 车机 / 方向盘 / 控制中心的遥控命令必须**只有一条处理通路**（且切歌带去重）。
 *
 * 用户实锤（越狱 CarPlay）：用车机方向盘「下一曲」时只在少数几首之间来回循环；
 * 用 App 内按钮则正常。
 *
 * 根因：同一批 MPRemoteCommandCenter 命令被挂了两套 target：
 *   ① RNTP 原生侧（SwiftAudioEx RemoteCommandController）→ RNTP 事件 remote-next 等
 *      → src/plugins/player/service.ts；
 *   ② 本工程原生侧（AppDelegate.mm LXInstallRemoteCommandHandlers）→ LXRemoteCommand
 *      通知 → UtilsModule 'remote-command' 事件 → core/init/player/remoteCommand.ts。
 *   一次物理按键两条通路各跑一遍 playNext() ⇒ 一次跳两首（短列表就成了「在少数几首
 *   之间循环」）；播放/暂停则是开关两下互相抵消；控制中心进度条重复 seek。
 *
 * 修法：
 *   - service.ts 里删掉 RemotePlay/RemotePause/RemoteNext/RemotePrevious/RemoteSeek 的
 *     重复监听，只保留 RNTP 独有的 RemoteDuck（来电/路由打断）与 RemoteStop；
 *   - 唯一入口 remoteCommand.ts 的上一曲/下一曲加「在途去重」，兜住车机重复投递
 *     （真实连按间隔 ≥100ms ≫ 一次切歌处理时间，不会吞掉用户操作）。
 *
 * 本脚本从源码抽取真实写法做断言，并带反例自检（通路重复这类回归 tsc/eslint 无感）。
 * 运行：node scripts/sim-remote-command-single-source.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  service: 'src/plugins/player/service.ts',
  remoteCommand: 'src/core/init/player/remoteCommand.ts',
  nativeUtils: 'src/utils/nativeModules/utils.ts',
  appDelegate: 'ios/LxMusicMobile/AppDelegate.mm',
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const readAll = (over = {}) => {
  const out = {}
  for (const [k, p] of Object.entries(FILES)) out[k] = over[k] !== undefined ? over[k] : read(p)
  return out
}

const DUPLICATED_IN_SERVICE = [
  'RemotePlay',
  'RemotePause',
  'RemoteNext',
  'RemotePrevious',
  'RemoteSeek',
]

const invariants = (files) => {
  const reasons = []

  // ① RNTP service 不得再监听这些命令（否则与原生通路重复触发）
  for (const name of DUPLICATED_IN_SERVICE) {
    if (new RegExp(`TPEvent\\.${name}\\b`).test(files.service)) {
      reasons.push(`service.ts 仍在监听 ${name}：与原生 remote-command 通路重复 → 一次按键执行两次`)
    }
  }
  // RNTP 独有的两条必须保留
  for (const name of ['RemoteDuck', 'RemoteStop']) {
    if (!new RegExp(`TPEvent\\.${name}\\b`).test(files.service)) {
      reasons.push(`service.ts 缺少 ${name} 监听（RNTP 独有的通路，删了会丢打断/系统停止处理）`)
    }
  }

  // ② 唯一入口：remoteCommand.ts 必须覆盖全部六种命令
  const cases = {
    play: /case 'play':/,
    pause: /case 'pause':/,
    toggle: /case 'toggle':/,
    next: /case 'next':/,
    previous: /case 'previous':/,
    seek: /case 'seek':/,
  }
  for (const [name, re] of Object.entries(cases)) {
    if (!re.test(files.remoteCommand)) {
      reasons.push(`remoteCommand.ts 缺少 '${name}' 分支（该遥控命令将无人处理）`)
    }
  }
  // 命令动作必须落到本 App 自己的播放器语义
  // toggle 的方向必须由**本 App 自己**决定，不能交给 RNTP 的 playerState：
  // 允许两种写法 —— 直接用 togglePlay()，或先查引擎真实状态（getUnifiedPlaybackState）
  // 再决定 play/pause（后者见 sim-remote-command-resilience：滞后一拍会导致「按两下才生效」）。
  if (!/case 'toggle':[\s\S]{0,600}?(togglePlay\(\)|getUnifiedPlaybackState\(\))/.test(files.remoteCommand)) {
    reasons.push("remoteCommand.ts 的 'toggle' 未落到本 App 自己的播放语义（RNTP 的 toggle 按它自己的播放态判，nativeFlac 下会判错）")
  }
  if (!/case 'next':\s*\n\s*runNavCommand\(playNext\)/.test(files.remoteCommand)) {
    reasons.push("remoteCommand.ts 的 'next' 未走 runNavCommand(playNext)（缺少在途去重）")
  }
  if (!/case 'previous':\s*\n\s*runNavCommand\(playPrev\)/.test(files.remoteCommand)) {
    reasons.push("remoteCommand.ts 的 'previous' 未走 runNavCommand(playPrev)（缺少在途去重）")
  }
  // 切歌去重：两种实现都接受 —— ①旧的「在途布尔量」（复位时机依赖 Promise settle，有被
  // 永久锁死的风险，见 sim-remote-command-resilience）；②新的时间窗（推荐）。缺了就报。
  const hasInFlightGuard = /let navCommandInFlight = false/.test(files.remoteCommand) &&
    /if \(navCommandInFlight\) return/.test(files.remoteCommand)
  const hasWindowGuard = /NAV_COMMAND_DEDUP_MS/.test(files.remoteCommand) &&
    /now - lastNavCommandAt </.test(files.remoteCommand)
  if (!hasInFlightGuard && !hasWindowGuard) {
    reasons.push('remoteCommand.ts 缺「切歌去重」实现（车机重复投递会连跳两首）')
  }

  // ③ 原生通路必须完整：AppDelegate 挂 target + 发通知；UtilsModule 转发给 JS
  if (!/LXInstallRemoteCommandHandlers/.test(files.appDelegate) ||
    !/nextTrackCommand addTargetWithHandler/.test(files.appDelegate) ||
    !/previousTrackCommand addTargetWithHandler/.test(files.appDelegate)) {
    reasons.push('AppDelegate 未给 next/previousTrackCommand 挂 target（唯一通路缺失 → 车机切歌失效）')
  }
  if (!/LXPostRemoteCommandNotification\(command, nil\)/.test(files.appDelegate)) {
    reasons.push('AppDelegate 的遥控命令未通过 LXRemoteCommand 通知派发（JS 收不到）')
  }
  if (!/addListener\('remote-command'/.test(files.nativeUtils)) {
    reasons.push("nativeModules/utils.ts 未监听 'remote-command'（原生命令到不了 JS）")
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：一次物理按键会调用几次 playNext
// ---------------------------------------------------------------------------
const model = () => {
  const results = []
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail })

  // deliveries = 同一次物理按键被投递到 JS 的次数（两条通路各一次、或车机重复投递）
  const onePressCalls = ({ deliveries, inFlightGuard }) => {
    let calls = 0
    let inFlight = false
    for (let i = 0; i < deliveries; i++) {
      if (inFlightGuard) {
        if (inFlight) continue // 处理期间的同一次按键重复投递被忽略
        inFlight = true
      }
      calls++
    }
    return calls
  }

  check('改前：两条通路各投递一次 → 一次按键调用 2 次（跳两首 / 在少数几首间循环）',
    onePressCalls({ deliveries: 2, inFlightGuard: false }) === 2,
    `calls=${onePressCalls({ deliveries: 2, inFlightGuard: false })}`)
  check('改后：单通路（1 次投递）→ 只调用 1 次',
    onePressCalls({ deliveries: 1, inFlightGuard: true }) === 1,
    `calls=${onePressCalls({ deliveries: 1, inFlightGuard: true })}`)
  check('反例：车机把同一次按键重复投递 2 次且无在途去重 → 仍会调用 2 次（去重不能省）',
    onePressCalls({ deliveries: 2, inFlightGuard: false }) === 2,
    `calls=${onePressCalls({ deliveries: 2, inFlightGuard: false })}`)
  check('有在途去重时，同一次按键的重复投递被忽略 → 只调用 1 次',
    onePressCalls({ deliveries: 2, inFlightGuard: true }) === 1,
    `calls=${onePressCalls({ deliveries: 2, inFlightGuard: true })}`)
  return results
}

// ---------------------------------------------------------------------------
// 反例自检
// ---------------------------------------------------------------------------
const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.replace(find, replace)
}
const runCounterExamples = () => {
  const results = []
  const check = (name, files, expectSubstr) => {
    let reasons = []
    try {
      reasons = invariants(files)
    } catch (e) {
      results.push({ name, ok: false, detail: `抛异常: ${e.message}` })
      return
    }
    const hit = reasons.some(r => r.includes(expectSubstr))
    results.push({ name, ok: hit, detail: hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）` })
  }

  // C1 RNTP 通路复活（旧的双通路）
  check('C1 service.ts 重新监听 RemoteNext', readAll({
    service: tamper(read(FILES.service),
      '  TrackPlayer.addEventListener(TPEvent.RemoteStop, () => {',
      '  TrackPlayer.addEventListener(TPEvent.RemoteNext, () => { void playNext() })`n  TrackPlayer.addEventListener(TPEvent.RemoteStop, () => {'),
  }), '仍在监听 RemoteNext')

  // C2 唯一入口丢了 next 分支
  check('C2 remoteCommand.ts 删掉 next 分支', readAll({
    remoteCommand: tamper(read(FILES.remoteCommand),
      "      case 'next':\n        runNavCommand(playNext)\n        break\n", ''),
  }), "缺少 'next' 分支")

  // C3 去掉在途去重
  check('C3 切歌去掉在途去重', readAll({
    remoteCommand: tamper(read(FILES.remoteCommand),
      "      case 'next':\n        runNavCommand(playNext)",
      "      case 'next':\n        void playNext()"),
  }), '未走 runNavCommand(playNext)')

  // C4 原生通路不再派发
  check('C4 AppDelegate 不再派发遥控通知', readAll({
    appDelegate: tamper(read(FILES.appDelegate),
      'LXPostRemoteCommandNotification(command, nil)', 'noopRemoteCommand(command)'),
  }), '未通过 LXRemoteCommand 通知派发')

  return results
}

const realReasons = invariants(readAll())
const mm = model()
const ce = runCounterExamples()

console.log('=== sim-remote-command-single-source ===\n')
console.log('[源码不变量]')
if (realReasons.length === 0) {
  console.log('  PASS 遥控命令单通路：RNTP 只留 Duck/Stop，六种命令由原生 remote-command 唯一处理，切歌带去重')
} else realReasons.forEach(r => console.log('  FAIL ' + r))

console.log('\n[行为模型：一次按键调用几次 playNext]')
mm.forEach(r => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}   [${r.detail}]`))

console.log('\n[反例自检]')
ce.forEach(r => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name} —— ${r.detail}`))

const failed = realReasons.length + mm.filter(r => !r.ok).length + ce.filter(r => !r.ok).length
console.log(`\n结果：${failed ? `有 ${failed} 项失败` : 'ALL PASS'}（不变量 ${realReasons.length === 0 ? '1/1' : '有失败'}；模型 ${mm.filter(r => r.ok).length}/${mm.length}；反例 ${ce.filter(r => r.ok).length}/${ce.length}）`)
process.exit(failed ? 1 : 0)
