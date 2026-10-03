/**
 * sim-background-js-timers.js
 *
 * 「后台不得空转 JS 定时器」契约（耗电盘点 2026-10-03 新增）。
 *
 * 背景：本 App 带 audio 后台模式，播放中即使锁屏，App 仍存活、JS 线程照常跑**普通
 * JS 定时器**（只有 react-native-background-timer 那套才申请后台任务断言，普通
 * setInterval 不会，但每秒唤醒 JS 线程本身仍是净耗电）。前几轮已把
 * plugins/player/hook.ts 的 useProgress / useBufferProgress 与
 * core/init/player/playProgress.ts 的 1s 慢校准补上前台门；本轮盘出两处仍在后台空转：
 *
 *   ① playProgress.ts 的 1s 慢校准表只在「回前台」时被恢复，退后台却不停表
 *      （tick body 首行 AppState 早退 → 每秒一次纯唤醒）。
 *   ② core/player/timeoutExit.ts 的睡眠定时倒计时表：一经 start 就每秒 callHooks()，
 *      直到定时结束——睡眠定时动辄几十分钟～24 小时，锁屏整段时间每秒唤醒一次 JS。
 *      到期本身由 BackgroundTimer.setTimeout 负责，倒计时数值由 performance.now()
 *      派生（停表不漂移），所以刷新表完全可以只在「前台 + 有 UI 订阅」时运行。
 *
 * 运行：node scripts/sim-background-js-timers.js
 * 退出码：不变量全过、且全部反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const PLAY_PROGRESS = 'src/core/init/player/playProgress.ts'
const TIMEOUT_EXIT = 'src/core/player/timeoutExit.ts'
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const REAL = {
  playProgress: read(PLAY_PROGRESS),
  timeoutExit: read(TIMEOUT_EXIT),
}

const invariants = ({ playProgress, timeoutExit }) => {
  const reasons = []

  // ① 退后台必须停掉 1s 慢校准表（AppState 'background' → 等价熄屏 → handleScreenStateChanged('OFF')）
  if (!/state == 'background' && isScreenOn\)\s*handleScreenStateChanged\('OFF'\)/.test(playProgress)) {
    reasons.push('playProgress 退后台未停 1s 慢校准表（后台每秒唤醒 JS，body 首行即 return）')
  }
  if (!/if \(state == 'active'\) \{[\s\S]{0,120}?handleScreenStateChanged\('ON'\)/.test(playProgress)) {
    reasons.push('playProgress 回前台未恢复慢校准/重锚（进度与歌词会停在后台期间的位置）')
  }

  // ② 倒计时刷新表必须按「前台 + 有 UI 订阅 + 定时中」门控
  if (!/const wanted = this\.appActive && this\.timeHooks\.length > 0 && this\.mode == 'timer'/.test(timeoutExit)) {
    reasons.push('timeoutExit 1s 倒计时表未按「前台 + 有 UI 订阅 + 定时中」门控')
  }
  // 起表点必须唯一且在 syncHooksTimer 内（否则等于又出现一颗常驻表）
  const intervalCount = (timeoutExit.match(/setInterval\(/g) ?? []).length
  if (intervalCount !== 1) {
    reasons.push(`timeoutExit 里 setInterval 出现 ${intervalCount} 次（应只有 syncHooksTimer 内那一处）`)
  }
  if (!/syncHooksTimer\(\) \{[\s\S]{0,900}?this\.hooksTimer = setInterval\(/.test(timeoutExit)) {
    reasons.push('timeoutExit 的 setInterval 不在 syncHooksTimer 内（缺少统一门控入口）')
  }
  for (const [anchor, label] of [
    [/start\(time: number\) \{[\s\S]{0,900}?this\.syncHooksTimer\(\)/, 'start'],
    [/clearTimer\(resetMode = true\) \{[\s\S]{0,500}?this\.syncHooksTimer\(\)/, 'clearTimer'],
    [/addTimeHook\(hook: Hook\) \{[\s\S]{0,200}?this\.syncHooksTimer\(\)/, 'addTimeHook'],
    [/removeTimeHook\(hook: Hook\) \{[\s\S]{0,300}?this\.syncHooksTimer\(\)/, 'removeTimeHook'],
  ]) {
    if (!anchor.test(timeoutExit)) reasons.push(`timeoutExit ${label} 未同步倒计时表状态`)
  }
  // 到期必须仍走 BackgroundTimer（普通 setTimeout 在后台会被冻结 → 定时退不出）
  if (!/this\.bgTimeout = BackgroundTimer\.setTimeout\(/.test(timeoutExit)) {
    reasons.push('timeoutExit 到期定时未用 BackgroundTimer.setTimeout（后台会被冻结）')
  }
  // 前后台切换要驱动上面这套门控
  if (!/AppState\.addEventListener\('change'[\s\S]{0,400}?timeoutTools\.syncHooksTimer\(\)/.test(timeoutExit)) {
    reasons.push('timeoutExit 未在前后台切换时同步倒计时表')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 反例自检（篡改后必须被拦下）
// ---------------------------------------------------------------------------
const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.split(find).join(replace)
}

const counterExamples = () => {
  const results = []
  const check = (name, mutated, expectSubstr) => {
    let reasons = []
    try {
      reasons = invariants({ playProgress: REAL.playProgress, timeoutExit: REAL.timeoutExit, ...mutated })
    } catch (e) {
      results.push({ name, ok: false, detail: `抛异常: ${e.message}` })
      return
    }
    const hit = reasons.some((r) => r.includes(expectSubstr))
    results.push({ name, ok: hit, detail: hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）` })
  }

  check('R1 退后台不停表（回到旧行为）', {
    playProgress: tamper(REAL.playProgress, "if (state == 'background' && isScreenOn) handleScreenStateChanged('OFF')", ''),
  }, '退后台未停 1s 慢校准表')

  check('R2 倒计时表去掉前台门', {
    timeoutExit: tamper(REAL.timeoutExit, 'const wanted = this.appActive && this.timeHooks.length > 0 && this.mode == \'timer\'', 'const wanted = this.timeHooks.length > 0 && this.mode == \'timer\''),
  }, '未按「前台 + 有 UI 订阅 + 定时中」门控')

  check('R3 倒计时表去掉订阅门（没人看也每秒跑）', {
    timeoutExit: tamper(REAL.timeoutExit, 'const wanted = this.appActive && this.timeHooks.length > 0 && this.mode == \'timer\'', 'const wanted = this.appActive && this.mode == \'timer\''),
  }, '未按「前台 + 有 UI 订阅 + 定时中」门控')

  check('R4 到期定时改回普通 setTimeout（后台冻死）', {
    timeoutExit: tamper(REAL.timeoutExit, 'this.bgTimeout = BackgroundTimer.setTimeout(', 'this.bgTimeout = setTimeout('),
  }, '未用 BackgroundTimer.setTimeout')

  check('R5 另加一颗常驻 setInterval', {
    timeoutExit: tamper(REAL.timeoutExit, 'const timeoutTools = {', 'const timeoutTools = {\n  extraTimer: setInterval(() => {}, 1000),'),
  }, 'setInterval 出现 2 次')

  return results
}

// ---------------------------------------------------------------------------
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
  console.log('PASS  后台 JS 定时器契约全部通过（5 组不变量 + 5 例反例）')
  process.exit(0)
}
process.exit(1)
