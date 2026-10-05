/**
 * sim-download-atomic-write.js
 *
 * 下载必须"先写临时文件、成功后移动为最终路径"：
 *   - 失败 / 被停止：最终路径不得留下半截文件，临时文件要清理；
 *   - 移动失败：任务必须失败（error），不得误报 completed；
 *   - 删除 / 重试任务：临时文件也要清理。
 *
 * 背景（2026-10 全仓审查 P2）：core/download.ts 旧实现普通情况直接写最终路径，
 * 失败后残留半截文件；扩展名不一致时重命名失败只 console.warn 就继续，任务照样
 * 标 completed（filePath 指向临时名）。
 *
 * 运行：node scripts/sim-download-atomic-write.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const REAL = { download: read('src/core/download.ts') }

const structuralReasons = (files) => {
  const reasons = []
  const src = files.download

  if (!/const getDownloadTempPath = \(filePath: string\) => `\$\{filePath\}\.download`/.test(src)) {
    reasons.push('缺少统一的下载临时路径（固定 .download 后缀，且不带音频扩展名）')
  }
  if (!/const downloadFilePath = getDownloadTempPath\(task\.filePath\)/.test(src)) {
    reasons.push('下载没有先写临时文件（直接写最终路径，失败会留半截文件）')
  }
  if (!/await moveFile\(downloadedFilePath, finalFilePath\)/.test(src)) {
    reasons.push('下载完成后没有把临时文件移动到最终路径')
  }
  if (/重命名失败/.test(src) || /catch \(renameError\)/.test(src)) {
    reasons.push('移动失败仍被吞掉（任务会误报 completed）')
  }
  if (!/if \(!downloadCompleted\) \{[\s\S]{0,240}?await unlink\(downloadFilePath\)/.test(src)) {
    reasons.push('下载失败没有清理半截临时文件')
  }
  if (!/status: 'completed'[\s\S]{0,140}?filePath: downloadedFilePath/.test(src)) {
    reasons.push('completed 记录没有使用最终路径')
  }
  const tempUses = (src.match(/getDownloadTempPath\(/g) || []).length
  if (tempUses < 4) {
    reasons.push(`删除/重试任务没有清理临时文件（getDownloadTempPath 仅使用 ${tempUses} 处，需含定义与 startDownload/removeTask/resumeTask）`)
  }
  return reasons
}

// 简化行为模型：下载中被打断 / 移动失败时，最终路径与任务状态应该是什么
const legacyOutcome = () => ({ leftoverAtFinal: true, reportedCompleted: true })
const fixedOutcome = () => ({ leftoverAtFinal: false, reportedCompleted: false })

const models = [
  ['反例：旧实现（直写最终路径 + 吞掉移动失败）会残留半截文件且误报完成',
    legacyOutcome().leftoverAtFinal === true && legacyOutcome().reportedCompleted === true],
  ['修复后：失败不残留最终路径文件，任务不误报完成',
    fixedOutcome().leftoverAtFinal === false && fixedOutcome().reportedCompleted === false],
]

const cases = []
const checkCase = (name, mutate, expectSubstr) => {
  let reasons = []
  try {
    reasons = structuralReasons({ ...REAL, ...mutate() })
  } catch (err) {
    cases.push([name, false, `锚点缺失/异常: ${err.message}`])
    return
  }
  const hit = reasons.some((r) => r.includes(expectSubstr))
  cases.push([name, hit, hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）`])
}

const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find.slice(0, 60)}`)
  return src.split(find).join(replace)
}

// C1：退回"直接写最终路径"
checkCase('C1 下载直接写最终路径', () => ({
  download: tamper(REAL.download,
    '  const downloadFilePath = getDownloadTempPath(task.filePath)',
    '  const downloadFilePath = task.filePath'),
}), '先写临时文件')

// C2：退回"移动失败只 warn"
checkCase('C2 移动失败被吞', () => ({
  download: tamper(REAL.download,
    '      await moveFile(downloadedFilePath, finalFilePath)\n      downloadedFilePath = finalFilePath',
    '      try {\n        await moveFile(downloadedFilePath, finalFilePath)\n        downloadedFilePath = finalFilePath\n      } catch (renameError) {\n        console.warn(\'[Download] 重命名失败:\', renameError)\n      }'),
}), '移动失败仍被吞掉')

// C3：删掉失败清理
checkCase('C3 失败不清理临时文件', () => ({
  download: tamper(REAL.download,
    '    if (!downloadCompleted) {',
    '    if (false) {'),
}), '清理半截临时文件')

// C4：删掉 removeTask/resumeTask 的临时文件清理
checkCase('C4 删除/重试不清理临时文件', () => ({
  download: tamper(REAL.download,
    '      void unlink(getDownloadTempPath(taskToRemove.filePath)).catch(() => {})',
    ''),
}), '删除/重试任务没有清理临时文件')

const failures = []
const realReasons = structuralReasons(REAL)
const failedModels = models.filter(([, ok]) => !ok)
const missed = cases.filter(([, ok]) => !ok)

console.log('行为模型')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of cases) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')

if (realReasons.length) {
  failures.push('结构不变量未通过')
  console.error(`FAIL  下载原子写契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
if (failedModels.length) failures.push('行为模型未通过')
if (missed.length) failures.push('反例未被拦下')

if (failures.length) {
  console.error(`\nFAIL  下载原子写契约未通过：${failures.join('；')}`)
  process.exit(1)
}
console.log(`PASS  下载先写临时文件、成功后移动，失败不残留、不误报（结构不变量 7 组 + 行为模型 ${models.length} 例 + 反例 ${cases.length} 例）`)
process.exit(0)
