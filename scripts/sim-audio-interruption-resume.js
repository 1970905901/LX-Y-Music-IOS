/**
 * sim-audio-interruption-resume.js
 *
 * 「系统音频中断结束后恢复播放」契约（车机蓝牙 + 导航播报场景）。
 *
 * 用户现象（2026-10-03）：开着车机蓝牙 + 高德播报时，高德一说话音乐就停、播报结束也不恢复；
 * 不连蓝牙（外放）时高德只 duck（音量压小）不停播，所以看起来正常。
 *
 * 根因（三条，缺任一条都可能复现）：
 *   ① JS 侧只在「中断开始」按当时的 playerState.isPlay 记恢复意图。蓝牙场景下 iOS 会同时
 *      发路由变化（车机 A2DP→HFP）与音频中断两个信号，谁先到 JS 不确定；只要播放态先被
 *      前一条通路置成暂停，记下来的意图就是 false，中断结束就永远不恢复。
 *   ② 原生「耳机拔出」判定只看旧路由：车机 A2DP→HFP 会被误判成耳机拔出 → 暂停播放，
 *      且此后没有任何恢复时机。
 *   ③ RNTP 原生侧在「中断结束通知缺 AVAudioSessionInterruptionOptionKey」时直接 return，
 *      连事件都不发 → JS 根本收不到「中断结束」，无从恢复。
 *
 * 所以本脚本三层断言（源码级不变量，反例必须被拦下）：
 *   ① src/plugins/player/service.ts —— 恢复意图带「最近在播」时间窗、恢复带重试、
 *      短暂中断（permanent）也恢复、清意图只挂 'stop' 不挂 'pause'；
 *   ② ios/LxMusicMobile/AppDelegate.mm —— 路由变化判定同时看新路由，仍落在耳机/蓝牙上
 *      就不算拔出；
 *   ③ dependencies-patch.js —— 中断结束事件缺省 0（照发事件，不吞掉）。
 *
 * 运行：node scripts/sim-audio-interruption-resume.js
 * 退出码：不变量全过、且 3 例反例都被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SERVICE = 'src/plugins/player/service.ts'
const APP_DELEGATE = 'ios/LxMusicMobile/AppDelegate.mm'
const PATCHER = 'dependencies-patch.js'

// 归一化行尾：同仓库 LF/CRLF 混存，多行锚点不归一就会假失败
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n')

const SERVICE_SRC = read(SERVICE)
const APP_DELEGATE_SRC = read(APP_DELEGATE)
const PATCHER_SRC = read(PATCHER)

/** 对给定源码跑全部不变量，返回失败项列表 */
function invariants({ service, appDelegate, patcher }) {
  const failures = []
  const check = (name, ok) => { if (!ok) failures.push(name) }

  // ① JS 侧恢复意图与恢复动作
  check(
    '恢复意图带「最近在播」时间窗常量',
    /const RESUME_INTENT_WINDOW_MS = \d+/.test(service) &&
      /const wasRecentlyPlaying = \(\) =>[\s\S]{0,240}?RESUME_INTENT_WINDOW_MS/.test(service),
  )
  check(
    '中断开始用 wasRecentlyPlaying() 记恢复意图（不再只看 playerState.isPlay）',
    /if \(paused\) \{[\s\S]{0,500}?shouldResumeAfterDuck = wasRecentlyPlaying\(\)/.test(service),
  )
  check(
    '恢复带重试（RESUME_RETRY_DELAYS）',
    /const RESUME_RETRY_DELAYS = \[[\d, ]+\]/.test(service) &&
      /const resumeAfterInterruption = \(\) => \{[\s\S]{0,700}?RESUME_RETRY_DELAYS\.map\(delay => setTimeout\(attempt, delay\)\)/.test(service),
  )
  check(
    'permanent（无 shouldResume）时短暂中断仍恢复',
    /SHORT_INTERRUPTION_MAX_MS/.test(service) &&
      /if \(shouldResumeShortInterruption\) resumeAfterInterruption\(\)/.test(service),
  )
  check(
    '清恢复意图只挂 stop（挂 pause 会把中断自身的暂停当成用户暂停，永远不恢复）',
    /global\.app_event\.on\('stop', \(\) => \{/.test(service) &&
      !/global\.app_event\.on\('pause'/.test(service),
  )

  // ② 原生路由判定：A2DP→HFP 不算耳机拔出
  check(
    '原生抽出 isPrivateOutputRoute:（耳机/蓝牙输出判定）',
    /- \(BOOL\)isPrivateOutputRoute:\(AVAudioSessionRouteDescription \*\)route \{/.test(appDelegate),
  )
  check(
    '路由变化同时看新路由：新路由仍是耳机/蓝牙输出则不发 headphones-disconnected',
    /shouldEmitHeadphonesDisconnectedForPreviousRoute:\(AVAudioSessionRouteDescription \*\)previousRoute currentRoute:\(AVAudioSessionRouteDescription \*\)currentRoute \{[\s\S]{0,1200}?if \(\[self isPrivateOutputRoute:currentRoute\]\) return NO;/.test(appDelegate) &&
      /shouldEmitHeadphonesDisconnectedForPreviousRoute:previousRoute currentRoute:currentRoute/.test(appDelegate),
  )

  // ③ RNTP 补丁：中断结束事件缺省 0，照发不吞
  check(
    'RNTP「中断结束」缺 options 时补丁为 ?? 0（事件照发）',
    /userInfo\[AVAudioSessionInterruptionOptionKey\] as\? UInt \?\? 0/.test(patcher) &&
      /guard let optionsValue =/.test(patcher),
  )

  return failures
}

const real = invariants({ service: SERVICE_SRC, appDelegate: APP_DELEGATE_SRC, patcher: PATCHER_SRC })

// 反例：篡改后的源码必须被同一套不变量拦下（否则断言没有区分力）
const counterexamples = [
  {
    name: 'service 把清意图挂到 pause 上（= 旧逻辑：中断暂停会被当成用户暂停）',
    mutated: {
      service: SERVICE_SRC.replace("global.app_event.on('stop', () => {", "global.app_event.on('pause', () => {"),
    },
  },
  {
    name: 'service 把恢复意图退回只看 playerState.isPlay',
    mutated: {
      service: SERVICE_SRC.replace('shouldResumeAfterDuck = wasRecentlyPlaying()', 'shouldResumeAfterDuck = playerState.isPlay'),
    },
  },
  {
    name: 'AppDelegate 去掉「新路由仍是耳机/蓝牙就不算拔出」门控',
    mutated: {
      appDelegate: APP_DELEGATE_SRC.replace('  if ([self isPrivateOutputRoute:currentRoute]) return NO;\n', ''),
    },
  },
  {
    name: 'dependencies-patch 去掉中断结束事件的 ?? 0 兜底（事件会被吞掉）',
    mutated: {
      patcher: PATCHER_SRC.replace(' as? UInt ?? 0', ' as? UInt'),
    },
  },
]

const missed = []
for (const { name, mutated } of counterexamples) {
  const failures = invariants({
    service: mutated.service ?? SERVICE_SRC,
    appDelegate: mutated.appDelegate ?? APP_DELEGATE_SRC,
    patcher: mutated.patcher ?? PATCHER_SRC,
  })
  if (!failures.length) missed.push(name)
  else console.log(`PASS  反例被拦下：${name}`)
}

console.log()
if (real.length) {
  console.error(`FAIL  不变量未通过（${real.length} 项）：`)
  for (const f of real) console.error(`        - ${f}`)
}
if (missed.length) {
  console.error(`FAIL  反例未被拦下（${missed.length} 项，断言无区分力）：`)
  for (const f of missed) console.error(`        - ${f}`)
}
if (!real.length && !missed.length) {
  console.log('PASS  音频中断恢复契约全部通过（3 组不变量 + 4 例反例）')
  process.exit(0)
}
process.exit(1)
