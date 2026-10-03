/**
 * sim-songlist-grid-columns.js
 *
 * 「歌单」页封面网格的列数契约：手机竖屏必须 2 列。
 *
 * 为什么需要它：`src/screens/Home/Views/SongList/components/Songlist/List.tsx` 的列数由
 * 「可用宽度 ÷ 最小卡宽」反推，公式对宽度极敏感 —— 可用宽跨过 ~395pt 时 2 列会翻成 3 列。
 * 也就是 Plus / Pro Max / 16 Pro 这类宽屏机型上封面缩到 ~115pt、两行标题被截成「…」，
 * 而 390pt 机型正常（用户 2026-10-03 反馈：图 1 是 3 列反例，图 2 是正常双列）。
 * 修法：手机竖屏把列数上限钉死 2，iPad（竖屏 / 横屏）仍按可用宽度排多列。
 *
 * 两层断言：
 *   ① 源码层：列数上限门控 + 最终列数表达式必须仍是「取 min(宽度反推, 上限)」，
 *      且上限门控保留 `: 2` 的手机分支 —— 有人删回无上限即失败；
 *   ② 数值层：用与 scaleSizeW 等价的模型跑机型矩阵，手机竖屏全 2 列、iPad 竖屏/横屏 ≥4 列。
 * 反例：把上限换成恒 10（= 修复前行为），模型必须在 430pt 上算出 3 列；
 * 反例拦不下来说明断言没有区分力。
 *
 * 运行：node scripts/sim-songlist-grid-columns.js
 * 退出码：全过 0，任一失败 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const FILE = 'src/screens/Home/Views/SongList/components/Songlist/List.tsx'
// 仓库里同一文件可能混存 CRLF/LF，先归一化再断言（多行锚点否则会假失败）
const SRC = fs.readFileSync(path.join(ROOT, FILE), 'utf8').replace(/\r\n/g, '\n')

const failures = []
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(detail ? `${name} —— ${detail}` : name)
}

const pickNumber = (re) => {
  const m = SRC.match(re)
  return m ? Number(m[1]) : null
}

// 源码里的设计常数（改这些常数时模型跟着变，不写死）
const MIN_PORTRAIT = pickNumber(/MIN_WIDTH_PORTRAIT = scaleSizeW\((\d+)\)/)
const MIN_LANDSCAPE = pickNumber(/MIN_WIDTH_LANDSCAPE = scaleSizeW\((\d+)\)/)
const GAP_DESIGN = pickNumber(/^const GAP = scaleSizeW\((\d+)\)$/m)
const SIDE_PADDING = pickNumber(/const available = width - (\d+)/)

// scaleSizeW 的等价模型（designWidth/Height = 375/667、有效倍率上限 3.1 / 1.2×pixelRatio）
const scaleSizeW = (size, width, height, pixelRatio) => {
  const w = Math.min(width, height)
  const h = Math.max(width, height)
  const scale = Math.min((w * pixelRatio) / 375, (h * pixelRatio) / 667, 3.1, 1.2 * pixelRatio)
  return Math.floor((size * scale) / pixelRatio)
}

/**
 * 列数模型。capToTwo = false 复现「修复前」的无上限行为，用作反例。
 * isPad 对应源码里的 Platform.isPad（真机 iPad），模型里显式传入。
 */
const columns = ({ width, height, pixelRatio, isPad = false, capToTwo = true }) => {
  const available = width - SIDE_PADDING
  const gap = scaleSizeW(GAP_DESIGN, width, height, pixelRatio)
  const horizontal = width / height > 1.2
  const minWidth = scaleSizeW(horizontal ? MIN_LANDSCAPE : MIN_PORTRAIT, width, height, pixelRatio)
  let n = available / (minWidth + gap)
  if (n > 10) n = 10
  const computedItemWidth = Math.floor((available - gap) / n)
  const raw = Math.max(Math.floor(available / computedItemWidth), 2)
  const maxNum = capToTwo ? (isPad || available >= 600 ? 10 : 2) : 10
  return Math.min(raw, maxNum)
}

const PHONES = [
  ['iPhone SE', 320, 568, 2],
  ['iPhone 12/13 mini', 375, 812, 3],
  ['iPhone 14/15/16', 390, 844, 3],
  ['iPhone 16 Pro', 402, 874, 3],
  ['iPhone 11/XR/8 Plus', 414, 896, 3],
  ['iPhone 14 Pro Max', 428, 926, 3],
  ['iPhone 15/16 Pro Max', 430, 932, 3],
  ['iPhone 16 Pro Max', 440, 956, 3],
]
const PADS = [
  ['iPad 9.7 竖屏', 768, 1024, 2],
  ['iPad 10.9 竖屏', 820, 1180, 2],
  ['iPad Pro 12.9 竖屏', 1024, 1366, 2],
  ['iPad 9.7 横屏', 1024, 768, 2],
  ['iPad Pro 12.9 横屏', 1366, 1024, 2],
]

// ① 源码层
check('源码仍从两个最小卡宽常数反推列数', MIN_PORTRAIT !== null && MIN_LANDSCAPE !== null)
check('源码仍按可用宽度扣除内边距反推列数', SIDE_PADDING !== null && GAP_DESIGN !== null)
check(
  '列数仍取 min(宽度反推, 上限)',
  /const num = Math\.min\(Math\.max\(Math\.floor\(available \/ computedItemWidth\), 2\), maxNum\)/.test(SRC),
)
check(
  '手机竖屏列数上限仍钉在 2（上限门控保留 : 2 分支）',
  /const maxNum = [^\n]*\? 10 : 2/.test(SRC),
)

// ② 手机竖屏必须 2 列（含触发过 3 列的宽屏机型）
for (const [name, width, height, pixelRatio] of PHONES) {
  const num = columns({ width, height, pixelRatio })
  check(`${name}（${width}×${height}pt）竖屏 2 列`, num === 2, `实际 ${num} 列`)
}

// ③ iPad 仍按可用宽度排多列
for (const [name, width, height, pixelRatio] of PADS) {
  const num = columns({ width, height, pixelRatio, isPad: true })
  check(`${name} 仍排多列（≥4）`, num >= 4, `实际 ${num} 列`)
}

// ④ 反例：去掉上限（= 修复前）必须能在宽屏手机上复现 3 列，否则断言无区分力
const beforeFix = columns({ width: 430, height: 932, pixelRatio: 3, capToTwo: false })
check('反例：无上限时 430pt 机型复现 3 列', beforeFix === 3, `实际 ${beforeFix} 列`)

if (failures.length) {
  console.error(`✗ sim-songlist-grid-columns：${failures.length} 项失败`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ sim-songlist-grid-columns：手机竖屏 2 列契约全过（含 1 例反例）')
