/**
 * 底部 Tab 栏图标一致性回归（线宽 + 体量两个维度）。
 *
 * 背景：「我的」Tab 的爱心不是字体字形，而是手绘 SVG 描边（IcoMoon 的 love 字形历史上
 * 在 iOS 上渲染异常，改用描边心形根治），所以它**不会自动跟随字体图标家族**，
 * 线宽与字号都必须手工对齐，否则肉眼会觉得它「和别的 Tab 不是一个图」。
 *
 * 两个维度都要管，只对齐一个都不行：
 *   - 线宽（粗细）：「扫描线最短弦长」测量各图标的笔画宽度——宽度为 t 的等宽笔画，
 *     被任意直线横截时最短弦长 = t；对轴线对齐的笔画（图标字体绝大多数如此）该值精确等于 t。
 *     取所有弦长的 5% 分位作为估计（比取最小值抗「切线处细缝」的数值噪声）。
 *   - 体量（视觉盒）：字体字形铺满 em 框（视觉高 = 字号），手绘爱心只占 1em 的 66%×63%，
 *     所以爱心必须在更大的字号上渲染才能齐平；线宽又与字号绑定（字号 ↑ 则线宽 ↓），
 *     于是「字号」与「线宽」必须联立求解，改一个就要回来重算另一个。
 *
 * 所有长度单位都是字形坐标（IcoMoon 字体 unitsPerEm = 1024，即 1024 单位 = 1em）；
 * 换算到屏幕：px = 单位 / 1024 * 渲染字号。
 *
 * 运行：node scripts/sim-tabbar-icon-stroke.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const EM = 1024 // IcoMoon 字体 unitsPerEm，已用 scripts 校验过 head.unitsPerEm

// 渲染字号（Tab 栏与字形的 1:1 对应）；由下方源码断言保证与实现同步
const SIZE_TAB = 21
// 爱心字形只占 em 框的 66%×63%，体量天生比别人小，靠放大字号补齐（见 SvgIcon 注释）
const SIZE_HEART = 30

const results = []
let failed = 0
const check = (label, ok, detail) => {
  results.push({ label, ok: !!ok, detail })
  if (!ok) failed++
}

// ---------------------------------------------------------------------------
// 1. SVG 路径解析 + 扁平化
// ---------------------------------------------------------------------------
const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g
const FLAT = 48 // 三次贝塞尔扁平化段数（弦长误差 << 1 单位）

function parsePath(d) {
  const toks = d.match(TOKEN) || []
  let i = 0
  let cur = [0, 0]
  let start = [0, 0]
  let lastC = null // 上一段三次贝塞尔的第二控制点（供 S/s 平滑）
  let lastOp = 'L'
  let lastRel = false
  const subpaths = []
  let poly = []

  const num = () => Number(toks[i++])
  const push = (p) => poly.push(p)
  const flush = () => { if (poly.length > 1) subpaths.push(poly); poly = [] }
  const cubic = (p0, c1, c2, p1) => {
    for (let k = 1; k <= FLAT; k++) {
      const t = k / FLAT
      const mt = 1 - t
      push([
        mt * mt * mt * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * p1[0],
        mt * mt * mt * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * p1[1],
      ])
    }
  }

  while (i < toks.length) {
    const tok = toks[i]
    let op = lastOp
    let rel = lastRel
    if (/[A-Za-z]/.test(tok)) {
      i++
      op = tok.toUpperCase()
      rel = tok !== tok.toUpperCase()
      lastOp = op
      lastRel = rel
    }
    // 隐式重复上一指令时 op/rel 沿用上次的值

    if (op === 'M') {
      let x = num(); let y = num()
      if (rel) { x += cur[0]; y += cur[1] }
      flush(); push([x, y]); cur = [x, y]; start = [x, y]; lastC = null
      lastOp = 'L' // M 之后的隐式参数按 L 处理
    } else if (op === 'L') {
      let x = num(); let y = num()
      if (rel) { x += cur[0]; y += cur[1] }
      push([x, y]); cur = [x, y]; lastC = null
    } else if (op === 'H') {
      let x = num()
      if (rel) x += cur[0]
      push([x, cur[1]]); cur = [x, cur[1]]; lastC = null
    } else if (op === 'V') {
      let y = num()
      if (rel) y += cur[1]
      push([cur[0], y]); cur = [cur[0], y]; lastC = null
    } else if (op === 'C') {
      let x1 = num(); let y1 = num(); let x2 = num(); let y2 = num(); let x = num(); let y = num()
      if (rel) { x1 += cur[0]; y1 += cur[1]; x2 += cur[0]; y2 += cur[1]; x += cur[0]; y += cur[1] }
      cubic(cur, [x1, y1], [x2, y2], [x, y])
      cur = [x, y]; lastC = [x2, y2]
    } else if (op === 'S') {
      let x2 = num(); let y2 = num(); let x = num(); let y = num()
      if (rel) { x2 += cur[0]; y2 += cur[1]; x += cur[0]; y += cur[1] }
      const c1 = lastC ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : cur
      cubic(cur, c1, [x2, y2], [x, y])
      cur = [x, y]; lastC = [x2, y2]
    } else if (op === 'Z') {
      if (poly.length) push(start.slice())
      cur = start.slice(); flush(); lastC = null
    } else {
      throw new Error('未处理的路径指令: ' + op)
    }
  }
  flush()
  return subpaths
}

// ---------------------------------------------------------------------------
// 2. 扫描线求填充段（非零环绕规则）
// ---------------------------------------------------------------------------
function scanRuns(polys, y) {
  const xs = []
  for (const poly of polys) {
    for (let k = 0; k < poly.length; k++) {
      const [x0, y0] = poly[k]
      const [x1, y1] = poly[(k + 1) % poly.length]
      if (y0 === y1) continue
      if (Math.min(y0, y1) <= y && y < Math.max(y0, y1)) {
        xs.push([x0 + ((y - y0) * (x1 - x0)) / (y1 - y0), y1 > y0 ? 1 : -1])
      }
    }
  }
  if (!xs.length) return []
  xs.sort((a, b) => a[0] - b[0])
  const spans = []
  let wind = 0
  let sx = null
  for (const [x, dir] of xs) {
    const prev = wind
    wind += dir
    if (prev === 0 && wind !== 0) sx = x
    else if (prev !== 0 && wind === 0 && sx !== null) { spans.push([sx, x]); sx = null }
  }
  return spans
}

function bbox(polys) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
  for (const poly of polys) {
    for (const [x, y] of poly) {
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}

/** 笔画宽度估计：水平 + 竖直两个方向扫描，取弦长的 5% 分位。 */
function strokeWidth(polys, { minRun = 8, maxRun = 260 } = {}) {
  const bx = bbox(polys)
  const lengths = []
  const dirs = [
    { lo: bx.y0, hi: bx.y1, src: polys }, // 水平扫描线
    { lo: bx.x0, hi: bx.x1, src: polys.map((poly) => poly.map(([x, y]) => [y, x])) }, // 竖直
  ]
  for (const { lo, hi, src } of dirs) {
    for (let v = Math.floor(lo) + 0.5; v < hi; v += 1) {
      for (const [a, b] of scanRuns(src, v)) {
        const L = b - a
        if (L >= minRun && L <= maxRun) lengths.push(L)
      }
    }
  }
  if (!lengths.length) return { p05: NaN, min: NaN, count: 0 }
  lengths.sort((a, b) => a - b)
  return {
    p05: lengths[Math.floor(lengths.length * 0.05)],
    min: lengths[0],
    median: lengths[Math.floor(lengths.length * 0.5)],
    count: lengths.length,
  }
}

// ---------------------------------------------------------------------------
// 3. 读取实现
// ---------------------------------------------------------------------------
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const selection = JSON.parse(read('src/resources/fonts/selection.json'))
const glyphOf = (name) => {
  const ic = selection.icons.find((it) => it.properties.name === name)
  if (!ic) throw new Error('字体中找不到字形: ' + name)
  return ic.icon.paths.map(parsePath).reduce((a, b) => a.concat(b), [])
}

// 爱心：从 SvgIcon.tsx 源码里取路径与线宽，保证脚本与实现同步
const svgIconSrc = read('src/components/common/SvgIcon.tsx')
const heartPathMatch = /const HeartPath\s*=\s*\r?\n?\s*'([^']+)'/.exec(svgIconSrc)
const heartStrokeMatch = /const HEART_STROKE_WIDTH\s*=\s*(\d+)/.exec(svgIconSrc)
const heartPath = heartPathMatch ? parsePath(heartPathMatch[1]) : null
const heartStroke = heartStrokeMatch ? Number(heartStrokeMatch[1]) : NaN

// Tab 栏渲染尺寸（源码断言用）
const tabBarSrc = read('src/components/layout/ModernTabBar.tsx')
const loveSizeMatch = /size=\{tab\.icon === 'love' \? (\d+) : (\d+)\}/.exec(tabBarSrc)
const heartPathBBox = heartPath ? bbox(heartPath) : null

// ---------------------------------------------------------------------------
// 4. 测量
// ---------------------------------------------------------------------------
const TAB_ICONS = ['home', 'album', 'search-2', 'setting'] // 与 ModernTabBar 的 TAB_IDS 一致
const REF_ICONS = ['love', 'menu', 'leaderboard'] // 字体自带的参考字形

console.log('='.repeat(94))
console.log('底部 Tab 栏图标线宽测量（单位：字形坐标，1024 = 1em）')
console.log('='.repeat(94))
console.log(`${'图标'.padEnd(14)}${'来源'.padEnd(12)}${'线宽'.padStart(8)}${'屏幕pt(@字号)'.padStart(18)}   备注`)
console.log('-'.repeat(94))

const measured = {}
const fmt = (v, n = 1) => v.toFixed(n)
for (const name of TAB_ICONS) {
  const m = strokeWidth(glyphOf(name))
  measured[name] = m
  console.log(
    `${name.padEnd(14)}${'IcoMoon字形'.padEnd(12)}${fmt(m.p05).padStart(8)}` +
    `${(m.p05 / EM * SIZE_TAB).toFixed(2).padStart(18)}   字号 ${SIZE_TAB}pt`,
  )
}
for (const name of REF_ICONS) {
  const m = strokeWidth(glyphOf(name))
  console.log(
    `${name.padEnd(14)}${'IcoMoon字形'.padEnd(12)}${fmt(m.p05).padStart(8)}` +
    `${(m.p05 / EM * SIZE_TAB).toFixed(2).padStart(18)}   参考（同字体，非 Tab 图标）`,
  )
}
const heartPt = heartStroke / EM * SIZE_HEART
console.log(
  `${'love(爱心)'.padEnd(14)}${'手绘SVG描边'.padEnd(12)}${String(heartStroke).padStart(8)}` +
  `${heartPt.toFixed(2).padStart(18)}   字号 ${SIZE_HEART}pt ← 本次调整对象`,
)

// ---------------------------------------------------------------------------
// 3.5 视觉尺寸（体量）对照
// ---------------------------------------------------------------------------
// 「看着一样大」由两件事共同决定：线宽（粗细）+ 视觉盒（体量）。字体字形铺满 em 框
// （视觉高 = 字号），手绘爱心只占 1em 的 66%×63%，所以必须在更大字号上渲染。
// 视觉盒 = 字形包围盒 + 描边外扩（描边以路径为中心，故每侧外扩 stroke/2）。
const boxOf = (polys, stroke = 0) => {
  const b = bbox(polys)
  return { w: b.w + stroke, h: b.h + stroke }
}
const tabBoxes = TAB_ICONS.map((name) => ({ name, ...boxOf(glyphOf(name)) }))
const heartBox = boxOf(heartPath, heartStroke)

console.log()
console.log('视觉尺寸对照（视觉盒 = 字形包围盒 + 描边外扩，单位 pt @各自字号）')
console.log(`${'图标'.padEnd(14)}${'字号'.padStart(6)}${'视觉宽'.padStart(10)}${'视觉高'.padStart(10)}`)
for (const b of tabBoxes) {
  console.log(
    `${b.name.padEnd(14)}${String(SIZE_TAB).padStart(6)}` +
    `${(b.w / EM * SIZE_TAB).toFixed(2).padStart(10)}${(b.h / EM * SIZE_TAB).toFixed(2).padStart(10)}`,
  )
}
console.log(
  `${'love(爱心)'.padEnd(14)}${String(SIZE_HEART).padStart(6)}` +
  `${(heartBox.w / EM * SIZE_HEART).toFixed(2).padStart(10)}${(heartBox.h / EM * SIZE_HEART).toFixed(2).padStart(10)}`,
)

const tabHeights = tabBoxes.map((b) => (b.h / EM) * SIZE_TAB).sort((a, b) => a - b)
const tabWidths = tabBoxes.map((b) => (b.w / EM) * SIZE_TAB).sort((a, b) => a - b)
const tabMedH = (tabHeights[1] + tabHeights[2]) / 2
const tabMedW = (tabWidths[1] + tabWidths[2]) / 2
const heartH = (heartBox.h / EM) * SIZE_HEART
const heartW = (heartBox.w / EM) * SIZE_HEART
console.log(`  → 相邻图标视觉高 ${tabHeights.map((v) => v.toFixed(2)).join(' / ')} pt（中位 ${tabMedH.toFixed(2)}）`)
console.log(`  → 相邻图标视觉宽 ${tabWidths.map((v) => v.toFixed(2)).join(' / ')} pt（中位 ${tabMedW.toFixed(2)}）`)
console.log(`  → 爱心视觉盒 ${heartW.toFixed(2)} × ${heartH.toFixed(2)} pt（${SIZE_HEART}pt 字号，含描边外扩 ${(heartStroke / 2).toFixed(1)} 单位）`)

const tabPts = TAB_ICONS.map((n) => (measured[n].p05 / EM) * SIZE_TAB)
const sorted = [...tabPts].sort((a, b) => a - b)
const medianPt = (sorted[1] + sorted[2]) / 2
const meanPt = tabPts.reduce((a, b) => a + b, 0) / tabPts.length
const minPt = sorted[0]
const maxPt = sorted[3]

console.log()
console.log(`相邻 Tab 图标屏幕线宽：${tabPts.map((v) => v.toFixed(2)).sort().join(' / ')} pt`)
console.log(`  → 中位数 ${medianPt.toFixed(3)}pt，平均 ${meanPt.toFixed(3)}pt，` +
  `区间 [${minPt.toFixed(2)}, ${maxPt.toFixed(2)}]pt`)
console.log(`爱心屏幕线宽：${(64 / EM * 24).toFixed(3)}pt（老值 64@24pt） → ` +
  `${heartPt.toFixed(3)}pt（现值 ${heartStroke}@${SIZE_HEART}pt）`)

console.log()
console.log('='.repeat(94))
console.log('断言')
console.log('='.repeat(94))

// 仪器有效性：相邻 Tab 字形都是等宽笔画，测得的弦长至少要落在合理量级
for (const name of TAB_ICONS) {
  const t = measured[name].p05
  check(`测量有效：${name} 线宽 ${fmt(t)} 单位落在 60~140`, t >= 60 && t <= 140, `p05=${fmt(t)}`)
}
check('爱心路径与线宽可从 SvgIcon.tsx 解析到',
  !!heartPath && Number.isFinite(heartStroke), `stroke=${heartStroke}`)

// 字体家族的线宽本身就略有差异（79~96），这是设计事实，不必强求相等
check(`Tab 图标间线宽差异受控（max/min = ${(maxPt / minPt).toFixed(2)} < 1.30）`,
  maxPt / minPt < 1.3, `${minPt.toFixed(2)} ~ ${maxPt.toFixed(2)}`)

// 核心断言 1：爱心线宽必须落在相邻 Tab 的实际区间内，且贴近中位数
check(`爱心线宽 ${heartPt.toFixed(2)}pt 落在相邻 Tab 区间 [${minPt.toFixed(2)}, ${maxPt.toFixed(2)}]pt 内`,
  heartPt >= minPt && heartPt <= maxPt, `heart=${heartPt.toFixed(2)}`)
check(`爱心线宽与相邻 Tab 中位数偏差 ≤5%（${((heartPt - medianPt) / medianPt * 100).toFixed(1)}%）`,
  Math.abs(heartPt - medianPt) / medianPt <= 0.05,
  `heart=${heartPt.toFixed(3)} median=${medianPt.toFixed(3)}`)

// 核心断言 2：「看着一样大」还有一半取决于体量。字体字形铺满 em 框（视觉高 = 字号），
// 手绘爱心只占 1em 的 66%×63%，所以必须渲染在更大的字号上才齐平。
// 只看线宽会漏掉这一半——历史上正是「线宽对了但爱心小一圈」。
check(`爱心视觉高 ${heartH.toFixed(2)}pt 与相邻 Tab 视觉高中位偏差 ≤5%` +
  `（${((heartH - tabMedH) / tabMedH * 100).toFixed(1)}%）`,
Math.abs(heartH - tabMedH) / tabMedH <= 0.05,
  `heart=${heartH.toFixed(2)} median=${tabMedH.toFixed(2)}`)
check(`爱心视觉宽 ${heartW.toFixed(2)}pt 落在相邻 Tab 宽度区间 ` +
  `[${tabWidths[0].toFixed(2)}, ${tabWidths[3].toFixed(2)}]pt 内`,
heartW >= tabWidths[0] && heartW <= tabWidths[3],
  `heart=${heartW.toFixed(2)}`)
// 爱心比相邻图标窄（心形带尖角）是形状使然，但明显更窄就说明字号还偏小
check(`爱心视觉宽不小于相邻 Tab 宽度中位的 90%（${(heartW / tabMedW * 100).toFixed(1)}%）`,
  heartW / tabMedW >= 0.9, `heart=${heartW.toFixed(2)} median=${tabMedW.toFixed(2)}`)

// 反例回归：旧值/错配必须被判不合格，否则说明阈值形同虚设
// ① 老配置：线宽 64 配 24pt → 1.50pt，比相邻细一圈
const oldPt = (64 / EM) * 24
check(`老配置 64@24pt（${oldPt.toFixed(2)}pt）确实偏细、会被本脚本判不合格`,
  oldPt < minPt * 0.95, `old=${oldPt.toFixed(2)} < ${(minPt * 0.95).toFixed(2)}`)
// ② 只提字号、忘了重算线宽 → 线宽随字号同步放大，反而变粗
const naivePt = (79 / EM) * SIZE_HEART
check(`只提字号不重算线宽（79@${SIZE_HEART}pt = ${naivePt.toFixed(2)}pt）确实偏粗、会被判不合格`,
  naivePt > maxPt * 1.05, `naive=${naivePt.toFixed(2)} > ${(maxPt * 1.05).toFixed(2)}`)
// ③ 不提字号（仍 24pt）时体量差会被判不合格——这正是「爱心看着小一圈」的量化形式
const oldHeartH = ((heartPathBBox.h + 64) / EM) * 24
check(`不提字号（24pt）时视觉高只有 ${oldHeartH.toFixed(2)}pt，确实小一圈、会被判不合格`,
  Math.abs(oldHeartH - tabMedH) / tabMedH > 0.05,
  `old=${oldHeartH.toFixed(2)} median=${tabMedH.toFixed(2)}`)

// 爱心图形占位偏小，故它渲染在更大的字号上——这个前提变了要重新核算线宽
check(`爱心字形可视高度约占 1em 的 ${(heartPathBBox.h / EM * 100).toFixed(0)}%（< 80% → 需要放大字号补偿）`,
  heartPathBBox.h / EM < 0.8,
  `h=${heartPathBBox.h.toFixed(0)} 单位 = ${(heartPathBBox.h / EM * SIZE_HEART).toFixed(1)}pt`)

// 渲染尺寸与实现同步
check(`Tab 栏仍以 ${SIZE_TAB}pt 渲染普通图标、${SIZE_HEART}pt 渲染爱心`,
  !!loveSizeMatch && Number(loveSizeMatch[1]) === SIZE_HEART && Number(loveSizeMatch[2]) === SIZE_TAB,
  loveSizeMatch ? `love=${loveSizeMatch[1]} 其他=${loveSizeMatch[2]}` : '未匹配到尺寸三元表达式')

console.log()
const pad = Math.max(...results.map((r) => r.label.length))
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'}  ${r.label.padEnd(pad)}${r.detail ? '   [' + r.detail + ']' : ''}`)
}
console.log()
console.log(`结果：${results.length - failed}/${results.length} 通过${failed ? `（${failed} 项失败）` : ''}`)
process.exit(failed ? 1 : 0)
