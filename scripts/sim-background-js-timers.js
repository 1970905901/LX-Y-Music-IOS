/**
 * sim-background-js-timers.js
 *
 * 「后台定时器」契约（耗电盘点 2026-10-03）。
 *
 * 背景：本 App 带 audio 后台模式，播放中即使锁屏 App 仍存活、JS 线程照常跑**普通
 * JS 定时器**（普通 setInterval 不申请后台任务断言，但每秒唤醒 JS 线程本身仍是净耗电）；
 * 而 react-native-background-timer 的每个 setTimeout/setInterval 都会调
 * `beginBackgroundTaskWithName:` 申请后台任务断言 —— 在**必须**扛住系统挂起的窗口里
 * 这是唯一正确选择，在**不需要**的场合（失败保护 / 纯 UI 提示）就是白白的阻止挂起。
 *
 * 本契约绑两件事：
 *   ① 只在有 UI 时才需要的轮询/刷新表，退后台必须停（playProgress 1s 慢校准、
 *      timeoutExit 1s 倒计时）；
 *   ② BackgroundTimer 逐处体检结论：需要扛挂起的（睡眠定时到期、延迟切歌、加载/缓冲
 *      看门狗、切歌延时、进度/列表落盘节流、锁屏元数据去抖）继续用 BackgroundTimer；
 *      纯失败保护 / 纯 UI 的（换源搜索超时、自定义源请求超时、同步请求 abort、缓存迁移
 *      提示 toast）降级为普通 setTimeout。
 *
 * 另：原生 `screen-state` 事件本轮已按「死代码」删除（原生无发送方、JS 旧封装还写着
 * `if (isIOS) return () => {}`），屏幕/前台状态统一以 AppState 为准——契约同时守住
 * 「不得再出现 screen-state / isScreenOn 残留」。
 *
 * 运行：node scripts/sim-background-js-timers.js
 * 退出码：不变量全过、且全部反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  playProgress: 'src/core/init/player/playProgress.ts',
  timeoutExit: 'src/core/player/timeoutExit.ts',
  musicUtils: 'src/core/music/utils.ts',
  userApi: 'src/core/init/userApi/index.ts',
  syncClient: 'src/plugins/sync/client/utils.ts',
  playerUtils: 'src/plugins/player/utils.ts',
  playerCore: 'src/core/player/player.ts',
  controller: 'src/plugins/player/controller.ts',
  tools: 'src/utils/tools.ts',
  playList: 'src/plugins/player/playList.ts',
  utilsModule: 'src/utils/nativeModules/utils.ts',
  delegate: 'ios/LxMusicMobile/AppDelegate.mm',
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const REAL = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]))

const invariants = (f) => {
  const reasons = []

  // ① playProgress：退后台停 1s 慢校准表；回前台恢复并重锚
  if (!/state == 'background' && isAppForeground\)\s*handleAppForegroundChanged\(false\)/.test(f.playProgress)) {
    reasons.push('playProgress 退后台未停 1s 慢校准表（后台每秒唤醒 JS，body 首行即 return）')
  }
  if (!/if \(state == 'active'\) \{[\s\S]{0,140}?handleAppForegroundChanged\(true\)/.test(f.playProgress)) {
    reasons.push('playProgress 回前台未恢复慢校准/重锚（进度与歌词会停在后台期间的位置）')
  }

  // ② timeoutExit：倒计时刷新表按「前台 + 有 UI 订阅 + 定时中」门控，到期仍走 BackgroundTimer
  if (!/const wanted = this\.appActive && this\.timeHooks\.length > 0 && this\.mode == 'timer'/.test(f.timeoutExit)) {
    reasons.push('timeoutExit 1s 倒计时表未按「前台 + 有 UI 订阅 + 定时中」门控')
  }
  if (!/this\.bgTimeout = BackgroundTimer\.setTimeout\(/.test(f.timeoutExit)) {
    reasons.push('timeoutExit 睡眠定时到期未用 BackgroundTimer.setTimeout（后台会被冻结，定时退不出）')
  }
  const intervalCount = (f.timeoutExit.match(/setInterval\(/g) ?? []).length
  if (intervalCount !== 1) {
    reasons.push(`timeoutExit 里 setInterval 出现 ${intervalCount} 次（应只有 syncHooksTimer 内那一处）`)
  }
  if (!/AppState\.addEventListener\('change'[\s\S]{0,400}?timeoutTools\.syncHooksTimer\(\)/.test(f.timeoutExit)) {
    reasons.push('timeoutExit 未在前后台切换时同步倒计时表')
  }

  // ③ 降级清单：纯失败保护 / 纯 UI → 不得再用 BackgroundTimer
  for (const [key, label] of [
    ['musicUtils', '换源搜索 12s 超时'],
    ['userApi', '自定义源请求 20s 超时'],
    ['syncClient', '同步请求超时 abort'],
  ]) {
    // 只看真实调用（注释里会提到 BackgroundTimer，不能误报）
    if (/BackgroundTimer\./.test(f[key])) {
      reasons.push(`${label}（${FILES[key]}）仍在用 BackgroundTimer（失败保护无需扛挂起，白占后台断言）`)
    }
  }
  if (!/migratePlayerCache[\s\S]{0,600}?let timeout: ReturnType<typeof setTimeout> \| null = setTimeout\(/.test(f.playerUtils)) {
    reasons.push('缓存迁移提示 toast 未降级为普通 setTimeout（纯 UI 提示无需后台唤醒）')
  }

  // ④ 保留清单：必须扛住系统挂起的窗口 → 必须仍是 BackgroundTimer
  for (const [key, pattern, label] of [
    ['playerCore', /timeout = BackgroundTimer\.setTimeout\(/, '歌曲结束后的延迟切歌（此时音频已停，App 可能被挂起）'],
    ['controller', /loadingTimeout = BackgroundTimer\.setTimeout\(/, '加载看门狗（无音频输出时可能被挂起）'],
    ['playProgress', /mediaBuffer\.timeout = BackgroundTimer\.setTimeout\(/, '缓冲看门狗（缓冲中无音频输出，可能被挂起）'],
    ['playList', /timer = BackgroundTimer\.setTimeout\(/, '锁屏元数据/歌词去抖（丢失会让控制中心停在旧信息）'],
    ['tools', /timer = BackgroundTimer\.setTimeout\(/, '进度/列表落盘节流（丢失会丢数据）'],
  ]) {
    if (!pattern.test(f[key])) reasons.push(`${label} 不再使用 BackgroundTimer（${FILES[key]}）`)
  }

  // ⑤ 死代码不得复活：screen-state / isScreenOn / onScreenStateChange
  if (/screen-state|onScreenStateChange/.test(f.utilsModule) ||
      /@"screen-state"/.test(f.delegate) ||
      /isScreenOn|handleScreenStateChanged/.test(f.playProgress)) {
    reasons.push('screen-state 死链路残留（原生无发送方 + iOS 订阅是空实现，状态应以 AppState 为准）')
  }

  return reasons
}

const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.split(find).join(replace)
}

const counterExamples = () => {
  const results = []
  const check = (name, mutated, expectSubstr) => {
    let reasons = []
    try {
      reasons = invariants({ ...REAL, ...mutated })
    } catch (e) {
      results.push({ name, ok: false, detail: `抛异常: ${e.message}` })
      return
    }
    const hit = reasons.some((r) => r.includes(expectSubstr))
    results.push({ name, ok: hit, detail: hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）` })
  }

  check('R1 退后台不停表（回到旧行为）', {
    playProgress: tamper(REAL.playProgress, "if (state == 'background' && isAppForeground) handleAppForegroundChanged(false)", ''),
  }, '退后台未停 1s 慢校准表')

  check('R2 倒计时表去掉前台门', {
    timeoutExit: tamper(REAL.timeoutExit, "const wanted = this.appActive && this.timeHooks.length > 0 && this.mode == 'timer'", "const wanted = this.timeHooks.length > 0 && this.mode == 'timer'"),
  }, '未按「前台 + 有 UI 订阅 + 定时中」门控')

  check('R3 睡眠定时到期改普通 setTimeout（后台冻死）', {
    timeoutExit: tamper(REAL.timeoutExit, 'this.bgTimeout = BackgroundTimer.setTimeout(', 'this.bgTimeout = setTimeout('),
  }, '睡眠定时到期未用 BackgroundTimer')

  check('R4 同步请求超时升回 BackgroundTimer（白占断言）', {
    syncClient: tamper(REAL.syncClient, 'let id: ReturnType<typeof setTimeout> | null = setTimeout(() => {', 'let id: ReturnType<typeof setTimeout> | null = BackgroundTimer.setTimeout(() => {'),
  }, '仍在用 BackgroundTimer')

  check('R5 延迟切歌降级为普通 setTimeout（音频已停会被挂起）', {
    playerCore: tamper(REAL.playerCore, 'timeout = BackgroundTimer.setTimeout(', 'timeout = setTimeout('),
  }, '不再使用 BackgroundTimer')

  check('R6 screen-state 死代码复活', {
    utilsModule: REAL.utilsModule + '\nexport const onScreenStateChange = () => {}\n',
  }, 'screen-state 死链路残留')

  check('R7 另加一颗常驻 setInterval', {
    timeoutExit: tamper(REAL.timeoutExit, 'const timeoutTools = {', 'const timeoutTools = {\n  extraTimer: setInterval(() => {}, 1000),'),
  }, 'setInterval 出现 2 次')

  return results
}

const realReasons = invariants(REAL)
const counterResults = counterExamples()
const missed = counterResults.filter((r) => !r.ok)

for (const r of counterResults) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  反例：${r.name} —— ${r.detail}`)
}
console.log()

if (realReasons.length) {
  console.error(`FAIL  后台定时器契约不变量未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
if (missed.length) {
  console.error(`FAIL  反例未被拦下（${missed.length} 项，断言无区分力）`)
}
if (!realReasons.length && !missed.length) {
  console.log('PASS  后台定时器契约全部通过（5 组不变量 + 7 例反例）')
  process.exit(0)
}
process.exit(1)

