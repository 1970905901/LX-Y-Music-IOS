/**
 * sim-miniplayer-glass-gate.js
 *
 * 迷你播放器「液态玻璃卡住不再刷新」契约：暂停门（<LiquidGlass paused>）不得把
 * **仍然可见**的玻璃钉死在暂停态。
 *
 * 背景（用户报障，2026-10-16）：开启液态玻璃时，迷你播放器偶发玻璃「卡住」——
 * 表现为胶囊里的液态玻璃定格成一张静态图（好像被当时/上一屏的背景卡住），
 * 只有等下一次触发重渲染才可能恢复。
 *
 * 根因（两层，都在省电门链路上）：
 *   ① 调用点传错 id：Home/Vertical 把 `commonState.componentIds` 的**栈顶 id**
 *      传给 PlayerBar（Home/Horizontal 传的是本屏自己的 componentId，两者不一致）。
 *      本屏在「被压栈页覆盖」期间只要发生一次重渲染（iPad 旋转切布局、语言切换等），
 *      栈顶页的 id 就被缓存进 PlayerBar 的 componentId。
 *   ② 钩子语义过窄：`useScreenCovered` 只比「栈顶是不是自己」，于是**陈旧 id 不在
 *      栈内**时恒判「被覆盖」（true）。两者叠加：返回首页后 Home 实例永久 paused，
 *      可见的迷你播放器玻璃被冻结（MTKView.isPaused=true 停在最后一帧）。
 *
 * 修复（两处，缺一不可）：
 *   A) Home/Vertical 改传本屏自己的 componentId（与 Home/Horizontal 同口径）；
 *   B) useScreenCovered 改成「**在栈内且不是栈顶**才算被覆盖」，id 不在栈内时
 *      fail-open 判 false —— 即便将来再有调用方把动态 id 传进来，也不会冻结可见玻璃。
 *
 * 契约守护三件事：
 *   1) 结构：两套 Home 布局传给 PlayerBar 的都必须是本屏 componentId（不得再出现
 *      commonState.componentIds 的栈顶取值）；PlayerBar 必须把 componentId 交给
 *      useScreenCovered，并把 paused 继续传给 <LiquidGlass>（整条链路不得断）；
 *   2) 语义：useScreenCovered 必须实现「在栈内且非栈顶」判据（fail-open）；
 *   3) 行为模型：用导航序列复刻旧/新两套语义，钉住「可见 ⇒ 不得 paused」不变量，
 *      并记录旧语义在漂移序列下必然冻结（用户看到的现象）。
 *
 * 运行：node scripts/sim-miniplayer-glass-gate.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  hook: 'src/store/common/hook.ts',
  playerbar: 'src/components/player/PlayerBar/index.tsx',
  vertical: 'src/screens/Home/Vertical/index.tsx',
  horizontal: 'src/screens/Home/Horizontal/index.tsx',
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

// 剥注释（保留字符串字面量）：注释里描述旧实现/反例不算违规（与同目录契约同口径）
const stripComments = (src) => {
  let out = ''
  let i = 0
  let inBlock = false
  let inLine = false
  let quote = null
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (inLine) {
      if (c === '\n') { inLine = false; out += '\n' }
      i++
      continue
    }
    if (inBlock) {
      if (c === '*' && n === '/') { inBlock = false; i += 2; continue }
      out += c === '\n' ? '\n' : ' '
      i++
      continue
    }
    if (quote) {
      out += c
      if (c === '\\') { out += n === undefined ? '' : n; i += 2; continue }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '/' && n === '/') { inLine = true; i += 2; continue }
    if (c === '/' && n === '*') { inBlock = true; i += 2; continue }
    if (c === '"' || c === "'") quote = c
    out += c
    i++
  }
  return out
}

// 取某函数的函数体（从头部的第一个 '{' 起花括号配平）：规则必须只看目标函数，
// 否则会被同文件其它函数的同形代码掩盖（反例 C4 曾因此漏检 —— 同文件
// isPlayDetailCovered 也有同款 index 判断）。
const extractFunctionBody = (code, header) => {
  const start = code.indexOf(header)
  if (start < 0) return null
  const open = code.indexOf('{', start)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') {
      depth--
      if (depth === 0) return code.slice(open + 1, i)
    }
  }
  return null
}

const checkAll = ({ hook, playerbar, vertical, horizontal }) => {
  const problems = []
  const hookCode = stripComments(hook)
  const pbCode = stripComments(playerbar)
  const vtCode = stripComments(vertical)
  const hzCode = stripComments(horizontal)

  // ① 钩子语义（只看 useScreenCovered 函数体）：在栈内且非栈顶；id 不在栈内必须 fail-open（false）
  const gateBody = extractFunctionBody(hookCode, 'export const useScreenCovered = (componentId?: string) => {')
  if (gateBody === null) {
    problems.push({ id: 'hook-missing', desc: '找不到 useScreenCovered 实现（函数被删/改名）' })
  } else {
    if (!/if\s*\(!componentId\)\s*return\s*false/.test(gateBody)) {
      problems.push({ id: 'hook-early-return', desc: 'useScreenCovered 缺「未传 componentId 恒 false」早退' })
    }
    if (!/const\s+index\s*=\s*ids\.findIndex\(\(\{\s*id\s*\}\)\s*=>\s*String\(id\)\s*===\s*String\(componentId\)\)/.test(gateBody)) {
      problems.push({ id: 'hook-in-stack', desc: 'useScreenCovered 未按「在栈内」定位本屏（findIndex）——陈旧 id 会被误判为被覆盖' })
    }
    if (!/return\s+index\s*>=\s*0\s*&&\s*index\s*<\s*ids\.length\s*-\s*1/.test(gateBody)) {
      problems.push({ id: 'hook-not-top', desc: 'useScreenCovered 未实现「在栈内且不是栈顶才算被覆盖」（fail-open 出口）' })
    }
    if (/return\s+String\(ids\[ids\.length\s*-\s*1\]\?\.id\)/.test(gateBody)) {
      problems.push({ id: 'hook-top-only', desc: 'useScreenCovered 退回「只比栈顶」旧语义：陈旧 id 会把可见玻璃永久钉在暂停态' })
    }
  }

  // ② PlayerBar：componentId 必须进钩子，paused 必须继续传给玻璃
  if (!/useScreenCovered\(componentId\)/.test(pbCode)) {
    problems.push({ id: 'playerbar-gate-arg', desc: 'PlayerBar 未把 componentId 传给 useScreenCovered（省电门失效或恒门控）' })
  }
  if (!/const\s+glassPaused\s*=\s*screenCovered\s*\|\|\s*!appActive/.test(pbCode)) {
    problems.push({ id: 'playerbar-gate-compose', desc: 'PlayerBar 的 glassPaused 未组合「被覆盖 || 非前台」' })
  }
  if (!/paused=\{glassPaused\}/.test(pbCode)) {
    problems.push({ id: 'playerbar-paused', desc: 'PlayerBar 未把 paused 传给 <LiquidGlass>（暂停链路断开）' })
  }

  // ③ 两套 Home 布局：必须传本屏自己的 componentId
  for (const [key, code, where] of [['vertical', vtCode, FILES.vertical], ['horizontal', hzCode, FILES.horizontal]]) {
    if (!/<PlayerBar\s+componentId=\{componentId\}\s+isHome\s*\/>/.test(code)) {
      problems.push({ id: 'playerbar-own-id', where, desc: key + ' 未传本屏自己的 componentId 给 PlayerBar' })
    }
    if (/componentIds\[/.test(code) || /commonState/.test(code)) {
      problems.push({ id: 'playerbar-dynamic-id', where, desc: key + ' 又把动态栈顶 id（commonState.componentIds）传给了 PlayerBar：覆盖期间重渲染会缓存他屏 id → 返回本屏后玻璃永久冻结' })
    }
  }
  return problems
}

// ---- 行为模型：复刻两套门控语义，驱动导航序列 ----
// 栈形态取自真实来源：commonState.componentIds 为 [{id, name}]（底→顶），id 由 RNN 生成
const IDS = { home: 'Component5', settings: 'Component9', playDetail: 'Component12' }
const stackOf = (...names) => names.map((name) => ({ id: IDS[name], name }))

const gateTopOnly = (ids, componentId) => { // 修复前：只比栈顶
  if (!componentId) return false
  return String(ids[ids.length - 1]?.id) !== String(componentId)
}
const gateInStack = (ids, componentId) => { // 修复后：在栈内且非栈顶（fail-open）
  if (!componentId) return false
  const index = ids.findIndex(({ id }) => String(id) === String(componentId))
  return index >= 0 && index < ids.length - 1
}

const seqNormal = [
  stackOf('home'), // 首页可见
  stackOf('home', 'settings'), // 压入设置：Home 实例被覆盖
  stackOf('home'), // 返回首页
  stackOf('home', 'settings', 'playDetail'),
  stackOf('home'),
]
const normalExpected = [false, true, false, true, false]

const seqDrift = [
  stackOf('home', 'settings'), // 覆盖期间 Home 屏重渲染（如 iPad 旋转）→ prop 缓存了 settings 的 id
  stackOf('home'), // 返回首页
]
const driftedProp = IDS.settings

// 全排列性质：covered === (在栈内 && 非栈顶)
const names = ['home', 'settings', 'playDetail']
const allStacks = []
for (const a of names) {
  allStacks.push(stackOf(a))
  for (const b of names) {
    if (b === a) continue
    allStacks.push(stackOf(a, b))
    for (const c of names) {
      if (c === a || c === b) continue
      allStacks.push(stackOf(a, b, c))
    }
  }
}
const propertyHolds = allStacks.every((ids) => names.every((name) => {
  const id = IDS[name]
  const inStack = ids.some((s) => s.id === id)
  const isTop = ids[ids.length - 1].id === id
  return gateInStack(ids, id) === (inStack && !isTop)
}))

const models = [
  ['修复后：正常压栈/出栈序列下「只在被覆盖时 pause」（可见 ⇒ 永不 paused）',
    seqNormal.map((ids) => gateInStack(ids, IDS.home)).join(',') === normalExpected.join(',')],
  ['修复后：漂移序列（componentId 缓存了压栈页 id）返回首页不再冻结玻璃（fail-open）',
    seqDrift.map((ids) => gateInStack(ids, driftedProp)).every((v) => v === false)],
  ['修复前对照：同一漂移序列旧语义恒判「被覆盖」——正是用户看到的「玻璃卡住」',
    gateTopOnly(seqDrift[1], driftedProp) === true && gateInStack(seqDrift[1], driftedProp) === false],
  ['启动早期（栈尚未建立/为空）不再被误判为「被覆盖」', gateInStack([], IDS.home) === false],
  ['未传 componentId 的实例（专辑页/歌手页的 PlayerBar）恒不门控',
    gateInStack(stackOf('home', 'settings'), undefined) === false &&
    gateTopOnly(stackOf('home', 'settings'), undefined) === false],
  ['性质检查：covered 恒等于「在栈内且非栈顶」（全排列 ' + allStacks.length + ' 种栈形态）',
    propertyHolds],
]

// ---- 反例自检：篡改任一守护点都必须报出来 ----
const REAL = {
  hook: read(FILES.hook),
  playerbar: read(FILES.playerbar),
  vertical: read(FILES.vertical),
  horizontal: read(FILES.horizontal),
}

const counterExamples = []
const expectCaught = (name, expectRule, mutate) => {
  let problems
  try {
    problems = checkAll({ ...REAL, ...mutate({ ...REAL }) }).map((p) => p.id)
  } catch (err) {
    counterExamples.push([name, false, '变异执行失败：' + err.message])
    return
  }
  const hit = problems.includes(expectRule)
  counterExamples.push([name, hit, hit ? '已拦下（' + expectRule + '）' : '未拦下（rules=' + JSON.stringify(problems) + '）'])
}

const VT_PB_LINE = '      <PlayerBar componentId={componentId} isHome />'

expectCaught('C1 Vertical 改回传栈顶 id（引入 commonState 动态 id）', 'playerbar-dynamic-id', (v) => ({
  vertical: v.vertical.replace(VT_PB_LINE, '      <PlayerBar componentId={commonState.componentIds[commonState.componentIds.length - 1]?.id} isHome />')
    .replace("import PlayerBar from '@/components/player/PlayerBar'", "import PlayerBar from '@/components/player/PlayerBar'\nimport commonState from '@/store/common/state'"),
}))
expectCaught('C2 Horizontal 丢掉本屏 componentId', 'playerbar-own-id', (v) => ({
  horizontal: v.horizontal.replace('<PlayerBar componentId={componentId} isHome />', '<PlayerBar isHome />'),
}))
expectCaught('C3 useScreenCovered 退回「只比栈顶」旧语义', 'hook-top-only', (v) => ({
  hook: v.hook
    .replace(/const index = ids\.findIndex\(\(\{ id \}\) => String\(id\) === String\(componentId\)\)/, '')
    .replace(/return index >= 0 && index < ids\.length - 1/, 'return String(ids[ids.length - 1]?.id) !== String(componentId)'),
}))
expectCaught('C4 useScreenCovered 丢掉 index >= 0 保底（陈旧 id 重新判为被覆盖）', 'hook-not-top', (v) => ({
  hook: v.hook.replace('return index >= 0 && index < ids.length - 1', 'return index !== ids.length - 1'),
}))
expectCaught('C5 PlayerBar 不再把 componentId 交给钩子', 'playerbar-gate-arg', (v) => ({
  playerbar: v.playerbar.replace('const screenCovered = useScreenCovered(componentId)', 'const screenCovered = false'),
}))
expectCaught('C6 PlayerBar 丢掉 paused prop（暂停链路断开）', 'playerbar-paused', (v) => ({
  playerbar: v.playerbar.replace(' paused={glassPaused}', ''),
}))

const problems = checkAll(REAL)
const failedModels = models.filter(([, ok]) => !ok)
const missed = counterExamples.filter(([, ok]) => !ok)

console.log('行为模型')
for (const [name, ok] of models) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of counterExamples) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + ' —— ' + detail)
console.log('')

for (const p of problems) console.error('FAIL  [' + p.id + '] ' + (p.where ? p.where + ' —— ' : '') + p.desc)
if (problems.length || failedModels.length || missed.length) {
  console.error('')
  console.error('FAIL  迷你播放器玻璃暂停门契约未通过：违例 ' + problems.length + ' 项、模型失败 ' + failedModels.length + ' 例、反例漏检 ' + missed.length + ' 例')
  process.exit(1)
}
console.log('PASS  迷你播放器玻璃暂停门：只在「本屏在栈内且被压栈页覆盖」时暂停，陈旧 id 不再冻结可见玻璃（规则 7 条 + 行为模型 ' + models.length + ' 例 + 反例 ' + counterExamples.length + ' 例）')
process.exit(0)
