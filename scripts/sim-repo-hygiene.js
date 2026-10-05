/**
 * sim-repo-hygiene.js
 *
 * 本机产物 / 工具数据不得进入版本库：
 *   - $null（PowerShell 重定向事故文件）
 *   - ios/assets/（react-native bundle --assets-dest ios 产物）
 *   - .workbuddy/（本机工具运行数据，同 CodeBuddy）
 *   - pnpm-lock.yaml（本项目以 npm 为准，package-lock.json 已入库）
 * 要求：必须在 .gitignore 中，且不得已被 git 追踪。
 *
 * 运行：node scripts/sim-repo-hygiene.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const RULES = [
  { rule: '$null', probe: '$null', label: 'PowerShell 重定向事故文件' },
  { rule: 'ios/assets/', probe: 'ios/assets/foo.png', label: 'bundle --assets-dest 构建产物' },
  { rule: '.workbuddy/', probe: '.workbuddy/memory/MEMORY.md', label: '本机工具运行数据' },
  { rule: 'pnpm-lock.yaml', probe: 'pnpm-lock.yaml', label: '非主包管理器 lock' },
]

const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
const isIgnored = (probe) => git(['check-ignore', '-q', '--', probe]).status === 0
const isTracked = (probe) => String(git(['ls-files', '--', probe]).stdout || '').trim().length > 0

const structuralReasons = (ignoreText) => {
  const lines = ignoreText.replace(/\r\n/g, '\n').split('\n').map((s) => s.trim())
  const reasons = []
  for (const { rule, label } of RULES) {
    if (!lines.includes(rule)) reasons.push(`.gitignore 缺少规则 ${rule}（${label}）`)
  }
  return reasons
}

const REAL = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')

const cases = []
const checkCase = (name, mutate, expectSubstr) => {
  let reasons = []
  try {
    reasons = structuralReasons(mutate(REAL))
  } catch (err) {
    cases.push([name, false, err.message])
    return
  }
  const hit = reasons.some((r) => r.includes(expectSubstr))
  cases.push([name, hit, hit ? '已拦下' : `未拦下（${JSON.stringify(reasons)}）`])
}

for (const { rule } of RULES) {
  checkCase(`C 去掉规则 ${rule}`, (text) => text.split('\n').filter((line) => line.trim() !== rule).join('\n'), rule)
}

// 集合检查的反例：只要有一项「未忽略」或「已被追踪」，就必须报错
const collectViolations = (probes) => probes.filter(({ ignored, tracked }) => !ignored || tracked)
const models = [
  ['反例：未忽略或已被追踪的产物会被集合检查拦下',
    collectViolations([{ ignored: false, tracked: false }]).length === 1 &&
    collectViolations([{ ignored: true, tracked: true }]).length === 1],
  ['修复后：四类本机产物全部被忽略且未被追踪',
    collectViolations(RULES.map(({ probe }) => ({ ignored: isIgnored(probe), tracked: isTracked(probe) }))).length === 0],
]

const realReasons = structuralReasons(REAL)
const vaultProbes = RULES.map(({ probe }) => ({ probe, ignored: isIgnored(probe), tracked: isTracked(probe) }))
const behaviorViolations = collectViolations(vaultProbes)
const failedModels = models.filter(([, ok]) => !ok)
const missed = cases.filter(([, ok]) => !ok)

console.log('行为模型')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of cases) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')

if (realReasons.length) {
  console.error(`FAIL  .gitignore 契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
for (const { probe, ignored, tracked } of behaviorViolations) {
  console.error(`FAIL  ${probe}: ignored=${ignored} tracked=${tracked}`)
}
if (realReasons.length || behaviorViolations.length || failedModels.length || missed.length) {
  console.error(`\nFAIL  仓库卫生契约未通过：规则缺失 ${realReasons.length} 项、行为违例 ${behaviorViolations.length} 项、模型失败 ${failedModels.length} 例、反例漏检 ${missed.length} 例`)
  process.exit(1)
}
console.log(`PASS  本机产物/工具数据不入库（规则 4 条 + 行为模型 ${models.length} 例 + 反例 ${cases.length} 例）`)
process.exit(0)
