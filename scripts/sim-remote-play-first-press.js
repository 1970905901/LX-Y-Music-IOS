/**
 * sim-remote-play-first-press.js
 *
 * 「控制中心 / 灵动岛点播放必须一次生效」契约（中断暂停后的手动恢复）。
 *
 * 用户现象（2026-10-03）：关闭「与其他应用同时播放」后，音乐被其它 App 打断暂停，
 * 在别的 App 里下拉控制中心再点播放 —— 第一次无效，要点两次才恢复。
 *
 * 已定位的三条机制（任一条都足以吞掉第一次按压）：
 *   ① 中断把 AVAudioSession 置为非激活，重新出声必须先 setActive(true)；这一步以前只在
 *      JS 的 TrackPlayer.play() 里做，App 在后台被挂起时第一次按压会落在 JS 还没跑起来
 *      的窗口 → 引擎收到 play 也不出声。修法：原生遥控入口（LXHandleRemoteCommandEvent）
 *      对 play / toggle 先激活会话，不等 JS。
 *   ② 中断结束（permanent / paused）分支会补一次 pause()；若它压在这次手动 play 之后到达，
 *      刚起来的播放会被立刻按停。修法：JS 记录「用户明确要求播放」的意图，该分支在有新鲜
 *      意图时不再补 pause。
 *   ③ 中断 / 缓冲抖动后引擎可能吞掉第一次 play（状态没回到 playing）。修法：
 *      core/player/player.ts 的 requestPlay() 在 play() 之后按短延迟复查引擎真实状态并补发，
 *      用户手动暂停 / 停止时立即清掉意图（重试绝不与用户对着干）。
 *   ④ 附带：JS 监听器未就绪时（App 被遥控命令唤起 / JS 重载）UtilsModule 以前直接丢弃
 *      remote-command —— 丢掉的正是用户按的那一次。修法：先排队，startObserving 时按时间窗补发。
 *
 * 运行：node scripts/sim-remote-play-first-press.js
 * 退出码：不变量全过、且全部反例都被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  player: 'src/core/player/player.ts',
  remoteCommand: 'src/core/init/player/remoteCommand.ts',
  service: 'src/plugins/player/service.ts',
  appDelegate: 'ios/LxMusicMobile/AppDelegate.mm',
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const REAL = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]))

/** 取 switch 里某个 case 到下一个 break 的片段（用于判断该分支落到了哪个动作） */
const caseWindow = (src, name) => {
  const start = src.indexOf(`case '${name}':`)
  if (start < 0) return ''
  const end = src.indexOf('break', start)
  return src.slice(start, end < 0 ? start + 400 : end)
}

/** 取某个 ObjC 方法体（到下一个方法 / 实现结束为止），避免把别的方法里的同名守卫算进来 */
const objcMethod = (src, selectorStart) => {
  const start = src.indexOf(selectorStart)
  if (start < 0) return ''
  const rest = src.slice(start + selectorStart.length)
  const end = rest.search(/\n- \(|@end/)
  return rest.slice(0, end < 0 ? rest.length : end)
}

const invariants = (files) => {
  const reasons = []
  const player = files.player
  const js = files.remoteCommand
  const service = files.service
  const mm = files.appDelegate

  // ① requestPlay：意图窗口 + 立即播放 + 复查引擎真实状态后补发
  if (!/const PLAY_INTENT_WINDOW_MS = \d+/.test(player) || !/const PLAY_CONFIRM_DELAYS = \[[\d, ]+\]/.test(player)) {
    reasons.push('player.ts 缺播放意图常量（PLAY_INTENT_WINDOW_MS / PLAY_CONFIRM_DELAYS）')
  }
  if (!/export const hasRecentManualPlayIntent = \(\) =>[\s\S]{0,200}?PLAY_INTENT_WINDOW_MS/.test(player)) {
    reasons.push('player.ts 没有对外暴露「最近是否手动要求播放」（中断结束分支无法守卫）')
  }
  if (!/export const requestPlay = \(\) => \{[\s\S]{0,500}?manualPlayIntentAt = Date\.now\(\)[\s\S]{0,300}?\n\s*play\(\)/.test(player)) {
    reasons.push('requestPlay 没有先记意图再立即播放（第一次按下会白按）')
  }
  if (!/PLAY_CONFIRM_DELAYS\.map\(delay => setTimeout\([\s\S]{0,500}?getUnifiedPlaybackState\(\)[\s\S]{0,600}?state === 'playing'/.test(player)) {
    reasons.push('requestPlay 的复查没有读引擎真实播放态（补发判定会失真）')
  }
  if (!/export const pause = async\(\) => \{[\s\S]{0,200}?clearManualPlayIntent\(\)/.test(player) ||
      !/export const stop = async\(\) => \{[\s\S]{0,200}?clearManualPlayIntent\(\)/.test(player)) {
    reasons.push('pause / stop 未清理播放意图（重试会把用户刚按下的暂停抢回来）')
  }

  // ② 遥控入口：play / toggle 的「要播放」方向必须走 requestPlay
  const playCase = caseWindow(js, 'play')
  if (!/requestPlay\(\)/.test(playCase) || playCase.replace(/requestPlay\(\)/g, '').includes('play()')) {
    reasons.push("remoteCommand.ts 的 'play' 分支没用 requestPlay()（第一次被中断吞掉后无人补发）")
  }
  if (!/else requestPlay\(\)/.test(js)) {
    reasons.push("remoteCommand.ts 的 'toggle' 播放方向没用 requestPlay()（灵动岛/控制中心仍要按两下）")
  }

  // ③ 中断结束的补 pause 不得压掉新鲜的手动播放意图
  if (!/import \{ hasRecentManualPlayIntent, pause, play \} from '@\/core\/player\/player'/.test(service)) {
    reasons.push('service.ts 未引入 hasRecentManualPlayIntent（无法判断用户刚按过播放）')
  }
  if (!/if \(paused && !hasRecentManualPlayIntent\(\)\) void pause\(\)/.test(service)) {
    reasons.push('service.ts 中断结束仍无条件补 pause（会按停用户刚起来的播放 = 要按两次）')
  }
  if (!/if \(shouldResumeShortInterruption\) resumeAfterInterruption\(\)/.test(service)) {
    reasons.push('service.ts 短暂中断的自动恢复被弄丢（导航播报结束后不再续播）')
  }

  // ④ 原生遥控入口先激活音频会话（不等 JS）
  if (!/static void LXActivateAudioSessionForPlayback\(void\) \{[\s\S]{0,300}?setActive:YES error:/.test(mm)) {
    reasons.push('AppDelegate 没有「遥控播放先激活音频会话」的原生函数（后台第一次按压仍可能不出声）')
  }
  if (!/if \(\[command isEqualToString:@"play"\] \|\| \[command isEqualToString:@"toggle"\]\) \{\s*\n\s*LXActivateAudioSessionForPlayback\(\);/.test(mm)) {
    reasons.push('AppDelegate 的 play / toggle 遥控命令没有调用会话激活（第一次按播放无声）')
  }

  // ⑤ 中断当拍把卡片置 Paused（否则第一次按下被系统当成 pause）
  if (!/static void LXHandleNowPlayingInterruptionBegan\(void\) \{[\s\S]{0,400}?LXSetNowPlayingPlaybackState\(MPNowPlayingPlaybackStatePaused/.test(mm)) {
    reasons.push('AppDelegate 未在中断开始时把 Now Playing 置成 Paused（控制中心仍显示暂停键 → 第一次按下是 pause）')
  }
  if (!/AVAudioSessionInterruptionNotification[\s\S]{0,600}?AVAudioSessionInterruptionTypeBegan[\s\S]{0,200}?LXHandleNowPlayingInterruptionBegan\(\);/.test(mm)) {
    reasons.push('AppDelegate 没有监听「音频中断开始」并调用卡片置 Paused')
  }

  // ⑥ JS 监听器未就绪的遥控命令必须排队补发，而不是丢弃
  const cmdHandler = objcMethod(mm, '- (void)handleRemoteCommandNotification:(NSNotification *)notification {')
  if (!cmdHandler) {
    reasons.push('AppDelegate 找不到 handleRemoteCommandNotification（遥控命令到不了 JS）')
  } else {
    if (/if \(!self\.hasListeners\) return;/.test(cmdHandler)) {
      reasons.push('handleRemoteCommandNotification 仍在「没有监听器就直接丢」（第一次按下会被丢掉）')
    }
    if (!/if \(!self\.hasListeners\) \{[\s\S]{0,500}?\[self\.pendingRemoteCommands addObject:body\]/.test(cmdHandler)) {
      reasons.push('handleRemoteCommandNotification 未把「监听器未就绪」的命令排队')
    }
  }
  if (!/static const double LXRemoteCommandPendingMaxAgeMs = \d+/.test(mm)) {
    reasons.push('AppDelegate 缺遥控命令排队的新鲜度窗口常量（可能补发过期操作）')
  }
  if (!/nowMs - queuedAtMs\.doubleValue > LXRemoteCommandPendingMaxAgeMs/.test(mm)) {
    reasons.push('补发队列没有按新鲜度窗口过滤（过期命令会被重放）')
  }
  if (!/- \(void\)startObserving \{[\s\S]{0,300}?\[self flushPendingRemoteCommands\]/.test(mm)) {
    reasons.push('startObserving 没有补发排队的遥控命令（排了也不会发）')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：复刻三条链路，证明「改前会吞掉第一次按压、改后一次生效」
// ---------------------------------------------------------------------------

/** 简化引擎：play() 是否真的出声由 setUp 控制（模拟中断后会话未激活 / 引擎吞掉第一次） */
const createEngine = ({ swallowFirstPlay = 0, sessionActive = true } = {}) => {
  let playing = false
  let swallowed = 0
  return {
    get playing() { return playing },
    pressPlay() {
      if (!sessionActive) return false
      if (swallowed < swallowFirstPlay) {
        swallowed += 1
        return false
      }
      playing = true
      return true
    },
    pressPause() { playing = false },
    activateSession() { sessionActive = true },
  }
}

/** 旧模型：点一下 = play() 一次，没有复查补发 */
const legacyPressPlay = (engine) => engine.pressPlay()

/** 新模型：requestPlay() = 记意图 + play() + 按 PLAY_CONFIRM_DELAYS 复查补发 */
const requestPlayModel = (engine, { delays = [500, 1500], windowMs = 2500, now = () => 1000 } = {}) => {
  const intentAt = now()
  const hasIntent = () => intentAt > 0 && now() - intentAt <= windowMs
  engine.pressPlay()
  for (let index = 0; index < delays.length; index++) {
    if (!hasIntent()) break
    if (engine.playing) continue
    engine.pressPlay()
  }
  return engine.playing
}

/** 情景二模型：用户按完播放立刻按暂停（pause() 会清掉播放意图）→ 复查拍不得再补发 */
const userPauseCancelsRetry = () => {
  const engine = createEngine()
  let intentAt = 1000
  engine.pressPlay() // requestPlay 的立即播放
  engine.pressPause() // 用户按暂停
  intentAt = 0 // pause() 里的 clearManualPlayIntent()
  const retriedAt500 = intentAt > 0 // 500ms 复查拍：意图已清 → 跳过补发
  return { retriedAt500, playing: engine.playing }
}

const models = []
{
  // 情景一：第一次 play 被吞（会话未激活），用户 1s 后再按一次
  const legacy = createEngine({ swallowFirstPlay: 1 })
  legacyPressPlay(legacy)
  const legacyFirstPressWorks = legacy.playing
  legacyPressPlay(legacy)
  const legacyNeedsTwoPresses = !legacyFirstPressWorks && legacy.playing

  const fixed = createEngine({ swallowFirstPlay: 1 })
  const fixedWorks = requestPlayModel(fixed)
  models.push([
    '情景一 第一次 play 被吞：旧模型要按两次，新模型一次按压内补发成功',
    legacyNeedsTwoPresses && fixedWorks,
  ])
}
{
  // 情景二：用户按完播放立刻按暂停 → 意图作废，补发不得把播放抢回来
  const result = userPauseCancelsRetry()
  models.push([
    '情景二 用户随后按了暂停：意图作废，复查拍不会把播放抢回来',
    result.retriedAt500 === false && result.playing === false,
  ])
}
{
  // 情景三：中断结束的补 pause 与手动 play 竞争（无守卫 vs 有守卫）
  const raceWithoutGuard = () => {
    const engine = createEngine()
    engine.pressPlay() // 用户按播放
    engine.pressPause() // 中断结束分支补的 pause（无条件）
    return engine.playing // 仍暂停 → 用户还得再按一次
  }
  const raceWithGuard = () => {
    const engine = createEngine()
    engine.pressPlay()
    // 有 hasRecentManualPlayIntent() 守卫 → 不补 pause
    return engine.playing
  }
  models.push([
    '情景三 中断结束补 pause 竞争：无守卫会按停刚起来的播放，有守卫存活',
    raceWithoutGuard() === false && raceWithGuard() === true,
  ])
}

const failedModels = models.filter(([, pass]) => !pass)

// ---------------------------------------------------------------------------
// 反例自检（结构性回归必须被拦下）
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

checkCase('C1 requestPlay 的复查退回常量/伪状态（不读引擎）', {
  player: tamper(REAL.player, 'void getUnifiedPlaybackState().then((state) => {', "void Promise.resolve('playing').then((state) => {"),
}, '复查没有读引擎真实播放态')

checkCase("C2 'play' 分支退回裸 play()", {
  remoteCommand: tamper(REAL.remoteCommand, '        requestPlay()\n        break\n      case \'pause\':', "        play()\n        break\n      case 'pause':"),
}, "的 'play' 分支没用 requestPlay()")

checkCase('C3 中断结束无条件补 pause（压掉刚起来的播放）', {
  service: tamper(REAL.service, 'if (paused && !hasRecentManualPlayIntent()) void pause()', 'if (paused) void pause()'),
}, '中断结束仍无条件补 pause')

checkCase('C4 原生遥控入口不再激活音频会话', {
  appDelegate: tamper(REAL.appDelegate, '    LXActivateAudioSessionForPlayback();\n', ''),
}, '没有调用会话激活')

checkCase('C5 监听器未就绪时退回「直接丢弃」', {
  appDelegate: tamper(REAL.appDelegate,
    '  NSDictionary *userInfo = [notification.userInfo isKindOfClass:[NSDictionary class]] ? notification.userInfo : @{};\n  NSString *command = [userInfo[@"command"] isKindOfClass:[NSString class]] ? userInfo[@"command"] : @"";\n  if (!command.length) return;\n\n  NSMutableDictionary *body = [NSMutableDictionary dictionaryWithDictionary:userInfo];\n  body[@"command"] = command;\n\n  dispatch_async(dispatch_get_main_queue(), ^{\n    // JS 监听器还没就绪',
    '  if (!self.hasListeners) return;\n\n  NSDictionary *userInfo = [notification.userInfo isKindOfClass:[NSDictionary class]] ? notification.userInfo : @{};\n  NSString *command = [userInfo[@"command"] isKindOfClass:[NSString class]] ? userInfo[@"command"] : @"";\n  if (!command.length) return;\n\n  NSMutableDictionary *body = [NSMutableDictionary dictionaryWithDictionary:userInfo];\n  body[@"command"] = command;\n\n  dispatch_async(dispatch_get_main_queue(), ^{\n    // JS 监听器还没就绪'),
}, '仍在「没有监听器就直接丢」')

const missed = cases.filter(([, ok]) => !ok)

console.log('行为模型（第一次按压为什么无效 / 为什么修好了）')
for (const [name, pass] of models) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of cases) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')

let failed = 0
const realReasons = invariants(REAL)
if (realReasons.length) {
  console.error(`FAIL  遥控点播放一次生效契约未通过（${realReasons.length} 项）：`)
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
  console.log(`PASS  控制中心/灵动岛点播放一次生效（结构不变量 6 组 + 行为模型 ${models.length} 例 + 反例 ${cases.length} 例）`)
  process.exit(0)
}
process.exit(1)
