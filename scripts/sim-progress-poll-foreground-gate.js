/**
 * useProgress 进度轮询的「App 前台门」—— 耗电契约（2026-10-03）。
 *
 * 背景：src/plugins/player/hook.ts 里的 useProgress 每秒做 3 次原生桥往返
 * （getPosition / getDuration / getBufferedPosition，nativeFlac 路径同样是 3 次）
 * 再 setState，**且原本没有任何前台门**——App 退到后台（锁屏常驻播放是本 App 的
 * 主场景）时它照样每秒唤醒 JS 线程。同文件的 useBufferProgress 与
 * core/init/player/playProgress.ts 都有前台门，唯独它漏了。
 *
 * 这类问题不会崩、也过得了 tsc/eslint（少一个门控只表现为「多耗电」），
 * 只能靠契约绑住。运行：node scripts/sim-progress-poll-foreground-gate.js
 * 退出码：不变量全过、且全部反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const HOOK = 'src/plugins/player/hook.ts'
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const real = read(HOOK)

/** 取 useProgress 的函数体（到 useBufferProgress 为止）：同名工具函数不得互相顶包 */
const sliceUseProgress = (src) => {
  const at = src.indexOf('export function useProgress')
  if (at < 0) return ''
  const end = src.indexOf('export function useBufferProgress', at)
  return end > at ? src.slice(at, end) : src.slice(at)
}

// ---------------------------------------------------------------------------
// 源码不变量
// ---------------------------------------------------------------------------

const invariants = (src) => {
  const reasons = []
  const progress = sliceUseProgress(src)

  if (!progress) {
    reasons.push('找不到 useProgress 函数体（契约失效，请同步更新锚点）')
    return reasons
  }
  // ① 必须读 AppState 判前台
  if (!/AppState\.currentState\s*===\s*'active'/.test(progress)) {
    reasons.push('useProgress 未读 AppState 判定前台（后台仍每秒轮询原生）')
  }
  // ② 起表点唯一，且 !appActive 时不起表
  if (!/const startItv\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,200}?!appActive/.test(progress)) {
    reasons.push('useProgress 的 startItv 缺 !appActive 早退（后台照样起表）')
  }
  if (!/const clearItv\s*=\s*\(\)\s*=>\s*\{/.test(progress)) {
    reasons.push('useProgress 缺 clearItv（没有统一的停表点）')
  }
  // ③ 必须订阅前后台切换，且退后台立刻停表
  if (!/AppState\.addEventListener\('change'/.test(progress)) {
    reasons.push('useProgress 未订阅 AppState change（前后台切换不会停/起表）')
  }
  if (!/if\s*\(!appActive\)\s*\{[\s\S]{0,80}?clearItv\(\)/.test(progress)) {
    reasons.push('useProgress 退后台未 clearItv（后台仍在每秒轮询原生）')
  }
  // ④ 卸载要清理订阅与定时器
  if (!/progressStateSub\.remove\(\)/.test(progress) || !/clearItv\(\)/.test(progress)) {
    reasons.push('useProgress 卸载未清理订阅/定时器')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 反例自检（篡改源码后必须被拦下）
// ---------------------------------------------------------------------------

const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.split(find).join(replace)
}

const runCounterExamples = () => {
  const results = []
  const check = (name, src, expectSubstr) => {
    let reasons = []
    try {
      reasons = invariants(src)
    } catch (e) {
      results.push({ name, ok: false, detail: `抛异常: ${e.message}` })
      return
    }
    const hit = reasons.some(r => r.includes(expectSubstr))
    results.push({ name, ok: hit, detail: hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）` })
  }

  check('R1 去掉前台早退（后台照样起表）', tamper(real,
    '      if (!appActive || interval) return\n      interval = setInterval(() => { void getProgress() }, updateInterval || 1000)',
    '      if (interval) return\n      interval = setInterval(() => { void getProgress() }, updateInterval || 1000)'),
  'startItv 缺 !appActive 早退')

  check('R2 不再订阅前后台切换', tamper(real,
    "const progressStateSub = AppState.addEventListener('change'",
    "const progressStateSub = AppState.addEventListener('changeX'"),
  '未订阅 AppState change')

  check('R3 退后台不停表', tamper(real,
    '      if (!appActive) {\n        clearItv()\n        return\n      }',
    '      if (!appActive) {\n        return\n      }'),
  '退后台未 clearItv')

  check('R4 不读 AppState 判前台', tamper(real,
    "let appActive = AppState.currentState === 'active'",
    'let appActive = true'),
  '未读 AppState 判定前台')

  check('R5 卸载不清理', tamper(real,
    '    return () => {\n      progressStateSub.remove()\n      clearItv()\n    }',
    '    return () => {}'),
  '卸载未清理订阅/定时器')

  return results
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const realReasons = invariants(real)
const ce = runCounterExamples()

console.log('=== sim-progress-poll-foreground-gate ===\n')
console.log('[源码不变量]')
if (realReasons.length === 0) console.log('  PASS useProgress 前台门齐备（判前台 / 统一起表 / 退后台停表 / 卸载清理）')
else realReasons.forEach(r => console.log('  FAIL ' + r))

console.log('\n[反例自检]')
ce.forEach(r => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name} —— ${r.detail}`))

const failed = realReasons.length + ce.filter(r => !r.ok).length
console.log(`\n结果：${failed ? `有 ${failed} 项失败` : 'ALL PASS'}（不变量 ${realReasons.length === 0 ? '1/1' : '有失败'}；反例 ${ce.filter(r => r.ok).length}/${ce.length}）`)
process.exit(failed ? 1 : 0)
