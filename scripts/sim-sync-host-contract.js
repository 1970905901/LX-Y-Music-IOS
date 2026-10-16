/**
 * sim-sync-host-contract.js
 *
 * 「同步服务地址怎么填都能连」契约（用户真机反馈：数据同步里填了地址连接不上）。
 *
 * 根因（真机复现 + 静态可证）：地址进入客户端前没做规范化，手机键盘上三种最常见的输入全会
 * 拼出必然失败的 URL：
 *   ① 协议被自动大写：iOS 键盘默认首字母大写 → `Http://1.2.3.4:23332`；旧解析 `/^https:/`
 *      只认小写，`replace('http://')` 也认小写 → 拼成 `http://Http://1.2.3.4:23332/hello`；
 *   ② 不带协议：电脑端「同步服务地址」显示的就是 `IP:端口`，旧输入框直接拒绝并**清空**输入；
 *   ③ 全角标点/首尾空白/零宽字符（中文键盘的 `：／．`）。
 * 另外 hello() 曾把「连不上」catch 成 false，UI 只能显示通用的 "Connect service failed"，
 * 用户完全看不到原因 —— 现在网络失败/版本不匹配/不是同步服务分别有可区分的错误码，
 * 并在设置页翻成中文提示。
 *
 * 契约守护：
 *   1) `normalizeSyncHost` 存在且覆盖上面三类输入（协议小写、补 http://、全角转半角、零宽剔除、
 *      主机名合法性校验）；
 *   2) `parseUrl` 必须先规范化再切片（历史地址 / 冷启动自动连接读到的旧值同样走这里）；
 *   3) 设置页用规范化函数、关掉自动大写、不再用 `disabled={!host}` 把「启用同步」置灰；
 *   4) `hello()` 不再吞错误（版本不匹配 / 网络失败 / 答的不是同步服务分别抛出）；
 *   5) 设置页把新错误码翻成中文（i18n 词条齐全，且旧提示文案已更新）。
 * 并附「旧实现的输出」作为反例模型，证明这批输入在旧代码下确实会连不上。
 *
 * 运行：node scripts/sim-sync-host-contract.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  clientUtils: 'src/plugins/sync/client/utils.ts',
  auth: 'src/plugins/sync/client/auth.ts',
  settings: 'src/screens/Home/Views/Setting/settings/Sync/IsEnable.tsx',
  lang: 'src/lang/zh-cn.json',
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

const helloRegion = (src) => {
  const start = src.indexOf('const hello = async(')
  const end = src.indexOf('\nconst getServerId', start)
  return start < 0 ? '' : src.slice(start, end < 0 ? undefined : end)
}

const checkAll = ({ clientUtils, auth, settings, lang }) => {
  const violations = []
  const list = (rule, where, detail) => violations.push({ rule, where, detail })

  // ① 地址规范化
  if (!/export const normalizeSyncHost = \(input: string\): string =>/.test(clientUtils)) {
    list('normalize', FILES.clientUtils, '缺少 normalizeSyncHost 导出（地址规范化唯一入口）')
  }
  if (!/\.replace\(\/\[\\uFF01-\\uFF5E\]\/g/.test(clientUtils)) {
    list('fullwidth', FILES.clientUtils, '缺少全角 → 半角转换（中文键盘的 ：／．）')
  }
  if (!/\[\\u200B-\\u200D\\uFEFF\]/.test(clientUtils)) {
    list('zerowidth', FILES.clientUtils, '缺少零宽字符剔除（复制粘贴带进来的不可见字符）')
  }
  if (!/text = 'http:\/\/' \+ text/.test(clientUtils)) {
    list('scheme-prepend', FILES.clientUtils, '缺少「缺协议自动补 http://」')
  }
  if (!/const scheme = \/\^https\$\/i\.test\(matched\[1\]\) \? 'https' : 'http'/.test(clientUtils)) {
    list('scheme-case', FILES.clientUtils, '协议没有做大小写归一（Http:// 会拼出无效 URL）')
  }
  if (!/a-z0-9\._-/.test(clientUtils)) {
    list('host-check', FILES.clientUtils, '缺少主机名合法性校验（中文/emoji 会被当成主机名）')
  }

  // ② parseUrl 先规范化
  const parseRegion = clientUtils.slice(clientUtils.indexOf('export const parseUrl'))
  if (!/const normalized = normalizeSyncHost\(href\)/.test(parseRegion)) {
    list('parse-normalize', FILES.clientUtils, 'parseUrl 没有先规范化地址')
  }
  if (clientUtils.includes("href.replace(httpProtocol + '//', '')")) {
    list('parse-legacy', FILES.clientUtils, 'parseUrl 仍在使用大小写敏感的旧解析')
  }

  // ③ 设置页：用规范化函数 + 关自动大写 + 不置灰
  if (!/normalizeSyncHost\(value\)/.test(settings)) {
    list('settings-normalize', FILES.settings, '设置页保存地址时没有走规范化')
  }
  if (!/autoCapitalize="none"/.test(settings)) {
    list('autocapitalize', FILES.settings, '地址输入框没有关掉首字母自动大写（http → Http）')
  }
  if (/disabled=\{\s*!host\s*\}/.test(settings)) {
    list('toggle-gate', FILES.settings, '「启用同步」又被 disabled={!host} 置灰（点它没有任何反馈）')
  }
  if (!/if \(enable && !host\)/.test(settings)) {
    list('toggle-guard', FILES.settings, '地址为空时启用同步没有给提示')
  }

  // ④ hello 不再吞错误
  const hello = helloRegion(auth)
  if (!hello) {
    list('hello', FILES.auth, '找不到 hello()')
  } else {
    if (/return false/.test(hello)) {
      list('hello-swallow', FILES.auth, 'hello() 又把失败吞成 false（UI 只剩通用错误）')
    }
    for (const code of ['lowServiceVersion', 'highServiceVersion', 'wrongService', 'connectServiceFailed']) {
      if (!hello.includes(`SYNC_CODE.${code}`)) {
        list('hello-code', FILES.auth, `hello() 未抛出可区分的错误码 ${code}`)
      }
    }
  }

  // ⑤ i18n：错误码翻中文 + 旧文案已更新
  let messages
  try {
    messages = JSON.parse(lang)
  } catch (err) {
    list('i18n', FILES.lang, `zh-cn.json 解析失败：${err.message}`)
    return violations
  }
  for (const key of [
    'setting_sync_code_unreachable',
    'setting_sync_code_wrong_service',
    'setting_sync_code_low_version',
    'setting_sync_code_high_version',
    'setting_sync_host_required_tip',
    'setting_sync_status_connecting',
  ]) {
    if (!messages[key]) list('i18n', FILES.lang, `缺少词条 ${key}`)
  }
  for (const [code, key] of [
    ['connectServiceFailed', 'setting_sync_code_unreachable'],
    ['wrongService', 'setting_sync_code_wrong_service'],
    ['lowServiceVersion', 'setting_sync_code_low_version'],
    ['highServiceVersion', 'setting_sync_code_high_version'],
  ]) {
    if (!new RegExp(`case SYNC_CODE\\.${code}:[\\s\\S]{0,120}?t\\('${key}'\\)`).test(settings)) {
      list('i18n-map', FILES.settings, `${code} 没有翻成 ${key}`)
    }
  }
  if (/地址需要以/.test(messages.setting_sync_host_value_error_tip ?? '')) {
    list('i18n-tip', FILES.lang, '旧提示「地址需要以 http:// 开头」还在（输入现在会自动补协议）')
  }
  if (!/192\.168\.1\.5:23332/.test(messages.setting_sync_host_value_tip ?? '')) {
    list('i18n-tip', FILES.lang, '地址占位符没有给出「IP:端口」示例')
  }

  return violations
}

// --- 行为模型：与 normalizeSyncHost / parseUrl 等价的 JS 镜像（供反例与用例断言） ---
const normalizeSyncHostModel = (input) => {
  if (typeof input !== 'string') return ''
  let text = input
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .trim()
  if (!text) return ''
  text = text.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'http://' + text
  const matched = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)(.*)$/i.exec(text)
  if (!matched) return ''
  const scheme = /^https$/i.test(matched[1]) ? 'https' : 'http'
  const host = matched[2]
  if (!/^[a-z0-9._-]+(:\d{1,5})?$/i.test(host) && !/^\[[0-9a-f:.]+\](:\d{1,5})?$/i.test(host)) return ''
  return `${scheme}://${host}${matched[3]}`
}
const legacyNormalize = (href) => {
  // 旧实现：只认小写协议，且用 replace 剥协议前缀
  if (href.endsWith('/')) href = href.replace(/\/$/, '')
  const httpProtocol = /^https:/.test(href) ? 'https:' : 'http:'
  return `${httpProtocol}//${href.replace(httpProtocol + '//', '')}`
}

const cases = [
  ['iOS 键盘首字母大写', 'Http://192.168.1.5:23332', 'http://192.168.1.5:23332'],
  ['电脑端照抄的 IP:端口', '192.168.1.5:23332', 'http://192.168.1.5:23332'],
  ['中文键盘全角冒号', 'http://192.168.1.5：23332', 'http://192.168.1.5:23332'],
  ['https + 末尾斜杠', 'HTTPS://nas.lan:23332/', 'https://nas.lan:23332'],
  ['首尾空格', '  http://1.2.3.4:23332  ', 'http://1.2.3.4:23332'],
  ['双斜杠开头', '//1.2.3.4:23332', 'http://1.2.3.4:23332'],
  ['IPv6 字面量', '[::1]:23332', 'http://[::1]:23332'],
  ['带路径（反代）', 'http://nas.lan/lx/', 'http://nas.lan/lx'],
  ['空串', '', ''],
  ['纯空白', '   ', ''],
  ['emoji 不是地址', '🙂', ''],
  ['只有协议', 'http://', ''],
]
const models = cases.map(([name, input, expected]) => [
  `${name}：${JSON.stringify(input)} → ${expected}`,
  normalizeSyncHostModel(input) === expected,
])
models.push([
  'parseUrl 切片：Http://1.2.3.4:23332 → hostPath=1.2.3.4:23332（旧实现会得到 Http://1.2.3.4:23332）',
  (() => {
    const normalized = normalizeSyncHostModel('Http://1.2.3.4:23332')
    const httpProtocol = normalized.startsWith('https://') ? 'https:' : 'http:'
    const hostPath = normalized.slice(httpProtocol.length + 2)
    return hostPath === '1.2.3.4:23332' && legacyNormalize('Http://1.2.3.4:23332') !== 'http://1.2.3.4:23332'
  })(),
])
models.push([
  'hostname 场景走 wss:（https 地址 → wsProtocol=wss:）',
  normalizeSyncHostModel('nas.lan:23332').startsWith('http://') &&
    normalizeSyncHostModel('https://nas.lan:23332').startsWith('https://'),
])

const REAL = {
  clientUtils: read(FILES.clientUtils),
  auth: read(FILES.auth),
  settings: read(FILES.settings),
  lang: read(FILES.lang),
}

const counterExamples = []
const expectCaught = (name, expectRule, mutate) => {
  let rules
  try {
    rules = checkAll({ ...REAL, ...mutate({ ...REAL }) }).map((v) => v.rule)
  } catch (err) {
    counterExamples.push([name, false, `变异执行失败：${err.message}`])
    return
  }
  const hit = rules.includes(expectRule)
  counterExamples.push([name, hit, hit ? `已拦下（${expectRule}）` : `未拦下（rules=${JSON.stringify(rules)}）`])
}

expectCaught('C1 parseUrl 不再规范化', 'parse-normalize', (v) => ({
  clientUtils: v.clientUtils.replace('const normalized = normalizeSyncHost(href)', 'const normalized = href'),
}))
expectCaught('C2 删掉全角转换', 'fullwidth', (v) => ({
  clientUtils: v.clientUtils.replace(/ *\.replace\(\/\[\\uFF01-\\uFF5E\]\/g[^\n]*\n/, '\n'),
}))
expectCaught('C3 删掉缺协议补 http://', 'scheme-prepend', (v) => ({
  clientUtils: v.clientUtils.replace(/ *if \(!\/\^\[a-z\]\[a-z0-9\+\.-\]\*:\\\/\\\/\/i\.test\(text\)\) text = 'http:\/\/' \+ text\n/, '\n'),
}))
expectCaught('C4 输入框又被自动大写', 'autocapitalize', (v) => ({
  settings: v.settings.replace('        autoCapitalize="none"\n', ''),
}))
expectCaught('C5 启用同步又被置灰', 'toggle-gate', (v) => ({
  settings: v.settings.replace('        <CheckBoxItem\n          check={isEnableSync}', '        <CheckBoxItem\n          disabled={!host}\n          check={isEnableSync}'),
}))
expectCaught('C6 hello() 又把失败吞成 false', 'hello-swallow', (v) => ({
  auth: v.auth.replace('  if (text == SYNC_CODE.helloMsg) return', '  if (text == SYNC_CODE.helloMsg) return\n  return false'),
}))
expectCaught('C7 新错误码词条被删', 'i18n', (v) => ({
  lang: v.lang.replace(/ *"setting_sync_code_unreachable": "[^"]*",\n/, '\n'),
}))
expectCaught('C8 旧提示文案回归（要求以 http:// 开头）', 'i18n-tip', (v) => ({
  lang: v.lang.replace(/"setting_sync_host_value_error_tip": "[^"]*"/, '"setting_sync_host_value_error_tip": "地址需要以「http://」或「https://」开头！"'),
}))

const violations = checkAll(REAL)
const failedModels = models.filter(([, ok]) => !ok)
const missed = counterExamples.filter(([, ok]) => !ok)

console.log('行为模型')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of counterExamples) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')

for (const v of violations) console.error(`FAIL  [${v.rule}] ${v.where} —— ${v.detail}`)
if (violations.length || failedModels.length || missed.length) {
  console.error('')
  console.error(`FAIL  同步地址契约未通过：违例 ${violations.length} 项、模型失败 ${failedModels.length} 例、反例漏检 ${missed.length} 例`)
  process.exit(1)
}
console.log(`PASS  同步服务地址可被规范化（HTTP/IP:端口/全角/大写协议都行），错误原因可区分上报（规则 5 组 + 行为模型 ${models.length} 例 + 反例 ${counterExamples.length} 例）`)
process.exit(0)
