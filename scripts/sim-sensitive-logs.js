/**
 * sim-sensitive-logs.js
 *
 * 会话凭据与用户数据不得进入日志：
 *   - 登录 Cookie 只允许打印长度/字段名；
 *   - 同步 authCode 不得出现在任何 console 调用；
 *   - deeplink 只允许打印类型/动作，不得打印完整 params、带数据的路径或 hash。
 *
 * 背景（2026-10 全仓审查 P2）：QQ 登录把完整 Cookie、同步连接把 authCode、
 * deeplink 把完整 params / 原始 URL 打进日志（Release 也保留 console，设备日志可读）。
 *
 * 运行：node scripts/sim-sensitive-logs.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  qqLogin: 'src/components/login/QQWebLoginModal.tsx',
  syncAuth: 'src/plugins/sync/client/auth.ts',
  deeplink: 'src/core/init/deeplink/index.ts',
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const REAL = Object.fromEntries(Object.entries(FILES).map(([key, rel]) => [key, read(rel)]))

// 只禁"打印变量值"；允许 cookieString.length 这类安全预览（负向前瞻排除 . 属性访问）
const FORBIDDEN = [
  [/console\.\w+\([^)]*\bcookieString\b(?!\s*\.)/, '打印了完整 Cookie 字符串'],
  [/console\.\w+\([^)]*\bauthCode\b(?!\s*\.)/, '打印了同步 authCode'],
  [/console\.\w+\([^)]*\b(password|passwd)\b(?!\s*\.)/, '打印了密码'],
  [/console\.\w+\([^)]*\b(accessToken|access_token)\b(?!\s*\.)/, '打印了访问令牌'],
]

const structuralReasons = (files) => {
  const reasons = []
  for (const src of Object.values(files)) {
    for (const [re, msg] of FORBIDDEN) {
      if (re.test(src)) reasons.push(`console ${msg}`)
    }
  }
  if (!/captured cookies length=/.test(files.qqLogin)) {
    reasons.push('QQ 登录日志没有保留安全的 Cookie 预览（仅 length/字段名）')
  }
  if (/console\.log\(params\)/.test(files.deeplink)) {
    reasons.push('deeplink 打印了完整 params（data 可能含用户导入数据）')
  }
  if (/console\.log\('deeplink',\s*(url|initialUrl)\)/.test(files.deeplink)) {
    reasons.push('deeplink 打印了原始 URL（# 后可能携带数据）')
  }
  if (!/deeplinkLogLabel\(/.test(files.deeplink)) {
    reasons.push('deeplink 日志没有使用脱敏标签（只保留类型/动作）')
  }
  return reasons
}

// 行为模型：同一段日志在旧/新实现下是否命中禁令
const modelLegacy = "console.log('QQ登录: CookieManager captured cookies:', cookieString)"
// eslint-disable-next-line no-template-curly-in-string -- 反例样本必须原样保留模板字面量
const modelFixed = 'console.log(`QQ登录: CookieManager captured cookies length=${cookieString.length}`)'
const models = [
  ['反例：旧实现把完整 Cookie 打进日志（必须命中禁令）', FORBIDDEN[0][0].test(modelLegacy) === true],
  ['修复后日志只含长度（不再命中禁令）', FORBIDDEN[0][0].test(modelFixed) === false],
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

// C1：退回"打印完整 Cookie"
checkCase('C1 打印完整 Cookie', () => ({
  qqLogin: tamper(REAL.qqLogin,
    // eslint-disable-next-line no-template-curly-in-string -- tamper 锚点必须与真实源码逐字一致
    '      console.log(`QQ登录: CookieManager captured cookies length=${cookieString.length} names=[${cookieList.map(c => c.name).join(\',\')}]`)',
    "      console.log('QQ登录: CookieManager captured cookies:', cookieString)"),
}), '打印了完整 Cookie 字符串')

// C2：退回"打印 authCode"
checkCase('C2 打印同步 authCode', () => ({
  syncAuth: tamper(REAL.syncAuth,
    "  console.log('connect: ', urlInfo.href)",
    "  console.log('connect: ', urlInfo.href, authCode)"),
}), '打印了同步 authCode')

// C3：退回"打印完整 deeplink params"
checkCase('C3 打印完整 deeplink params', () => ({
  deeplink: tamper(REAL.deeplink,
    "  console.log('[deeplink]', deeplinkLogLabel(link), 'paths:', params.paths.length)",
    '  console.log(params)'),
}), '打印了完整 params')

// C4：退回"打印原始 deeplink URL"
checkCase('C4 打印原始 deeplink URL', () => ({
  deeplink: tamper(REAL.deeplink,
    "    console.log('deeplink', deeplinkLogLabel(url))",
    "    console.log('deeplink', url)"),
}), '打印了原始 URL')

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
  console.error(`FAIL  敏感日志契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
if (realReasons.length || failedModels.length || missed.length) {
  console.error(`\nFAIL  敏感日志契约未通过：结构不变量 ${realReasons.length} 项、行为模型失败 ${failedModels.length} 例、反例漏检 ${missed.length} 例`)
  process.exit(1)
}
console.log(`PASS  凭据与用户数据不再进入日志（结构不变量 7 组 + 行为模型 ${models.length} 例 + 反例 ${cases.length} 例）`)
process.exit(0)
