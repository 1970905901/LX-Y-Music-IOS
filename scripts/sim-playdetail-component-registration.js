/**
 * sim-playdetail-component-registration.js
 *
 * 播放详情组件注册契约。
 *
 * 用户反馈：iPad 横屏播放时歌词高亮行逐渐消失且不居中，iPad 竖屏 / iPhone 竖屏正常。
 * 根因：PlayDetail/index 已注册一次 playDetail，Horizontal/index 在横屏布局里又注册一次。
 * setComponentId 原先无幂等保护，componentIds 栈变成 [home, playDetail, playDetail]；
 * usePlayDetailCovered 用 findIndex 取第一个 playDetail，于是把栈顶重复项误判成
 * 「播放详情被其他页面覆盖」，歌词连续滚动循环与逐字动画被 covered 门控停掉。
 * 竖屏布局没有重复注册，所以两端表现不同。
 *
 * 契约守护：
 *   1) 播放详情只由 PlayDetail/index 注册，Horizontal 等布局子组件不得重复注册；
 *   2) setComponentId 对完全相同的 name + id 幂等，避免横竖屏切换反复入栈；
 *   3) usePlayDetailCovered 以最后一个 playDetail 条目判断栈顶可见性；
 *   4) 行为模型覆盖重复项、覆盖页、返回后恢复等栈状态。
 *
 * 运行：node scripts/sim-playdetail-component-registration.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  playDetail: 'src/screens/PlayDetail/index.tsx',
  horizontal: 'src/screens/PlayDetail/Horizontal/index.tsx',
  action: 'src/store/common/action.ts',
  hook: 'src/store/common/hook.ts',
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const count = (src, pattern) => (src.match(pattern) || []).length

const checkAll = ({ playDetail, horizontal, action, hook }) => {
  const violations = []
  const list = (rule, where, detail) => violations.push({ rule, where, detail })

  if (count(playDetail, /setComponentId\(COMPONENT_IDS\.playDetail, componentId\)/g) !== 1) {
    list('single-registration', FILES.playDetail, '播放详情必须且只能由 PlayDetail/index 注册一次')
  }
  if (/setComponentId\s*\(/.test(horizontal)) {
    list('single-registration', FILES.horizontal, '横屏布局子组件不得再次注册 playDetail（会留下重复栈项）')
  }
  if (!/state\.componentIds\.some\(item => item\.name === name && item\.id === id\)/.test(action)) {
    list('idempotent-registration', FILES.action, 'setComponentId 缺少相同 name + id 的幂等保护')
  }
  if (!/let lastIndex = -1/.test(hook) || !/if \(String\(ids\[i\]\.name\) === COMPONENT_IDS\.playDetail\) lastIndex = i/.test(hook)) {
    list('last-stack-entry', FILES.hook, 'isPlayDetailCovered 必须取最后一个 playDetail 栈项')
  }
  if (/ids\.findIndex\(\(\{ name \}\) => String\(name\) === COMPONENT_IDS\.playDetail\)/.test(hook)) {
    list('last-stack-entry', FILES.hook, 'isPlayDetailCovered 又退回 findIndex（首个条目），重复栈项会误判')
  }

  return violations
}

const PLAY_DETAIL = 'playDetail'
const HOME = 'home'
const COMMENT = 'comment'

const isPlayDetailCoveredLast = (ids) => {
  let lastIndex = -1
  for (let i = 0; i < ids.length; i++) {
    if (ids[i].name === PLAY_DETAIL) lastIndex = i
  }
  return lastIndex >= 0 && lastIndex < ids.length - 1
}

// 修复前语义：首个 playDetail 不在栈顶即视为被覆盖。
const isPlayDetailCoveredFirst = (ids) => {
  const index = ids.findIndex(({ name }) => name === PLAY_DETAIL)
  return index >= 0 && index < ids.length - 1
}

const scenarios = [
  ['空栈不暂停', [], false],
  ['只挂 Home 时播放详情不存在', [{ name: HOME }], false],
  ['播放详情在栈顶时歌词循环运行', [{ name: HOME }, { name: PLAY_DETAIL }], false],
  ['重复注册的播放详情仍在栈顶时不暂停', [{ name: HOME }, { name: PLAY_DETAIL }, { name: PLAY_DETAIL }], false],
  ['评论页覆盖播放详情时暂停', [{ name: HOME }, { name: PLAY_DETAIL }, { name: COMMENT }], true],
  ['重复注册 + 评论页覆盖时仍暂停', [{ name: HOME }, { name: PLAY_DETAIL }, { name: PLAY_DETAIL }, { name: COMMENT }], true],
  ['评论页返回后恢复歌词循环', [{ name: HOME }, { name: PLAY_DETAIL }], false],
]

const models = [
  ['最后一个 playDetail 位于栈顶时 covered=false', isPlayDetailCoveredLast([{ name: HOME }, { name: PLAY_DETAIL }, { name: PLAY_DETAIL }]) === false],
  ['最后一个 playDetail 之上有评论页时 covered=true', isPlayDetailCoveredLast([{ name: HOME }, { name: PLAY_DETAIL }, { name: PLAY_DETAIL }, { name: COMMENT }]) === true],
  ['旧 findIndex 语义会把栈顶重复项误判为 covered', isPlayDetailCoveredFirst([{ name: HOME }, { name: PLAY_DETAIL }, { name: PLAY_DETAIL }]) === true],
]

const REAL = {
  playDetail: read(FILES.playDetail),
  horizontal: read(FILES.horizontal),
  action: read(FILES.action),
  hook: read(FILES.hook),
}

const counterExamples = []
const expectCaught = (name, rule, mutate) => {
  try {
    const rules = checkAll({ ...REAL, ...mutate({ ...REAL }) }).map(v => v.rule)
    counterExamples.push([name, rules.includes(rule), rules.includes(rule) ? `已拦下（${rule}）` : `未拦下（rules=${JSON.stringify(rules)}）`])
  } catch (err) {
    counterExamples.push([name, false, `变异执行失败：${err.message}`])
  }
}

expectCaught('C1 横屏布局重新注册 playDetail', 'single-registration', (v) => ({
  horizontal: v.horizontal.replace('useEffect(() => {', 'useEffect(() => {\n    setComponentId(COMPONENT_IDS.playDetail, componentId)'),
}))
expectCaught('C2 移除 setComponentId 幂等保护', 'idempotent-registration', (v) => ({
  action: v.action.replace('    if (state.componentIds.some(item => item.name === name && item.id === id)) return\n', ''),
}))
expectCaught('C3 回到 findIndex 判定', 'last-stack-entry', (v) => ({
  hook: v.hook.replace(
    /const isPlayDetailCovered = \(ids: InitState\['componentIds'\]\) => \{[\s\S]*?\n\}/,
    "const isPlayDetailCovered = (ids: InitState['componentIds']) => {\n  const index = ids.findIndex(({ name }) => String(name) === COMPONENT_IDS.playDetail)\n  return index >= 0 && index < ids.length - 1\n}",
  ),
}))

const violations = checkAll(REAL)
const scenarioFailures = scenarios.filter(([, ids, expected]) => isPlayDetailCoveredLast(ids) !== expected)
const modelFailures = models.filter(([, ok]) => !ok)
const missed = counterExamples.filter(([, ok]) => !ok)

console.log('栈状态行为模型')
for (const [name, ids, expected] of scenarios) {
  const actual = isPlayDetailCoveredLast(ids)
  console.log(`${actual === expected ? 'PASS' : 'FAIL'}  ${name}（covered=${actual}）`)
}
console.log('')
console.log('语义对照')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of counterExamples) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')

for (const v of violations) console.error(`FAIL  [${v.rule}] ${v.where} —— ${v.detail}`)
if (violations.length || scenarioFailures.length || modelFailures.length || missed.length) {
  console.error('')
  console.error(`FAIL  播放详情组件注册契约未通过：违例 ${violations.length} 项、场景失败 ${scenarioFailures.length} 例、语义失败 ${modelFailures.length} 例、反例漏检 ${missed.length} 例`)
  process.exit(1)
}
console.log(`PASS  播放详情只注册一次、注册幂等、覆盖判定取栈顶（规则 4 组 + 行为模型 ${scenarios.length} 例 + 反例 ${counterExamples.length} 例）`)
process.exit(0)
