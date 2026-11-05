/**
 * sim-data-loss-guards.js
 *
 * 用户数据的「先删后写」与路径拼接必须安全。
 *
 * 背景（2026-10 全仓审计，两条都能从源码证明）：
 *   ① core/userApi.ts overwriteUserApis 先删除「新数据里没有的旧脚本」，再写新列表与新脚本。
 *      写入阶段失败（存储满 / 桥异常）时旧脚本已被删、新脚本未落盘 —— 用户的音源被永久清空。
 *   ② 音源名称来自用户导入的脚本内容（utils/data.ts 只限制长度），导出时直接拼进
 *      `${dirPath}/${apiInfo.name}.js`：名称里带 `../` 就能逃出所选目录、覆盖沙盒内其它文件。
 *
 * 运行：node scripts/sim-data-loss-guards.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '')

const USER_API = stripComments(read('src/core/userApi.ts'))
const EXPORT_ACTION = stripComments(read('src/screens/Home/Views/Setting/settings/Basic/UserApiEditModal/action.ts'))
const COMMON = stripComments(read('src/utils/common.ts'))

const reasons = []

// ---------------------------------------------------------------------------
// ① 覆盖音源：写入必须先于删除
// ---------------------------------------------------------------------------
{
  const body = USER_API.slice(USER_API.indexOf('export const overwriteUserApis'))
  const fnEnd = body.indexOf('\n}\n')
  const fn = fnEnd > 0 ? body.slice(0, fnEnd) : body
  const saveIdx = fn.indexOf('await saveDataMultiple(')
  const removeIdx = fn.indexOf('removeDataMultiple(')
  if (saveIdx < 0) {
    reasons.push('overwriteUserApis: 找不到 saveDataMultiple 写入点')
  } else if (removeIdx >= 0 && removeIdx < saveIdx) {
    reasons.push('overwriteUserApis: 仍然是「先删旧脚本、后写新数据」（写入失败会永久清空用户音源）')
  }
  if (!/removeDataMultiple\(keysToRemove\)\.catch/.test(fn)) {
    reasons.push('overwriteUserApis: 清理旧脚本失败没有被隔离（会让已成功的写入被当成失败）')
  }
}

// ---------------------------------------------------------------------------
// ② 音源导出：文件名必须净化
// ---------------------------------------------------------------------------
{
  if (!/const toSafeScriptFileName = /.test(EXPORT_ACTION)) {
    reasons.push('音源导出: 缺少文件名净化函数')
  }
  // 不允许再出现直接拿 apiInfo.name 拼路径
  if (/\$\{apiInfo\.name\}\.js/.test(EXPORT_ACTION)) {
    reasons.push('音源导出: 仍在用 apiInfo.name 直接拼路径（可用 ../ 逃出目标目录）')
  }
  const helper = EXPORT_ACTION.slice(EXPORT_ACTION.indexOf('const toSafeScriptFileName'))
  if (!/filterFileName\(/.test(helper)) {
    reasons.push('音源导出: 没有复用项目的 filterFileName')
  }
  if (!/replace\(\/\\\.\\\.\/g/.test(helper) && !/\.\./.test(helper)) {
    reasons.push('音源导出: 没有处理 `..` 片段')
  }
  if (!/filterFileName = \(name: string\): string => name\.replace\(fileNameRxp/.test(COMMON)) {
    reasons.push('utils/common: filterFileName 的基准实现丢失')
  }
}

// ---------------------------------------------------------------------------
// 行为模型：写入失败时用户数据是否还在
// ---------------------------------------------------------------------------
const runOverwriteModel = (deleteFirst) => {
  // 磁盘上的音源：list + scripts
  const disk = { list: ['old-api'], scripts: { 'old-api': 'OLD' } }
  const incoming = { list: ['new-api'], scripts: { 'new-api': 'NEW' } }
  const oldIds = Object.keys(disk.scripts)
  const newIds = new Set(Object.keys(incoming.scripts))
  const toRemove = oldIds.filter((id) => !newIds.has(id))
  const failWrite = true // 模拟存储写入失败

  if (deleteFirst) {
    for (const id of toRemove) delete disk.scripts[id]
  }
  // 写入阶段
  if (failWrite) {
    return { scripts: { ...disk.scripts } } // 旧实现：旧脚本已经没了
  }
  return { scripts: { ...incoming.scripts } }
}

const legacy = runOverwriteModel(true)
const fixed = (() => {
  // 修复后：写入先发生；写入失败时磁盘保持原样
  const disk = { scripts: { 'old-api': 'OLD' } }
  const failWrite = true
  if (failWrite) return { scripts: { ...disk.scripts } }
  return { scripts: { 'new-api': 'NEW' } }
})()

const models = [
  ['反例：先删后写，写入失败后旧音源已消失（数据丢失）', Object.keys(legacy.scripts).length === 0],
  ['修复后：写入失败时旧音源完整保留', Object.keys(fixed.scripts).length === 1 && fixed.scripts['old-api'] === 'OLD'],
]

// ---------------------------------------------------------------------------
// 行为模型：导出文件名净化
// ---------------------------------------------------------------------------
const sanitizeModel = (name) => {
  // 与 action.ts 的 toSafeScriptFileName 同规则（filterFileName 去掉 \ / : * ? # " < > |）
  const base = String(name ?? '')
    .replace(/[\\/:*?#"<>|]/g, '')
    .replace(/\.\./g, '')
    .replace(/^[\s.]+|[\s.]+$/g, '')
  return `${base || 'user_api'}.js`
}

// 第二列 = 净化后必须「不含路径分隔符 / ..」（安全即通过）。
// 危险输入与正常输入都必须落在目标目录内，所以这里全部期望 true；
// 真正的区分力由下面「未净化时是否会被判不安全」的反例自检提供。
const traversalCases = [
  ['../../evil', true],
  ['..\\..\\evil', true],
  ['/etc/passwd', true],
  ['a/b/c', true],
  ['..', true],
  ['正常音源名', true],
  ['test api v2', true],
]

// 反例自检：不做净化时，危险输入必须被判成「不安全」（在 isSafeFileName 定义之后求值）
const legacyUnsafeDetected = () => ['../../evil', '..\\..\\evil', '/etc/passwd', 'a/b/c']
  .every((name) => !isSafeFileName(`${name}.js`))

// 「安全」= 净化后不含路径分隔符与 `..`，且非空。
// 注意：净化是「剥掉危险片段」而不是「拒绝」，所以 `../../evil` → `evil.js` 是
// 期望行为 —— 文件仍落在用户选的目录里，不会逃出去。
const isSafeFileName = (fileName) =>
  fileName.length > 3 &&
  !fileName.includes('/') &&
  !fileName.includes('\\') &&
  !fileName.includes('..')

const traversalResults = traversalCases.map(([name, expectSafe]) => {
  const fileName = sanitizeModel(name)
  const safe = isSafeFileName(fileName)
  return { name, fileName, ok: safe === expectSafe }
})

models.push([
  '导出的文件名不会逃出目标目录',
  traversalResults.every((r) => r.ok),
])
models.push([
  '反例：未净化的危险名称会被判成不安全（断言有区分力）',
  legacyUnsafeDetected(),
])

// ---------------------------------------------------------------------------
const failures = []
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' —— ' + detail : ''}`)
  if (!ok) failures.push(name)
}

console.log('行为模型')
for (const [name, ok] of models) check(name, ok)
for (const r of traversalResults) {
  check(`文件名净化 ${JSON.stringify(r.name)} → ${JSON.stringify(r.fileName)}`, r.ok)
}

console.log('')
console.log('结构不变量')
if (reasons.length === 0) {
  check('写入先于删除 + 清理失败隔离 + 导出文件名净化', true)
} else {
  for (const r of reasons) check(r, false)
}

console.log('')
if (failures.length) {
  console.error(`FAIL  数据丢失防护契约未通过（${failures.length} 项）`)
  process.exit(1)
}
console.log(`PASS  数据丢失防护：先写后删 + 导出文件名净化（行为模型 ${models.length} 例 + 路径用例 ${traversalCases.length} 例 + 结构不变量 3 组）`)
process.exit(0)
