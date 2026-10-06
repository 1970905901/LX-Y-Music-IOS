/**
 * run-sim-all.js
 *
 * 聚合执行 scripts/sim-*.js 全部契约脚本：顺序运行、汇总结果、任一失败则退出码 1。
 *
 * 为什么需要它：这些契约（结构不变量 + 行为模型 + 反例自检）过去只在本机手动
 * 逐个执行，CI 完全看不到 —— 改动破坏不变量时没有任何自动拦截，只能等人想起来
 * 手动跑。接入 CI（build-test.yml / ios-ipa.yml 的 npm run sim）后，所有契约在
 * lint 之后、打包之前被强制检查；任一失败会直接指出脚本名与失败断言。
 *
 * 运行：node scripts/run-sim-all.js（或 npm run sim）
 * 退出码：全部通过 0，任一失败 1。
 */

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
// 单个脚本的上限：契约脚本都是纯文本/静态断言，正常秒级完成；超时视为失败，
// 避免某个脚本挂死时把 CI 卡到 workflow 级超时。
const PER_SCRIPT_TIMEOUT_MS = 120000

const scripts = fs.readdirSync(__dirname)
  .filter((name) => /^sim-.*\.js$/.test(name))
  .sort()

if (scripts.length === 0) {
  console.error('FAIL  未找到任何 sim-*.js 契约脚本')
  process.exit(1)
}

const failures = []
const startedAt = Date.now()
for (const name of scripts) {
  const result = spawnSync(process.execPath, [path.join(__dirname, name)], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: PER_SCRIPT_TIMEOUT_MS,
  })
  const ok = result.status === 0
  const tail = (result.stdout || '').trim().split('\n').filter(Boolean).pop() || ''
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${tail ? ' — ' + tail : ''}`)
  if (!ok) {
    failures.push(name)
    // 失败时把脚本完整输出与 stderr 打出来（CI 日志里直接可见失败断言）
    if (result.stdout) console.log(result.stdout.trimEnd())
    if (result.stderr) console.error(result.stderr.trimEnd())
    if (result.error) console.error(String(result.error.message || result.error))
  }
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
console.log('')
if (failures.length > 0) {
  console.error(`FAIL  sim 契约失败 ${failures.length}/${scripts.length}：${failures.join(', ')}（${elapsed}s）`)
  process.exit(1)
}
console.log(`PASS  sim 契约全部通过（${scripts.length} 个，${elapsed}s）`)
