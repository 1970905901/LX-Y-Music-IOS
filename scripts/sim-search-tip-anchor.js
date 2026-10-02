/**
 * 搜索联想列表必须贴在**搜索框**正下方（而不是整个搜索页头下方、更不能盖住搜索框）。
 *
 * 用户两次反馈：
 *   ① 「联想内容与搜索框距离太远」——当时浮层 top 用的是「整个搜索页头」的高度（搜索框 +
 *      搜索平台标题行 + 平台胶囊行 + 类型选择行），列表要往下隔三行才出现；
 *   ② 「联想词挡住搜索框了」——改成搜索框行底边后出现的坐标空间错位（见下）。
 *
 * 坐标空间要害：搜索框在结果列表的 header 里，而 iOS 上 react-native-navigation 的全局
 * swizzle 把列表的 contentInsetAdjustmentBehavior 强制成 scrollableAxes —— 列表内容会被
 * 系统自动叠加一份安全区顶部插图（能否滚动还会让它出现/消失）。而联想浮层是**页面级**的
 * 绝对定位层（与结果列表同级）。
 *   - 用「结果列表 header 里的 layout.y」当浮层 top ⇒ 与屏幕真实位置差一个安全区：
 *     实测（iPhone 14 Pro Max，安全区 59pt）浮层比搜索框底边高 59pt ⇒ 联想词盖住搜索框；
 *   - 正确做法：用 measureInWindow 取「搜索框行底边」的**窗口坐标**，再减去浮层所在容器
 *     自身的窗口 y，换算成浮层坐标 —— 不管列表有没有插图、有没有滚动都对得上。
 *
 * 本脚本从源码抽取真实写法做断言，并带反例与距离模型（布局类回归 tsc/eslint 无感）。
 * 运行：node scripts/sim-search-tip-anchor.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  page: 'src/screens/Home/Views/Search/index.tsx',
  header: 'src/screens/Home/Views/Search/HeaderBar/index.tsx',
  tip: 'src/components/SearchTipList/index.tsx',
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const readAll = (over = {}) => {
  const out = {}
  for (const [k, p] of Object.entries(FILES)) out[k] = over[k] !== undefined ? over[k] : read(p)
  return out
}

const invariants = (files) => {
  const reasons = []

  // ① HeaderBar：上报口按窗口坐标命名，并用 measureInWindow 实测输入行底边
  if (!/onSearchBarLayout\?\s*:\s*\(\s*bottomInWindow\s*:\s*number\s*\)\s*=>\s*void/.test(files.header)) {
    reasons.push('HeaderBar 未声明窗口坐标版的 onSearchBarLayout（bottomInWindow）')
  }
  if (!/openHeaderRef\.current\?\.measureInWindow\(/.test(files.header)) {
    reasons.push('HeaderBar 未用 measureInWindow 实测输入行（组件内 layout 值差一个安全区）')
  }
  if (!/onSearchBarLayout\?\.\(\s*y\s*\+\s*height\s*\)/.test(files.header)) {
    reasons.push('HeaderBar 未上报「输入行底边」的窗口 y（y + height）')
  }
  if (/onSearchBarLayout\?\.\(\s*nativeEvent\.layout\.y/.test(files.header)) {
    reasons.push('HeaderBar 又用组件内 layout.y 上报（会与浮层差一个安全区 → 盖住搜索框）')
  }
  // 显示联想前能主动刷新实测值
  if (!/measureSearchBar\s*\(\)\s*\{/.test(files.header) || !/measureSearchBar\s*:\s*\(\)\s*=>\s*void/.test(files.header)) {
    reasons.push('HeaderBar 未暴露 measureSearchBar()（浮层显示前无法刷新贴边位置）')
  }

  // ② 搜索页：窗口坐标 → 本层坐标；浮层 top 用换算后的值
  if (!/const\s+handleSearchBarLayout\s*=\s*useCallback\(\s*\(\s*bottomInWindow\s*:\s*number\s*\)/.test(files.page)) {
    reasons.push('搜索页的 handleSearchBarLayout 未接收窗口坐标（bottomInWindow）')
  }
  if (!/measureInWindow\(/.test(files.page) ||
    !/bottomInWindow\s*-\s*pageTop/.test(files.page)) {
    reasons.push('搜索页未把「窗口坐标」换算成本层坐标（浮层会与搜索框错位）')
  }
  if (!/const\s+tipListTopStyle\s*=\s*useMemo\([\s\S]{0,160}?\{ top: searchBarBottom \}/.test(files.page)) {
    reasons.push('联想浮层 top 未使用换算后的 searchBarBottom')
  }
  if (/\bheaderHeight\b/.test(files.page)) {
    reasons.push('搜索页仍在用整个页头高度（headerHeight）作锚点')
  }
  if (!/layoutHeightRef\.current\s*=\s*Math\.max\(0,\s*containerHeightRef\.current\s*-\s*bottom\)/.test(files.page)) {
    reasons.push('layoutHeightRef 未按搜索框底边计算（展开/收起动画行程与浮层位置不匹配）')
  }
  // 浮层容器必须是普通 View（KeyboardAvoidingView 实例没有 measureInWindow）
  if (!/containerRef/.test(files.page) || !/collapsable=\{false\}/.test(files.page)) {
    reasons.push('浮层容器缺少可测量的普通 View（collapsable={false}）')
  }
  // 显示/联想前先刷新实测
  if (countCall(files.page, /headerBarRef\.current\?\.measureSearchBar\(\)/g) < 2) {
    reasons.push('搜索页未在「点输入框」与「输入内容」时刷新 measureSearchBar()（贴边位置可能过期）')
  }

  // ③ 浮层本体保持贴顶绝对定位（top 由上面那层给）
  if (!/position:\s*'absolute'/.test(files.tip) || !/height:\s*'100%'/.test(files.tip)) {
    reasons.push('SearchTipList 不再是贴顶绝对定位层（top 传入后位置不受控）')
  }

  return reasons
}

const countCall = (src, re) => (src.match(re) || []).length

// ---------------------------------------------------------------------------
// 距离模型（iPhone 14 Pro Max：安全区 59pt，状态栏 54 → paddingTop 44，输入行高 60）
// ---------------------------------------------------------------------------
const model = () => {
  const results = []
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail })

  const safeAreaTop = 59
  const paddingTop = Math.max(12, 54 + 6 - 16) // = 44
  const rowHeight = 60
  const platformLabelRow = 30
  const platformChipsRow = 44
  const typeRow = 42

  // 搜索框行在屏幕上的底边（列表被系统叠加安全区插图后整体下移）
  const boxBottomInWindow = safeAreaTop + paddingTop + rowHeight // = 163
  // ① 旧实现（整个页头高度，坐标空间同样是 header 内部）→ 屏幕上更靠下 → 「太远」
  const oldHeaderHeight = paddingTop + rowHeight + platformLabelRow + platformChipsRow + typeRow // = 220
  const oldAnchorInWindow = safeAreaTop + oldHeaderHeight // = 279
  // ② 上一版（搜索框底边，但仍用 header 内部坐标）→ 比搜索框底边高一个安全区 → 盖住搜索框
  const brokenAnchorInWindow = paddingTop + rowHeight // = 104
  // ③ 本版（窗口坐标换算）→ 正好贴住搜索框下沿
  const fixedAnchorInWindow = boxBottomInWindow

  check('搜索框行底边在屏幕上的位置（安全区 59 + 上内边距 44 + 行高 60）', boxBottomInWindow === 163, `${boxBottomInWindow}pt`)
  check('旧实现（整个页头）比搜索框底边低 ≈116pt → 「联想内容离搜索框太远」', oldAnchorInWindow - boxBottomInWindow >= 100, `低 ${oldAnchorInWindow - boxBottomInWindow}pt`)
  check('上一版（header 内坐标）比搜索框底边高一个安全区 → 「联想词盖住搜索框」', boxBottomInWindow - brokenAnchorInWindow === safeAreaTop, `高 ${boxBottomInWindow - brokenAnchorInWindow}pt`)
  check('本版锚点 = 搜索框行底边（正好贴住下沿，不盖住也不远离）', fixedAnchorInWindow === boxBottomInWindow, `${fixedAnchorInWindow}pt`)
  return results
}

// ---------------------------------------------------------------------------
// 反例自检
// ---------------------------------------------------------------------------
const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.replace(find, replace)
}
const runCounterExamples = () => {
  const results = []
  const check = (name, files, expectSubstr) => {
    let reasons = []
    try {
      reasons = invariants(files)
    } catch (e) {
      results.push({ name, ok: false, detail: `抛异常: ${e.message}` })
      return
    }
    const hit = reasons.some(r => r.includes(expectSubstr))
    results.push({ name, ok: hit, detail: hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）` })
  }

  check('S1 HeaderBar 去掉上报口声明', readAll({
    header: tamper(read(FILES.header), 'onSearchBarLayout?: (bottomInWindow: number) => void', 'removedLayout?: (bottomInWindow: number) => void'),
  }), '未声明窗口坐标版')

  check('S2 HeaderBar 退回组件内 layout 坐标', readAll({
    header: tamper(read(FILES.header),
      'openHeaderRef.current?.measureInWindow((_x, y, _width, height) => {',
      'noMeasure((_x, y, _width, height) => {'),
  }), '未用 measureInWindow')

  check('S3 浮层 top 换回整个页头高度', readAll({
    page: tamper(read(FILES.page), '{ top: searchBarBottom }', '{ top: headerHeight }'),
  }), '未使用换算后的 searchBarBottom')

  check('S4 搜页不做窗口坐标 → 本层坐标换算', readAll({
    page: tamper(read(FILES.page), 'bottomInWindow - pageTop', 'bottomInWindow'),
  }), '未把「窗口坐标」换算成本层坐标')

  check('S5 浮层显示前不刷新实测', readAll({
    page: read(FILES.page).replace(/headerBarRef\.current\?\.measureSearchBar\(\)/g, ''),
  }), '未在「点输入框」与「输入内容」时刷新')

  return results
}

const realReasons = invariants(readAll())
const mm = model()
const ce = runCounterExamples()

console.log('=== sim-search-tip-anchor ===\n')
console.log('[源码不变量]')
if (realReasons.length === 0) console.log('  PASS 联想浮层按「搜索框底边窗口坐标」贴边（HeaderBar 实测 → 搜索页换算成本层坐标）')
else realReasons.forEach(r => console.log('  FAIL ' + r))

console.log('\n[距离模型（iPhone 14 Pro Max）]')
mm.forEach(r => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}   [${r.detail}]`))

console.log('\n[反例自检]')
ce.forEach(r => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name} —— ${r.detail}`))

const failed = realReasons.length + mm.filter(r => !r.ok).length + ce.filter(r => !r.ok).length
console.log(`\n结果：${failed ? `有 ${failed} 项失败` : 'ALL PASS'}（不变量 ${realReasons.length === 0 ? '1/1' : '有失败'}；模型 ${mm.filter(r => r.ok).length}/${mm.length}；反例 ${ce.filter(r => r.ok).length}/${ce.length}）`)
process.exit(failed ? 1 : 0)
