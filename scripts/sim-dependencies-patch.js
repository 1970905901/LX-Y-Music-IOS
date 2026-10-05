/**
 * sim-dependencies-patch.js
 *
 * 依赖补丁（postinstall）必须"失败即失败"：
 *   - 补丁锚点缺失 / 正则不匹配 / 文件缺失时，进程退出码必须非 0，
 *     不能打一行 console.error 就继续（否则构建成功但原生能力悄悄缺失）；
 *   - 已应用判定允许"其它补丁在同一插入点添加了内容"，但必须是 to 相对 from
 *     新增的全部代码行都在，且必须确认前置锚点 from 已不存在——同一次运行里另一个
 *     补丁在别处插入同样的几行（destroy / reset 都写相同的 soundEffect 清理），
 *     否则必做的插入会被误判为"已应用"而静默跳过；
 *   - equalizer 时代（旧补丁遗留）的锚点在全新安装里必然不存在，必须标 optional，
 *     否则 CI 的 npm install → postinstall 会直接失败（2026-10-05 CI run #947 实测）。
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
const LEGACY_RE = /equalizedPlayerItem|equalizerEnabled|equalizerGains|refreshEqualizerAudioMix|applySoundEffectConfig/

const structuralReasons = (src) => {
  const reasons = []
  if (!/process\.exitCode = 1/.test(src)) reasons.push('补丁失败没有设置非 0 退出码（安装/CI 会误报成功）')
  if (!/const failures = \[\]/.test(src) || !/failures\.push\(/.test(src)) reasons.push('补丁失败没有被记录到 failures')
  if (!/if \(failures\.length\)/.test(src)) reasons.push('没有在汇总后决定失败')
  if (!/Patch anchor not found/.test(src)) reasons.push('patchFile 锚点缺失被静默跳过（补丁丢失无人知晓）')
  if (!/addedLines\.every\(/.test(src)) reasons.push('缺少"新增行全部存在才算已应用"的幂等判定')
  if (!/!fromStillPresent && addedLines\.length > 0/.test(src)) reasons.push('已应用判定没有确认前置锚点 from 是否仍在（同批补丁在别处插入相同行时会误判已应用）')
  if (!/throw new Error\('Patch pattern not found'\)/.test(src)) reasons.push('patchFileByRegex 模式不匹配不再抛错')
  if (!/optional: true/.test(src)) reasons.push('patchFile 缺少 optional 迁移分支（旧机器遗留态无法跳过）')
  if (/Patch \$\{target\.filePath\} failed/.test(src)) reasons.push('旧的"只打日志不失败"的吞错分支又回来了')
  return reasons
}

// 逐个补丁块解析（每块形如 6 空格 { ... 6 空格 },）
const changeBlocks = (src) => {
  const blocks = []
  const re = /^ {6}\{\n([\s\S]*?)^ {6}\},$/gm
  let m
  while ((m = re.exec(src))) blocks.push(m[1])
  return blocks
}

const legacyAnchorReasons = (src) => {
  const reasons = []
  const openBraces = (src.match(/^ {6}\{$/gm) || []).length
  const blocks = changeBlocks(src)
  if (blocks.length !== openBraces) reasons.push(`补丁块解析失败（${blocks.length} != ${openBraces}），回归检查已失效`)
  for (const block of blocks) {
    const fromMatch = block.match(/^ {8}from: `([\s\S]*?)^`,$/m)
    if (!fromMatch) continue
    if (!LEGACY_RE.test(fromMatch[1])) continue
    if (!/^ {8}optional: true,$/m.test(block)) {
      reasons.push(`equalizer 时代的锚点没有标 optional（全新安装必然锚点缺失 → npm install 失败）：${fromMatch[1].trim().split('\n')[0].slice(0, 60)}`)
    }
  }
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

const SYNTH_FILE = 'synthetic/RNTrackPlayer.swift'
const SYNTH_ONE = '        a.stop()\n        sharedOneLine = nil\n        sharedTwoLineLongEnough = nil\n        a.clear()\n'
const SYNTH_TWO = '        b.stop()\n        sharedOneLine = nil\n        sharedTwoLineLongEnough = nil\n        b.clear()\n'

/**
 * 合成引擎用例：两个位于不同函数、但要插入同样几行的补丁。
 * 保护生效时两处都必须落地；去掉保护后第二处会被误判为"已应用"而静默跳过。
 */
const buildEngineSandbox = (mutatePatcher) => {
  const dir = makeSandbox()
  const patcherPath = path.join(dir, 'dependencies-patch.js')
  let patcher = fs.readFileSync(patcherPath, 'utf8').replace(/\r\n/g, '\n')
  const arrStart = patcher.indexOf('const patchTargets = [')
  const arrEnd = patcher.indexOf('\n]\n', arrStart)
  if (arrStart < 0 || arrEnd < 0) throw new Error('patchTargets 数组定位失败')
  const synthetic = [
    'const patchTargets = [',
    '  {',
    "    filePath: '" + SYNTH_FILE + "',",
    '    changes: [',
    '      {',
    '        from: `        a.stop()',
    '        a.clear()',
    '`,',
    '        to: `        a.stop()',
    '        sharedOneLine = nil',
    '        sharedTwoLineLongEnough = nil',
    '        a.clear()',
    '`,',
    '      },',
    '      {',
    '        from: `        b.stop()',
    '        b.clear()',
    '`,',
    '        to: `        b.stop()',
    '        sharedOneLine = nil',
    '        sharedTwoLineLongEnough = nil',
    '        b.clear()',
    '`,',
    '      },',
    '    ],',
    '  },',
    ']',
  ].join('\n')
  patcher = patcher.slice(0, arrStart) + synthetic + patcher.slice(arrEnd + 3)
  patcher = patcher.replace("  await runStep('SwiftAudio seek patch', patchSwiftAudioSeek)\n", '')
  patcher = patcher.replace("  await runStep('TrackPlayer sound effect refresh', patchTrackPlayerSoundEffectRefresh)\n", '')
  if (mutatePatcher) patcher = mutatePatcher(patcher)
  fs.writeFileSync(patcherPath, patcher)
  const filePath = path.join(dir, SYNTH_FILE)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, ['        a.stop()', '        a.clear()', '', '        b.stop()', '        b.clear()', ''].join('\n'), 'utf8')
  return { dir, filePath }
}

const engineMissing = (sandbox) => {
  const result = fs.readFileSync(sandbox.filePath, 'utf8').replace(/\r\n/g, '\n')
  return [SYNTH_ONE, SYNTH_TWO].filter((t) => !result.includes(t)).map((t) => t.trim().split('\n')[0])
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
    const mutated = mutate(SRC)
    reasons = structuralReasons(mutated).concat(legacyAnchorReasons(mutated))
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

checkCase('C6 equalizer 时代锚点漏标 optional（本次 CI 失败的形态）',
  (src) => src.replace('        optional: true,\n        from: `    private var hasInitialized = false', '        from: `    private var hasInitialized = false'),
  '没有标 optional')

checkCase('C7 已应用判定不再确认前置锚点（本次 CI 静默缺件的形态）',
  (src) => src.replace('!fromStillPresent && addedLines.length > 0', 'addedLines.length > 0'),
  '前置锚点')

const realReasons = structuralReasons(SRC).concat(legacyAnchorReasons(SRC))
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

// 行为验证 4：同一批补丁在两个不同函数插入相同代码行时，两处都必须落地
let engine = null
if (realReasons.length === 0) {
  engine = buildEngineSandbox(null)
  engine.run = runPatcher(engine.dir)
  engine.missing = engineMissing(engine)
}

// 行为验证 5（反例自检）：去掉前置锚点保护后，第二处必须被误判跳过（证明 4 有区分力）
let engineTampered = null
if (realReasons.length === 0) {
  engineTampered = buildEngineSandbox((patcher) => patcher.replace('!fromStillPresent && addedLines.length > 0', 'addedLines.length > 0'))
  engineTampered.run = runPatcher(engineTampered.dir)
  engineTampered.missing = engineMissing(engineTampered)
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
if (engine) console.log(`${engine.run.status === 0 && engine.missing.length === 0 ? 'PASS' : 'FAIL'}  同批补丁在别处插入相同行：两处插入都落地（exit=${engine.run.status}，静默跳过 ${engine.missing.length} 处${engine.missing.length ? ' → ' + engine.missing.join(' | ') : ''}）`)
if (engineTampered) console.log(`${engineTampered.missing.length > 0 ? 'PASS' : 'FAIL'}  反例：去掉前置锚点保护后第二处被静默跳过 ${engineTampered.missing.length} 处${engineTampered.missing.length ? ' → ' + engineTampered.missing.join(' | ') : ''}`)

for (const dir of [sandboxDir, engine && engine.dir, engineTampered && engineTampered.dir]) {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
}

if (realReasons.length) {
  console.error(`\nFAIL  依赖补丁契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
const realRunBad = realRun && realRun.status !== 0
const sandboxBad = sandboxFail && sandboxFail.status === 0
const tamperBad = sandboxTampered && sandboxTampered.status !== 0
const engineBad = engine && (engine.run.status !== 0 || engine.missing.length > 0)
const engineTamperBad = engineTampered && engineTampered.missing.length === 0
if (realRunBad) console.error('\nFAIL  真实依赖目录运行失败：\n' + (realRun.stderr || realRun.stdout))
if (sandboxBad) console.error('\nFAIL  缺依赖沙箱竟然退出 0（失败被吞掉）')
if (tamperBad) console.error('\nFAIL  反例未通过（拿掉退出码后仍然失败，说明测试没有区分力）')
if (engineBad) console.error('\nFAIL  同批补丁在别处插入相同行时被静默跳过：\n' + ((engine.run && (engine.run.stderr || engine.run.stdout)) || ''))
if (engineTamperBad) console.error('\nFAIL  反例未通过（去掉前置锚点保护后两处仍都落地，说明测试没有区分力）')

if (realReasons.length || failedModels.length || missed.length || realRunBad || sandboxBad || tamperBad || engineBad || engineTamperBad) {
  console.error('\nFAIL  依赖补丁失败即失败契约未通过')
  process.exit(1)
}
console.log(`\nPASS  依赖补丁契约（结构不变量 ${structuralReasons(SRC).length === 0 ? '通过' : '未通过'} + 行为模型 ${models.length} 例 + 反例 ${cases.length} 例 + 行为验证 5 例）`)
process.exit(0)
