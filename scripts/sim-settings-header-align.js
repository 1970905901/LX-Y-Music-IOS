/**
 * 「设置」Tab 页大标题与「推荐」页大标题的对齐回归。
 *
 * 由两次历史改动导致的错位（本脚本防的就是它复发）：
 *   1. 纵向：PageHeader 曾用 statusBarHeight + sm(=12)，而推荐页用
 *      max(sm, statusBarHeight - md) → 恒差 26~28pt，设置页标题明显低一截；
 *   2. 横向：设置页把水平内边距加在 ScrollView 的 contentContainerStyle 上（xl=32），
 *      而 PageHeader 自身**也**带 lg(24)，两层叠加 → 「设置」比「推荐」多缩进 32pt，
 *      左右切 Tab 时标题会横向跳一下。
 *
 * 本脚本从源码里解析实际取值（不硬编码），复算两个页面大标题的左/上内边距并比对。
 *
 * 运行：node scripts/sim-settings-header-align.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const results = []
let failed = 0
const check = (label, ok, detail) => {
  results.push({ label, ok: !!ok, detail })
  if (!ok) failed++
}

// --- designSpacing tokens ---
// 只取 designSpacing 那一个对象块：designRadius 里也有 sm/md/lg/xl 同名键，
// 整份文件一起扫会把 md 覆盖成 designRadius 的 18（designSpacing 里是 16）。
const tokensSrc = read('src/theme/DesignTokens.ts')
const spacingBlock = /designSpacing = \{([^}]*)\}/.exec(tokensSrc)
if (!spacingBlock) throw new Error('DesignTokens.ts 里找不到 designSpacing 块')
const tokens = {}
for (const m of spacingBlock[1].matchAll(/(\w+):\s*(\d+)/g)) tokens[m[1]] = Number(m[2])

/** 取某个 createStyle 样式块里的 paddingHorizontal 对应的 token 值 */
const stylePad = (src, styleName) => {
  const block = new RegExp(`${styleName}:\\s*\\{([^}]*)\\}`).exec(src)
  if (!block) return null
  const m = /paddingHorizontal:\s*designSpacing\.(\w+)/.exec(block[1])
  return m ? { token: m[1], value: tokens[m[1]] } : null
}
const styleFontWeight = (src, styleName) => {
  const block = new RegExp(`${styleName}:\\s*\\{([^}]*)\\}`).exec(src)
  const m = block && /fontWeight:\s*'(\d+)'/.exec(block[1])
  return m ? m[1] : null
}

// --- 推荐页（Discovery）大标题 ---
const discoverySrc = read('src/screens/Home/Views/Discovery/index.tsx')
const discoveryHeaderPad = stylePad(discoverySrc, 'header')
const discoveryTitleWeight = styleFontWeight(discoverySrc, 'title')
const discoveryHasTitle34 = /size=\{34\}/.test(discoverySrc)
const discoveryPadTopFormula = /paddingTop:\s*Math\.max\(designSpacing\.(\w+),\s*statusBarHeight\s*-\s*designSpacing\.(\w+)\)/
  .exec(discoverySrc)

// --- 设置 Tab 页 ---
const pageHeaderSrc = read('src/components/common/PageHeader.tsx')
const pageHeaderPad = stylePad(pageHeaderSrc, 'container')
const pageHeaderTitleWeight = styleFontWeight(pageHeaderSrc, 'title')
const pageHeaderPadTopFormula = /paddingTop[\s\S]{0,200}?Math\.max\(designSpacing\.(\w+),\s*statusBarHeight\s*-\s*designSpacing\.(\w+)\)/
  .exec(pageHeaderSrc)

const settingSrc = read('src/screens/Home/Views/Setting/Vertical/Main.tsx')
const contentContainerBlock = /contentContainer = useMemo\(\(\) => \(\{([\s\S]*?)\}\), \[/.exec(settingSrc)
const listStyleBlock = /const listStyle = useMemo\(\(\) => \(\{([\s\S]*?)\}\), \[\]\)/.exec(settingSrc)
const listPad = listStyleBlock && /paddingHorizontal:\s*designSpacing\.(\w+)/.exec(listStyleBlock[1])
const listPadValue = listPad ? tokens[listPad[1]] : null

// 设置页标题的左内边距 = 外层包裹层的水平内边距 + PageHeader 自带的水平内边距
const wrapperPadRaw = contentContainerBlock
  ? /paddingHorizontal:\s*designSpacing\.(\w+)/.exec(contentContainerBlock[1])
  : null
const wrapperPad = wrapperPadRaw ? tokens[wrapperPadRaw[1]] : 0

const settingsTitleLeft = wrapperPad + (pageHeaderPad ? pageHeaderPad.value : NaN)
const discoveryTitleLeft = discoveryHeaderPad ? discoveryHeaderPad.value : NaN

console.log('='.repeat(92))
console.log('「设置」与「推荐」大标题对齐模型（摘自源码，单位 pt）')
console.log('='.repeat(92))
console.log(`  DesignTokens: ${Object.entries(tokens).map(([k, v]) => `${k}=${v}`).join(' ')}`)
console.log()
console.log(`  推荐页 Discovery.header.paddingHorizontal        = ${discoveryTitleLeft}  (designSpacing.${discoveryHeaderPad && discoveryHeaderPad.token})`)
console.log(`  设置页 PageHeader.container.paddingHorizontal    = ${pageHeaderPad && pageHeaderPad.value}  (designSpacing.${pageHeaderPad && pageHeaderPad.token})`)
console.log(`  设置页 ScrollView contentContainer 外层水平内边距 = ${wrapperPad}${wrapperPadRaw ? `  (designSpacing.${wrapperPadRaw[1]})  ← ⚠️ 不该存在` : '  (无)'}`)
console.log(`  ─ 设置页大标题左内边距 = ${wrapperPad} + ${pageHeaderPad && pageHeaderPad.value} = ${settingsTitleLeft}pt`)
console.log(`  ─ 两页大标题左内边距差 = ${settingsTitleLeft - discoveryTitleLeft}pt`)
console.log()
console.log(`  设置页分类列表左内边距 = ${listPadValue}  (designSpacing.${listPad && listPad[1]}, 与设置详情页一致)`)
console.log()

console.log('='.repeat(92))
console.log('断言')
console.log('='.repeat(92))

check('推荐页 header 的水平内边距解析成功', !!discoveryHeaderPad, `${discoveryTitleLeft}`)
check('PageHeader 容器的水平内边距解析成功', !!pageHeaderPad, `${pageHeaderPad && pageHeaderPad.value}`)

// 核心：两页大标题左内边距必须相等
check(`两页大标题左内边距一致（均 ${discoveryTitleLeft}pt）`,
  settingsTitleLeft === discoveryTitleLeft,
  `设置=${settingsTitleLeft} 推荐=${discoveryTitleLeft}`)
check(`大标题左内边距等于 designSpacing.lg(${tokens.lg})`,
  discoveryTitleLeft === tokens.lg && (pageHeaderPad && pageHeaderPad.value) === tokens.lg,
  `lg=${tokens.lg}`)

// 横向错位的直接根因：外层不允许再叠一层水平内边距
check('设置页 ScrollView 的 contentContainerStyle 不含 paddingHorizontal（防标题被二次缩进）',
  !wrapperPadRaw, wrapperPadRaw ? `发现 designSpacing.${wrapperPadRaw[1]}` : '无')

// 反例回归：把 xl 放回外层必须被判不合格
check(`反例：外层若为 xl(${tokens.xl})，标题左内边距会变成 ${tokens.xl + tokens.lg}pt ≠ 推荐页 ${discoveryTitleLeft}pt，会被判不合格`,
  tokens.xl + tokens.lg !== discoveryTitleLeft, `${tokens.xl + tokens.lg} vs ${discoveryTitleLeft}`)

// 纵向：两个页面必须用同一个 paddingTop 公式
check('两页大标题 paddingTop 公式一致（max(sm, statusBarHeight - md)）',
  !!discoveryPadTopFormula && !!pageHeaderPadTopFormula &&
  discoveryPadTopFormula[1] === pageHeaderPadTopFormula[1] &&
  discoveryPadTopFormula[2] === pageHeaderPadTopFormula[2],
  discoveryPadTopFormula && pageHeaderPadTopFormula
    ? `推荐=max(${discoveryPadTopFormula[1]}, h-${discoveryPadTopFormula[2]}) 设置=max(${pageHeaderPadTopFormula[1]}, h-${pageHeaderPadTopFormula[2]})`
    : '公式未匹配')

// 字号/字重一致，否则左右对齐也会显得不一样宽
check('两页大标题字号一致（size 34）', discoveryHasTitle34 && /size=\{34\}/.test(pageHeaderSrc), '34')
check('两页大标题字重一致（800）',
  discoveryTitleWeight === '800' && pageHeaderTitleWeight === '800',
  `推荐=${discoveryTitleWeight} 设置=${pageHeaderTitleWeight}`)

// 列表内边距仍按详情页的 xl 走（本页刻意与详情页一致，不是回归）
check(`分类列表左内边距 = designSpacing.xl(${tokens.xl})，与本页大标题的 lg 不同是刻意的`,
  listPadValue === tokens.xl, `list=${listPadValue}`)

console.log()
const _pad = Math.max(...results.map((r) => r.label.length))
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'}  ${r.label}${r.detail ? '   [' + r.detail + ']' : ''}`)
}
console.log()
console.log(`结果：${results.length - failed}/${results.length} 通过${failed ? `（${failed} 项失败）` : ''}`)
process.exit(failed ? 1 : 0)
