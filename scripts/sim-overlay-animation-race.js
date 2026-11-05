/**
 * sim-overlay-animation-race.js
 *
 * 「动画驱动卸载」的浮层，在被后续操作打断后不得留下残留 / 卡死状态。
 *
 * 背景（2026-10 交互审计，四处同形态缺陷）：
 *   ① screens/.../MusicList/MultipleModeBar.tsx 与 components/OnlineList/MultipleModeBar.tsx：
 *      退出动画回调只在 finished=true 时 setVisible(false)，动画被打断就永远停在
 *      visible=true —— 这两个组件是 absolute 全屏/浮条，于是留下透明但拦截触摸的层。
 *   ② components/common/LoadingMask.tsx：hide 的卸载挂在动画回调上，且
 *      useImperativeHandle 闭包捕获旧的 maskVisible，导致「刚 hide 立刻 show」被吞掉。
 *   ③ components/DownloadBall/index.tsx：关闭动画期间新增任务被旧回调吞掉，scale 停在 0。
 *
 * 这里断言的是**结构不变量**（卸载不依赖动画回调 + 定时器可取消 + 隐藏态关触摸），
 * 加上一组行为模型复现「打断」时序。
 *
 * 运行：node scripts/sim-overlay-animation-race.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '')

const FILES = {
  mylistBar: 'src/screens/Home/Views/Mylist/MusicList/MultipleModeBar.tsx',
  onlineBar: 'src/components/OnlineList/MultipleModeBar.tsx',
  loadingMask: 'src/components/common/LoadingMask.tsx',
  downloadBall: 'src/components/DownloadBall/index.tsx',
  drawer: 'src/components/common/DrawerLayoutFixed.ios.tsx',
}

const SRC = {}
for (const [key, rel] of Object.entries(FILES)) SRC[key] = stripComments(read(rel))

const reasons = []

// ---------------------------------------------------------------------------
// ① 两个 MultipleModeBar
// ---------------------------------------------------------------------------
for (const key of ['mylistBar', 'onlineBar']) {
  const src = SRC[key]
  const label = FILES[key]
  if (/\.start\(\(finished\) => \{\s*if \(!finished\) return\s*setVisible\(false\)/.test(src)) {
    reasons.push(`${label}: 卸载仍挂在动画回调的 finished 判定上（打断后永不卸载）`)
  }
  if (!/unmountTimer\.current = setTimeout\(/.test(src)) {
    reasons.push(`${label}: 隐藏没有走可取消的卸载定时器`)
  }
  if (!/clearTimeout\(unmountTimer\.current\)/.test(src)) {
    reasons.push(`${label}: 卸载定时器不可取消（快速开关会误卸载新一次显示）`)
  }
  if (!/cancelAnimationFrame\(showRaf\.current\)/.test(src)) {
    reasons.push(`${label}: 入场 rAF 未取消（快速 hide 后仍会执行 show 的动画）`)
  }
  if (!/pointerEvents=\{[^}]*'none'[^}]*\}/.test(src)) {
    reasons.push(`${label}: 隐藏期间没有关闭 pointerEvents（透明层仍拦截触摸）`)
  }
  if (!/useEffect\(\(\) => \(\) => \{/.test(src)) {
    reasons.push(`${label}: 卸载时没有清理定时器 / rAF`)
  }
}

// ---------------------------------------------------------------------------
// ② LoadingMask
// ---------------------------------------------------------------------------
if (!/visibleRef/.test(SRC.loadingMask)) {
  reasons.push('LoadingMask: 仍用闭包里的 maskVisible 做同值判断（hide 后立刻 show 会被吞掉）')
}
if (!/unmountTimer\.current = setTimeout\(/.test(SRC.loadingMask)) {
  reasons.push('LoadingMask: 卸载仍依赖动画回调（被打断后透明遮罩残留并拦截触摸）')
}
if (!/if \(visibleRef\.current\) return/.test(SRC.loadingMask)) {
  reasons.push('LoadingMask: 卸载定时器没有重新显示的保护')
}

// ---------------------------------------------------------------------------
// ③ DownloadBall
// ---------------------------------------------------------------------------
if (!/visibleRef\.current/.test(SRC.downloadBall)) {
  reasons.push('DownloadBall: 显隐判定仍用闭包里的 isVisible（关闭动画期间新增任务会被吞掉）')
}
if (!/if \(!finished \|\| visibleRef\.current\) return/.test(SRC.downloadBall)) {
  reasons.push('DownloadBall: 关闭动画结束时无条件卸载（会吞掉期间新增的任务）')
}

// ---------------------------------------------------------------------------
// ④ DrawerLayoutFixed.ios
// ---------------------------------------------------------------------------
if (!/openRef\.current/.test(SRC.drawer)) {
  reasons.push('DrawerLayoutFixed.ios: 仍按动画回调时机恢复 Home 滚动锁（打断后会锁错/锁死）')
}
if (!/if \(openRef\.current\) return/.test(SRC.drawer)) {
  reasons.push('DrawerLayoutFixed.ios: close 回调没有「期间又被打开」的保护')
}

// ---------------------------------------------------------------------------
// 行为模型：复现「退出动画被打断」的时序，验证两种实现的结果差异
// ---------------------------------------------------------------------------
// 简化模型：visible 是否在动画被打断后仍然为 true
const legacyModel = () => {
  let visible = false
  let played = true
  let pendingCompletion = null
  const show = () => { visible = true; played = false; pendingCompletion = () => { played = true } }
  const hide = () => {
    played = false
    // 旧实现：只有 finished=true 才卸载
    pendingCompletion = (finished) => { if (finished) { visible = false; played = true } }
  }
  return { show, hide, complete: (finished) => pendingCompletion?.(finished), get visible() { return visible }, get played() { return played } }
}

const fixedModel = () => {
  let visible = false
  let played = true
  let timer = null
  let showRaf = null
  const show = () => {
    if (timer) { clearTimeout(timer); timer = null }
    visible = true
    played = false
    showRaf = () => { played = true }
  }
  const hide = () => {
    if (showRaf) showRaf = null
    played = false
    timer = setTimeout(() => { timer = null; if (!visible) return; visible = false; played = true }, 250)
  }
  return {
    show,
    hide,
    flush: () => { if (timer) { clearTimeout(timer); timer = null; visible = false; played = true } },
    get visible() { return visible },
    get played() { return played },
  }
}

const models = []
{
  // 旧实现：show → hide → 打断。退出动画被新的显示动画接管，hide 的回调只会收到
  // finished=false，而旧代码据此直接 return —— setVisible(false) 永不执行。
  const m = legacyModel()
  m.show(); m.hide(); m.complete(false)
  models.push(['反例：旧实现退出被打断后停在 visible=true（透明层残留）', m.visible === true && m.played === false])
}
{
  const m = fixedModel()
  m.show(); m.hide(); m.flush(); m.show()
  models.push(['修复后：打断后由最新一次操作决定显隐', m.visible === true && m.played === false])
}
{
  const m = fixedModel()
  m.show(); m.hide(); m.flush()
  models.push(['修复后：正常 hide 结束后卸载', m.visible === false && m.played === true])
}
{
  const m = fixedModel()
  m.show(); m.hide(); m.show(); m.flush()
  models.push(['修复后：hide 途中重新 show，卸载定时器不会误卸载', m.visible === true])
}

// ---------------------------------------------------------------------------
const failures = []
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' —— ' + detail : ''}`)
  if (!ok) failures.push(name)
}

console.log('行为模型')
for (const [name, ok] of models) check(name, ok)

console.log('')
console.log('结构不变量')
if (reasons.length === 0) {
  check('浮层卸载不依赖动画回调 + 定时器/rAF 可取消 + 隐藏态关触摸', true)
} else {
  for (const r of reasons) check(r, false)
}

console.log('')
if (failures.length) {
  console.error(`FAIL  浮层动画竞态契约未通过（${failures.length} 项）`)
  process.exit(1)
}
console.log(`PASS  浮层动画竞态：卸载与动画回调解耦（${Object.keys(FILES).length} 个组件 + 行为模型 ${models.length} 例）`)
process.exit(0)
