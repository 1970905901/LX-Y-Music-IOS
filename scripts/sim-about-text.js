/**
 * sim-about-text.js
 *
 * 「关于」设置页（设置 → 关于）防骗 / 纯净文案删除契约。
 *
 * 背景（用户要求，2026-10-16）：真机截图指出「关于」页里以下四段文字不要再出现——
 *   R1 由于软件开发的初衷仅是为了对新技术的学习与研究，……一直保持纯净。
 *   R2 本项目没有微信公众号之类的所谓「官方账号」，也未在小米、华为、vivo
 *      等应用商店发布同名应用，谨防被骗！
 *   R3 若你使用过程中遇到广告或者引流（……）的信息，则表明你当前运行的软件是
 *      「第三方修改版」。
 *   R4 若在升级新版本时提示「签名不一致」，……有一方是「第三方修改版」。
 * 删除范围仅限「关于」页（src/screens/Home/Views/Setting/settings/About.tsx）。
 * 另注：src/utils/tools.ts 里同主题的 cheatTip 启动弹窗在本仓早已短路停用
 * （const isRead = true; if (isRead) return），用户本次要求不涉及它，故本契约不守护它。
 *
 * 契约守护三件事（防两类回归）：
 *   A) 四条文案（拼平后）不得再出现在「关于」页 —— 防文案复活；
 *   B) 保留段落必须仍在（版本号 / 开源地址 / 原始发布地址 / 致谢 / QQ 群 / 赞赏）——
 *      防「一刀切」把整页一起删空；
 *   C) 四个外链与赞赏图资源引用必须仍在 —— 删段落时不得连带删掉隔壁块的引用。
 *
 * 为什么要把 JSX「拼平」再比对：这些句子在源码里被 <Text> 标签和换行切开
 * （例：「学习与\n研究」；「广告」两个字单独包在 <Text style={styles.boldText}> 里，
 * 与前后文字不在同一段字符串中），直接对源码做子串匹配会漏检。拼平
 * （剥注释 → 剥 JSX 标签 → 去大括号 → 去全部空白）之后，比对的就是用户实际
 * 看到的文字，且对「同一句话换个换行位置」这类无害改动不敏感（反例 C8 守护）。
 *
 * 运行：node scripts/sim-about-text.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const ABOUT = 'src/screens/Home/Views/Setting/settings/About.tsx'

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

// 剥注释（保留字符串字面量）：注释里出现这些句子不算用户可见文案，不应误报。
// 与 sim-removed-platforms.js 同一实现口径。
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

// 拼平成用户可见文字：剥注释 → 剥 JSX 标签 → 去大括号 → 去全部空白（含全角空格 / NBSP）
const flatten = (src) => stripComments(src)
  .replace(/<[^>]*>/g, '')
  .replace(/[{}]/g, '')
  .replace(/[\s\u3000\u00a0]+/g, '')

// 用户要求删除的四条文案（拼平后的目标文字）
const REMOVED_TEXT = [
  ['R1 保持纯净', '由于软件开发的初衷仅是为了对新技术的学习与研究，因此软件直至停止维护都将会一直保持纯净。'],
  ['R2 谨防被骗', '本项目没有微信公众号之类的所谓「官方账号」，也未在小米、华为、vivo等应用商店发布同名应用，谨防被骗！'],
  ['R3 广告引流', '若你使用过程中遇到广告或者引流（如需要加群、关注公众号之类才能使用或者升级）的信息，则表明你当前运行的软件是「第三方修改版」。'],
  ['R4 签名不一致', '若在升级新版本时提示「签名不一致」，则表明你手机上的旧版本或者将要安装的新版本中有一方是「第三方修改版」。'],
]

// 必须保留的文案（用户只要求删上面四条；这些删掉就是过度删除）
const KEPT_TEXT = [
  ['版本号', '当前版本：'],
  ['开源声明', '本软件(LX-YMusic)完全免费，代码已开源。开源地址：'],
  ['原始发布地址', '目前本项目的原始发布地址只有GitHub和QQ群1013518794，其他渠道均为第三方转载发布，可信度请自行鉴别。'],
  ['致谢标题', '致谢'],
  ['致谢说明', '本软件基于以下上游项目构建，在此致以诚挚的感谢：'],
  ['QQ交流群', 'QQ交流群：1013518794'],
  ['赞赏标题', '赞赏支持'],
  ['赞赏说明', '若你觉得本软件不错，欢迎赞赏支持开发者：'],
]

// 必须保留的引用（源码原文匹配，不做拼平）
const KEPT_RESOURCES = [
  ['本项目仓库链接', 'https://github.com/1970905901/LX-Y-Music-IOS#readme'],
  ['上游 iOS 分支链接', 'https://github.com/Q-1515/lx-music-mobile/tree/ios-adaptation'],
  ['上游 debug 分支链接', 'https://github.com/WalnutBai/lx-lxwalnut-music-mobile/tree/main-debug'],
  ['赞赏二维码资源', 'reward-qrcode.jpg'],
]

const checkAll = ({ about }) => {
  const violations = []
  const flat = flatten(about)

  for (const [label, text] of REMOVED_TEXT) {
    if (flat.includes(text)) {
      violations.push({ rule: 'removed-text', where: ABOUT, detail: label + ' 文案又出现在「关于」页（用户已要求删除）' })
    }
  }
  for (const [label, text] of KEPT_TEXT) {
    if (!flat.includes(text)) {
      violations.push({ rule: 'kept-text', where: ABOUT, detail: '保留文案「' + label + '」缺失（删除范围超出用户要求）' })
    }
  }
  for (const [label, text] of KEPT_RESOURCES) {
    if (!about.includes(text)) {
      violations.push({ rule: 'kept-resource', where: ABOUT, detail: '引用「' + label + '」缺失：' + text })
    }
  }
  return violations
}

const REAL = read(ABOUT)
const realFlat = flatten(REAL)

// 复现「加回一段文案」的变异：插在「致谢」块之前（字符串本身可任意换行，
// 拼平后都应该等价，见反例 C8）
const ANCHOR = '      <View style={styles.part}>\n        <Text style={styles.boldText}>致谢</Text>'
const reinsert = (src, text) => {
  if (!src.includes(ANCHOR)) throw new Error('变异锚点「致谢」块不存在，契约需同步更新')
  return src.replace(ANCHOR, '      <View style={styles.part}>\n        <Text>' + text + '</Text>\n      </View>\n' + ANCHOR)
}

const models = [
  ['四条防骗 / 纯净文案已从「关于」页删除（拼平后逐句复查）',
    REMOVED_TEXT.every(([, text]) => !realFlat.includes(text))],
  ['「关于」页保留段落齐全（版本 / 开源 / 原始发布地址 / 致谢 / QQ 群 / 赞赏）',
    KEPT_TEXT.every(([, text]) => realFlat.includes(text))],
  ['外链与赞赏二维码资源引用完好（删段落没有连带删隔壁块）',
    KEPT_RESOURCES.every(([, text]) => REAL.includes(text))],
]

const counterExamples = []
const expectCaught = (name, expectRule, mutate) => {
  let rules
  try {
    rules = checkAll({ about: mutate(REAL) }).map((v) => v.rule)
  } catch (err) {
    counterExamples.push([name, false, '变异执行失败：' + err.message])
    return
  }
  const hit = rules.includes(expectRule)
  counterExamples.push([name, hit, hit ? '已拦下（' + expectRule + '）' : '未拦下（rules=' + JSON.stringify(rules) + '）'])
}

const negativeControls = []
const expectNotCaught = (name, mutate) => {
  let rules
  try {
    rules = checkAll({ about: mutate(REAL) }).map((v) => v.rule)
  } catch (err) {
    negativeControls.push([name, false, '变异执行失败：' + err.message])
    return
  }
  const ok = rules.length === 0
  negativeControls.push([name, ok, ok ? '未误报' : '误报（rules=' + JSON.stringify(rules) + '）'])
}

expectCaught('C1 把 R1「保持纯净」加回「关于」页', 'removed-text', (src) => reinsert(src, REMOVED_TEXT[0][1]))
expectCaught('C2 把 R2「谨防被骗」加回「关于」页', 'removed-text', (src) => reinsert(src, REMOVED_TEXT[1][1]))
expectCaught('C3 把 R3「广告 / 引流」加回「关于」页', 'removed-text', (src) => reinsert(src, REMOVED_TEXT[2][1]))
expectCaught('C4 把 R4「签名不一致」加回「关于」页', 'removed-text', (src) => reinsert(src, REMOVED_TEXT[3][1]))
expectCaught('C5 误删保留段落「原始发布地址」', 'kept-text', (src) => src.replace('原始发布地址', '发布地址'))
expectCaught('C6 误删赞赏二维码资源', 'kept-resource', (src) => src.replace('reward-qrcode.jpg', 'reward-qrcode.png'))
expectCaught('C7 只删了「致谢」上游链接、留下空标题', 'kept-resource', (src) => src.replace('https://github.com/Q-1515/lx-music-mobile/tree/ios-adaptation', 'https://example.com'))
expectCaught('C8 文案换个换行位置加回（拼平后仍应命中）', 'removed-text',
  (src) => reinsert(src, '本项目没有微信公众号之类的所谓「官方账号」，\n          也未在小米、华为、vivo 等应用商店发布同名应用，谨防被骗！'))

// 反向对照：句子只出现在注释里（用户不可见）不应误报
expectNotCaught('N1 JSX 注释里出现被删文案不误报',
  (src) => src.replace(ANCHOR, '      {/* ' + REMOVED_TEXT[1][1] + ' */}\n' + ANCHOR))
expectNotCaught('N2 行注释里出现被删文案不误报',
  (src) => '// ' + REMOVED_TEXT[0][1] + '\n' + src)

const violations = checkAll({ about: REAL })
const failedModels = models.filter(([, ok]) => !ok)
const missed = counterExamples.filter(([, ok]) => !ok)
const falsePositives = negativeControls.filter(([, ok]) => !ok)

console.log('行为模型')
for (const [name, ok] of models) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of counterExamples) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + ' —— ' + detail)
console.log('')
console.log('反向对照（不得误报）')
for (const [name, ok, detail] of negativeControls) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + ' —— ' + detail)
console.log('')

for (const v of violations) console.error('FAIL  [' + v.rule + '] ' + v.where + ' —— ' + v.detail)
if (violations.length || failedModels.length || missed.length || falsePositives.length) {
  console.error('')
  console.error('FAIL  「关于」页文案删除契约未通过：违例 ' + violations.length + ' 项、模型失败 ' + failedModels.length + ' 例、反例漏检 ' + missed.length + ' 例、误报 ' + falsePositives.length + ' 例')
  process.exit(1)
}
console.log('PASS  「关于」页四条防骗 / 纯净文案已删除，保留段落与资源引用完好（规则 ' + (REMOVED_TEXT.length + KEPT_TEXT.length + KEPT_RESOURCES.length) + ' 条 + 行为模型 ' + models.length + ' 例 + 反例 ' + counterExamples.length + ' 例 + 反向对照 ' + negativeControls.length + ' 例）')
process.exit(0)
