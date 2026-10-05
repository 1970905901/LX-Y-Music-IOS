/**
 * sim-dependencies-patch.js
 *
 * 依赖补丁（postinstall）必须"失败即失败"：
 *   - 补丁锚点缺失 / 正则不匹配 / 文件缺失时，进程退出码必须非 0，
 *     不能打一行 console.error 就继续（否则构建成功但原生能力悄悄缺失）；
 *   - 已应用判定允许"其它补丁在同一插入点添加了内容"，但必须是 to 相对 from
 *     新增的全部代码行都在，避免用巧合单行误判为已应用。
 *
 * 运行：node scripts/sim-dependencies-patch.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PATCHER = path.join(ROOT, 'dependencies-patch.js')
const SRC = fs.readFileSync(PATCHER, 'utf8').replace(/\r\n/g, '\n')

const structuralReasons = (src) => {
  const reasons = []
  if (!/process\.exitCode = 1/.test(src)) reasons.push('补丁失败没有设置非 0 退出码（安装/CI 会误报成功）')
  if (!/const failures = \[\]/.test(src) || !/failures\.push\(/.test(src)) reasons.push('补丁失败没有被记录到 failures')
  if (!/if \(failures\.length\)/.test(src)) reasons.push('没有在汇总后决定失败')
  if (!/Patch anchor not found/.test(src)) reasons.push('patchFile 锚点缺失被静默跳过（补丁丢失无人知晓）')
  if (!/addedLines\.every\(/.test(src)) reasons.push('缺少"新增行全部存在才算已应用"的幂等判定')
  if (!/throw new Error\('Patch pattern not found'\)/.test(src)) reasons.push('patchFileByRegex 模式不匹配不再抛错')
  if (/Patch \$\{target\.filePath\} failed/.test(src)) reasons.push('旧的"只打日志不失败"的吞错分支又回来了')
  return reasons
}

const runPatcher = (cwd) => spawnSync(process.execPath, ['dependencies-patch.js'], { cwd, encoding: 'utf8' })

const copyFileInto = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

const makeSandbox = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-patch-sim-'))
  copyFileInto(PATCHER, path.join(dir, 'dependencies-patch.js'))
  copyFileInto(path.join(ROOT, 'patches/ios/LXEqualizerAudioMix.swift'), path.join(dir, 'patches/ios/LXEqualizerAudioMix.swift'))
  copyFileInto(path.join(ROOT, 'patches/ios/LXSharedIRConvolutionBridge.h'), path.join(dir, 'patches/ios/LXSharedIRConvolutionBridge.h'))
  copyFileInto(path.join(ROOT, 'patches/ios/LXSharedIRConvolutionBridge.mm'), path.join(dir, 'patches/ios/LXSharedIRConvolutionBridge.mm'))
  copyFileInto(path.join(ROOT, 'ios/LxMusicMobile/LXSharedIRConvolutionKernel.hpp'), path.join(dir, 'ios/LxMusicMobile/LXSharedIRConvolutionKernel.hpp'))
  return dir
}

const legacyCatch = "catch (err) { console.error('Patch failed: ' + err.message) }"
const models = [
  ['反例：旧的吞错 catch 既不记录失败也不设置退出码',
    /catch/.test(legacyCatch) && !/exitCode|throw/.test(legacyCatch)],
  ['修复后：补丁失败被记录并 process.exitCode = 1',
    /process\.exitCode = 1/.test(SRC)],
]

const cases = []
const checkCase = (name, mutate, expectSubstr) => {
  let reasons = []
  try {
    reasons = structuralReasons(mutate(SRC))
  } catch (err) {
    cases.push([name, false, `异常: ${err.message}`])
    return
  }
  const hit = reasons.some((r) => r.includes(expectSubstr))
  cases.push([name, hit, hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）`])
}

checkCase('C1 失败不再设置退出码', (src) => src.replace('    process.exitCode = 1\n', ''), '非 0 退出码')

// eslint-disable-next-line no-template-curly-in-string -- 反例样本必须原样保留模板字面量
checkCase('C2 补丁失败不再记录', (src) => src.replace('      failures.push(`${name}: ${message}`)\n', ''), '没有被记录到 failures')

checkCase('C3 锚点缺失静默跳过', (src) => src.replace('Patch anchor not found', 'patch skipped'), '静默跳过')

checkCase('C4 幂等判定退回单行标记', (src) => src.replace('addedLines.every((line) => normalizedFile.includes(line))', 'normalizedFile.includes(String(to).split(\'\\n\')[1])'), '幂等判定')

checkCase('C5 正则不匹配不再抛错', (src) => src.replace("throw new Error('Patch pattern not found')", 'return'), '不再抛错')

const realReasons = structuralReasons(SRC)
const failedModels = models.filter(([, ok]) => !ok)
const missed = cases.filter(([, ok]) => !ok)

// 行为验证 1：真实依赖目录必须 exit=0（幂等、无误报）
let realRun = null
if (realReasons.length === 0) {
  realRun = runPatcher(ROOT)
}

// 行为验证 2：缺依赖的沙箱必须 exit!=0
let sandboxFail = null
let sandboxDir = null
if (realReasons.length === 0) {
  sandboxDir = makeSandbox()
  sandboxFail = runPatcher(sandboxDir)
}

// 行为验证 3（反例自检）：拿掉退出码设置后，同一沙箱必须 exit=0（证明上面的失败断言有区分力）
let sandboxTampered = null
if (sandboxDir) {
  const tamperedPath = path.join(sandboxDir, 'dependencies-patch.js')
  const tampered = fs.readFileSync(tamperedPath, 'utf8').replace(/\r\n/g, '\n').replace('    process.exitCode = 1\n', '')
  fs.writeFileSync(tamperedPath, tampered)
  sandboxTampered = runPatcher(sandboxDir)
}

console.log('行为模型')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of cases) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')
console.log('行为验证')
if (realRun) console.log(`${realRun.status === 0 ? 'PASS' : 'FAIL'}  真实依赖目录运行 exit=${realRun.status}（期望 0）`)
if (sandboxFail) console.log(`${sandboxFail.status !== 0 ? 'PASS' : 'FAIL'}  缺依赖沙箱运行 exit=${sandboxFail.status}（期望非 0）`)
if (sandboxTampered) console.log(`${sandboxTampered.status === 0 ? 'PASS' : 'FAIL'}  反例：拿掉退出码后沙箱 exit=${sandboxTampered.status}（期望 0）`)

if (sandboxDir) fs.rmSync(sandboxDir, { recursive: true, force: true })

if (realReasons.length) {
  console.error(`\nFAIL  依赖补丁契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
const realRunBad = realRun && realRun.status !== 0
const sandboxBad = sandboxFail && sandboxFail.status === 0
const tamperBad = sandboxTampered && sandboxTampered.status !== 0
if (realRunBad) console.error('\nFAIL  真实依赖目录运行失败：\n' + (realRun.stderr || realRun.stdout))
if (sandboxBad) console.error('\nFAIL  缺依赖沙箱竟然退出 0（失败被吞掉）')
if (tamperBad) console.error('\nFAIL  反例未通过（拿掉退出码后仍然失败，说明测试没有区分力）')

if (realReasons.length || failedModels.length || missed.length || realRunBad || sandboxBad || tamperBad) {
  console.error('\nFAIL  依赖补丁失败即失败契约未通过')
  process.exit(1)
}
console.log(`\nPASS  依赖补丁失败即失败（结构不变量 7 组 + 行为模型 ${models.length} 例 + 反例 ${cases.length} 例 + 行为验证 3 例）`)
process.exit(0)
