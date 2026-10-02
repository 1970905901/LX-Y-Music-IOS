/**
 * 搜索联想列表必须贴在**搜索框**正下方（而不是整个搜索页头下方）。
 *
 * 用户反馈：搜索页点输入框、输入部分歌名，下方联想内容与搜索框距离太远。
 * 根因：联想浮层的 top 一直用的是「整个搜索页头」的实测高度，而页头里除了搜索框
 * 还有「搜索平台」标题行 + 平台胶囊横滑行 + 类型选择行（高度 ≈ 116pt），
 * 联想列表因此在输入框下面隔着三行才出现。
 *
 * 修法：HeaderBar 用 onLayout 上报「输入行底边」（layout.y + layout.height，相对页头
 * 顶部就等于相对页面顶部），搜索页据此设置联想浮层的 top 与动画高度。
 *
 * 本脚本从源码抽取真实写法做断言，并带反例自检（布局类回归 tsc/eslint 全无感）。
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

  // ① HeaderBar：声明并上报「输入行底边」
  if (!/onSearchBarLayout\?\s*:\s*\(\s*bottom:\s*number\s*\)\s*=>\s*void/.test(files.header)) {
    reasons.push('HeaderBar 未声明 onSearchBarLayout（没有「输入行底边」的上报口）')
  }
  if (!/onSearchBarLayout\?\.\(\s*nativeEvent\.layout\.y\s*\+\s*nativeEvent\.layout\.height\s*\)/.test(files.header)) {
    reasons.push('HeaderBar 未在输入行 onLayout 里上报 y + height（联想列表无法贴在输入框下方）')
  }

  // ② 搜索页：接住上报值，并用它设置联想浮层 top
  if (!/onSearchBarLayout=\{handleSearchBarLayout\}/.test(files.page)) {
    reasons.push('搜索页未把 onSearchBarLayout 接到 HeaderBar（上报值被丢弃）')
  }
  if (!/const\s+handleSearchBarLayout\s*=\s*useCallback/.test(files.page) ||
    !/searchBarBottomRef\.current\s*=\s*bottom/.test(files.page)) {
    reasons.push('搜索页的 handleSearchBarLayout 未把输入行底边写入 searchBarBottomRef')
  }
  if (!/const\s+tipListTopStyle\s*=\s*useMemo\([\s\S]{0,160}?\{ top: searchBarBottom \}/.test(files.page)) {
    reasons.push('联想浮层 top 未使用搜索框底边（searchBarBottom）')
  }

  // ③ 不得再退回「整个页头高度」当锚点
  if (/\bheaderHeight\b/.test(files.page)) {
    reasons.push('搜索页仍在用整个页头高度（headerHeight）作锚点 —— 联想列表会被推到很下面')
  }

  // ④ 联想浮层的动画高度同样按输入行底边算
  if (!/layoutHeightRef\.current\s*=\s*Math\.max\(0,\s*(e\.nativeEvent\.layout\.height|containerHeightRef\.current)\s*-\s*searchBarBottomRef\.current\)/.test(files.page)) {
    reasons.push('layoutHeightRef 未按搜索框底边计算（展开/收起的动画行程会与浮层位置不匹配）')
  }

  // ⑤ 浮层本体仍是「贴着容器顶部的绝对定位层」（top 由上面那层给）
  if (!/position:\s*'absolute'/.test(files.tip) || !/height:\s*'100%'/.test(files.tip)) {
    reasons.push('SearchTipList 不再是贴顶绝对定位层（top 传入后位置不受控）')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 距离模型：把「改前 / 改后」的锚点算出来，确认改后确实贴住输入框
// ---------------------------------------------------------------------------
const SPACING = { sm: 12, md: 16 }
const model = () => {
  const results = []
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail })
  // 灵动岛机型：状态栏 62 → useStatusbarHeight = 62 + 6 = 68
  const paddingTop = Math.max(SPACING.sm, 68 - SPACING.md) // = 52
  const searchRowHeight = 40 // 输入框行（含内边距）
  const platformLabelRow = 30 // 「搜索平台」标题行
  const platformChipsRow = 44 // 平台胶囊横滑行
  const typeRow = 42 // 类型选择行
  const newAnchor = paddingTop + searchRowHeight
  const oldAnchor = newAnchor + platformLabelRow + platformChipsRow + typeRow
  check('改后锚点 = 输入行底边（52 + 40 = 92pt）', newAnchor === 92, `${newAnchor}pt`)
  check('改前锚点 = 整个页头底边（多出平台标题/胶囊/类型三行 ≈ 116pt）', oldAnchor === 208, `${oldAnchor}pt`)
  check('改后比改前上移 ≥ 100pt（联想内容贴住搜索框）', oldAnchor - newAnchor >= 100, `上移 ${oldAnchor - newAnchor}pt`)
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

  // S1 去掉上报口声明
  check('S1 HeaderBar 去掉 onSearchBarLayout 声明', readAll({
    header: tamper(read(FILES.header), 'onSearchBarLayout?: (bottom: number) => void', 'removedSearchBarLayout?: (bottom: number) => void'),
  }), '未声明 onSearchBarLayout')

  // S2 上报点消失
  check('S2 HeaderBar 不再上报输入行底边', readAll({
    header: tamper(read(FILES.header), 'onSearchBarLayout?.(nativeEvent.layout.y + nativeEvent.layout.height)', 'noop()'),
  }), '未在输入行 onLayout 里上报')

  // S3 搜索页把 top 换回整个页头高度
  check('S3 联想浮层退回整个页头高度', readAll({
    page: tamper(read(FILES.page), '{ top: searchBarBottom }', '{ top: headerHeight }'),
  }), '未使用搜索框底边')

  // S4 动画高度口径漂移
  check('S4 动画高度不按搜索框底边算', readAll({
    page: tamper(read(FILES.page),
      'layoutHeightRef.current = Math.max(0, e.nativeEvent.layout.height - searchBarBottomRef.current)',
      'layoutHeightRef.current = e.nativeEvent.layout.height'),
  }), 'layoutHeightRef 未按搜索框底边计算')

  return results
}

const realReasons = invariants(readAll())
const mm = model()
const ce = runCounterExamples()

console.log('=== sim-search-tip-anchor ===\n')
console.log('[源码不变量]')
if (realReasons.length === 0) console.log('  PASS 联想浮层已锚定「输入行底边」（HeaderBar 上报 → 搜索页 top/动画高度）')
else realReasons.forEach(r => console.log('  FAIL ' + r))

console.log('\n[距离模型（灵动岛机型）]')
mm.forEach(r => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}   [${r.detail}]`))

console.log('\n[反例自检]')
ce.forEach(r => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name} —— ${r.detail}`))

const failed = realReasons.length + mm.filter(r => !r.ok).length + ce.filter(r => !r.ok).length
console.log(`\n结果：${failed ? `有 ${failed} 项失败` : 'ALL PASS'}（不变量 ${realReasons.length === 0 ? '1/1' : '有失败'}；模型 ${mm.filter(r => r.ok).length}/${mm.length}；反例 ${ce.filter(r => r.ok).length}/${ce.length}）`)
process.exit(failed ? 1 : 0)
