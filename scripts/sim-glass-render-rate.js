/**
 * 玻璃渲染降频 / 不可见侧停渲染 / 进度轮询前台门 —— 耗电契约（第二批，2026-10-02）。
 *
 * 背景：常态液态玻璃（theme.liquidGlass 默认 **开**）在 Tab 栏与迷你播放条上常驻，
 * 引擎是「MTKView 连续渲染 + 每帧捕获背景」。逐层核对后又找到三处净浪费：
 *
 *   ① 常态玻璃按 60fps 连续渲染，而背景捕获有**全局 33ms（≈30Hz）节流**，shader 也
 *      没有任何随时间变化的 uniform —— 60fps 只是把同一张纹理重复画一遍：白白的
 *      GPU 开销 + 每帧唤醒 CPU。降到 30fps 与捕获节流同速，画面无可见差异。
 *   ② Tab 栏同时挂着**两块**玻璃（收起态圆钮 + 展开态整条栏），用透明度交叉淡入淡出。
 *      动画停稳后不可见的那一块仍在 60fps 连续渲染，并且会去抢全局 33ms 捕获配额
 *      （谁先到谁捕获），既耗电又让可见侧拿到更旧/更少的背景纹理。
 *   ③ src/plugins/player/hook.ts 的 useProgress 每秒 3 次原生桥往返 + setState，
 *      且**没有 App 前台门**（同文件的 useBufferProgress 与 playProgress.ts 都有）。
 *
 * 这三处都不会崩、也过得了 tsc/eslint（原生不参与 TS 检查；少一个门控只是"多耗电"），
 * 只能靠契约绑住。运行：node scripts/sim-glass-render-rate.js
 * 退出码：不变量全过、且全部反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const FILES = {
  glassView: 'ios/Vendor/LiquidGlassKit/Sources/LiquidGlassView.swift',
  lensView: 'ios/Vendor/LiquidGlassKit/Sources/LiquidLensView.swift',
  tabbar: 'src/components/layout/ModernTabBar.tsx',
  hook: 'src/plugins/player/hook.ts',
}

const readAll = (over = {}) => {
  const files = {}
  for (const key of Object.keys(FILES)) {
    files[key] = over[key] !== undefined ? over[key] : read(FILES[key])
  }
  return files
}

/** 取 useProgress 的函数体（到 useBufferProgress 为止），避免与缓冲轮询互相顶包 */
const sliceUseProgress = (src) => {
  const at = src.indexOf('export function useProgress')
  if (at < 0) return ''
  const end = src.indexOf('export function useBufferProgress', at)
  return end > at ? src.slice(at, end) : src.slice(at)
}

// ---------------------------------------------------------------------------
// 源码不变量
// ---------------------------------------------------------------------------

const invariants = (files) => {
  const reasons = []

  // ① 常态玻璃 30fps（与 33ms 全局捕获节流同速）
  if (!/preferredFramesPerSecond\s*=\s*30\b/.test(files.glassView)) {
    reasons.push('常态液态玻璃未降到 30fps（60fps 只是重复绘制同一张捕获纹理）')
  }
  if (/preferredFramesPerSecond\s*=\s*(?:60|0)\b/.test(files.glassView)) {
    reasons.push('常态液态玻璃不得满帧连续渲染（背景捕获只有 30Hz，多出来的帧是纯浪费）')
  }
  // 前提：捕获节流仍在 33ms。若节流被拿掉，30fps 就不再是"同速"，本契约前提失效
  if (!/<\s*0\.033\b/.test(files.glassView)) {
    reasons.push('背景捕获的 33ms 全局节流不见了（30fps 的推导前提失效，请同步重算）')
  }

  // ② 透镜抬起态是逐帧几何变化，必须保持满帧（否则 morph 中玻璃形状滞后于视图）
  if (!/liquidGlassView\.preferredFramesPerSecond\s*=\s*60\b/.test(files.lensView)) {
    reasons.push('LiquidLens 抬起态未保持满帧（morph 中玻璃会滞后于视图本身）')
  }

  // ③ Tab 栏不可见侧玻璃必须停渲染
  if (!/const \[collapseSettled,\s*setCollapseSettled\]\s*=\s*useState\(collapsed\)/.test(files.tabbar)) {
    reasons.push('ModernTabBar 未记录收起动画是否停稳（无从判定哪一侧不可见）')
  }
  if (!/setCollapseSettled\(collapsed\)/.test(files.tabbar)) {
    reasons.push('收起动画结束时未落 collapseSettled（不可见侧永远不会被停渲染）')
  }
  if (!/collapseAnimating\s*=\s*collapseSettled\s*!==\s*collapsed/.test(files.tabbar)) {
    reasons.push('ModernTabBar 未按 collapseSettled !== collapsed 判定动画中（动画期间两侧都要渲染）')
  }
  if (!/pillGlassVisible\s*=\s*collapsed\s*\|\|\s*collapseAnimating/.test(files.tabbar)) {
    reasons.push('收起态圆钮玻璃的可见性判定不完整（collapsed || 动画中）')
  }
  if (!/barGlassVisible\s*=\s*!collapsed\s*\|\|\s*collapseAnimating/.test(files.tabbar)) {
    reasons.push('展开态 tab 栏玻璃的可见性判定不完整（!collapsed || 动画中）')
  }
  if (!/pillGlassPaused\s*=\s*glassPaused\s*\|\|\s*!pillGlassVisible/.test(files.tabbar) ||
      !/barGlassPaused\s*=\s*glassPaused\s*\|\|\s*!barGlassVisible/.test(files.tabbar)) {
    reasons.push('两块玻璃的 paused 未与可见性门取并集（不可见侧仍逐帧渲染）')
  }
  if (!/paused=\{pillGlassPaused\}/.test(files.tabbar) || !/paused=\{barGlassPaused\}/.test(files.tabbar)) {
    reasons.push('paused 未同时接到两块玻璃（收起态圆钮 / 展开态 tab 栏）')
  }

  // ④ useProgress 进度轮询必须有 App 前台门
  const progress = sliceUseProgress(files.hook)
  if (!/AppState\.currentState\s*===\s*'active'/.test(progress)) {
    reasons.push('useProgress 未读 AppState 判定前台（后台仍每秒轮询原生）')
  }
  if (!/const startItv\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,200}?!appActive/.test(progress)) {
    reasons.push('useProgress 的 startItv 缺 !appActive 早退（后台照样起表）')
  }
  if (!/AppState\.addEventListener\('change'/.test(progress)) {
    reasons.push('useProgress 未订阅 AppState change（前后台切换不会停/起表）')
  }
  if (!/if\s*\(!appActive\)\s*\{[\s\S]{0,80}?clearItv\(\)/.test(progress)) {
    reasons.push('useProgress 退后台未 clearItv（后台仍在每秒轮询原生）')
  }
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
  const base = readAll()

  check('R1 常态玻璃回到 60fps', readAll({
    glassView: tamper(base.glassView, 'preferredFramesPerSecond = 30', 'preferredFramesPerSecond = 60'),
  }), '常态液态玻璃未降到 30fps')

  check('R2 捕获节流被拿掉（30fps 前提失效）', readAll({
    glassView: tamper(base.glassView, 'if now - Self.globalLastCaptureAt < 0.033 {', 'if false {'),
  }), '33ms 全局节流')

  check('R3 透镜被一起降频', readAll({
    lensView: tamper(base.lensView, 'liquidGlassView.preferredFramesPerSecond = 60', 'liquidGlassView.preferredFramesPerSecond = 30'),
  }), 'LiquidLens 抬起态未保持满帧')

  check('R4 收起动画停稳不落状态', readAll({
    tabbar: tamper(base.tabbar, '      if (finished) setCollapseSettled(collapsed)', '      // removed'),
  }), '收起动画结束时未落 collapseSettled')

  check('R5 不可见侧回退成只按前台门', readAll({
    tabbar: tamper(base.tabbar, 'const pillGlassPaused = glassPaused || !pillGlassVisible', 'const pillGlassPaused = glassPaused'),
  }), '未与可见性门取并集')

  check('R6 圆钮 paused 脱钩', readAll({
    tabbar: tamper(base.tabbar, 'paused={pillGlassPaused}', ''),
  }), 'paused 未同时接到两块玻璃')

  check('R7 进度轮询去掉前台早退', readAll({
    hook: tamper(base.hook, '      if (!appActive || interval) return\n      interval = setInterval(() => { void getProgress() }, updateInterval || 1000)', '      if (interval) return\n      interval = setInterval(() => { void getProgress() }, updateInterval || 1000)'),
  }), 'startItv 缺 !appActive 早退')

  check('R8 进度轮询不再订阅前后台切换', readAll({
    hook: tamper(base.hook, "const progressStateSub = AppState.addEventListener('change'", "const progressStateSub = AppState.addEventListener('changeX'"),
  }), '未订阅 AppState change')

  check('R9 进度轮询退后台不停表', readAll({
    hook: tamper(base.hook, '      if (!appActive) {\n        clearItv()\n        return\n      }\n      void getProgress()', '      if (!appActive) {\n        return\n      }\n      void getProgress()'),
  }), '退后台未 clearItv')

  return results
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const realReasons = invariants(readAll())
const ce = runCounterExamples()

console.log('=== sim-glass-render-rate ===\n')
console.log('[源码不变量]')
if (realReasons.length === 0) console.log('  PASS 常态玻璃 30fps / 透镜满帧 / 不可见侧停渲染 / useProgress 前台门 齐备')
else realReasons.forEach(r => console.log('  FAIL ' + r))

console.log('\n[反例自检]')
ce.forEach(r => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name} —— ${r.detail}`))

const failed = realReasons.length + ce.filter(r => !r.ok).length
console.log(`\n结果：${failed ? `有 ${failed} 项失败` : 'ALL PASS'}（不变量 ${realReasons.length === 0 ? '1/1' : '有失败'}；反例 ${ce.filter(r => r.ok).length}/${ce.length}）`)
process.exit(failed ? 1 : 0)
