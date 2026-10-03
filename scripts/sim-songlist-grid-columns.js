/**
 * sim-songlist-grid-columns.js
 *
 * 「歌单」页封面网格的列数契约：手机竖屏 = 主题设置里的 2 / 3 列，iPad 自适应多列。
 *
 * 为什么需要它：`src/screens/Home/Views/SongList/components/Songlist/List.tsx` 的列数原由
 * 「可用宽度 ÷ 最小卡宽」反推，公式对宽度极敏感 —— 可用宽跨过 ~395pt 时 2 列会翻成 3 列：
 * Plus / Pro Max / 16 Pro 这类宽屏机型上封面缩到 ~115pt、两行标题被截成「…」，
 * 而 390pt 机型正常（用户 2026-10-03 反馈）。当时把手机竖屏上限钉死 2 列（5f3ffa0）；
 * 随后用户要求「2 个一排和 3 个一排都保留，加到主题设置里可以切换」，于是列数改由
 * `theme.songlistColumns`（默认 2）决定，iPad 与大屏仍按可用宽度自适应。
 *
 * 两层断言：
 *   ① 源码层：手机竖屏分支必须直接用设置值（`: songlistColumns`），大屏分支保留
 *      `isLargeScreen` 自适应，且不得再出现「写死 : 2」的历史写法；
 *   ② 数值层：用与 scaleSizeW 等价的模型跑机型矩阵 —— 设置 2 时手机全 2 列（守住 5f3ffa0
 *      的回归：宽屏机型不得自己翻成 3 列），设置 3 时手机全 3 列（守住「选了 3 却仍 2 列」），
 *      iPad 竖屏 / 横屏两种情况都仍排 ≥4 列（设置不影响大屏）。
 * 反例：模型去掉设置项、回到「无上限按宽度反推」（= 修复前行为）时，430pt 必须复现 3 列，
 * 而设置 2 的期望是 2 列 —— 拦不下来说明断言没有区分力。
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
 * 列数模型。
 *   setting      = 主题设置 theme.songlistColumns（2 / 3），只在手机竖屏生效
 *   legacyNoCap  = true 复现「修复前」的手机竖屏无设置项行为（纯按宽度反推），用作反例
 * isPad 对应源码里的 Platform.isPad（真机 iPad），模型里显式传入。
 */
const columns = ({ width, height, pixelRatio, isPad = false, setting = 2, legacyNoCap = false }) => {
  const available = width - SIDE_PADDING
  const gap = scaleSizeW(GAP_DESIGN, width, height, pixelRatio)
  const horizontal = width / height > 1.2
  const minWidth = scaleSizeW(horizontal ? MIN_LANDSCAPE : MIN_PORTRAIT, width, height, pixelRatio)
  let n = available / (minWidth + gap)
  if (n > 10) n = 10
  const computedItemWidth = Math.floor((available - gap) / n)
  const isLargeScreen = isPad || available >= 600
  if (isLargeScreen) return Math.min(Math.max(Math.floor(available / computedItemWidth), 2), 10)
  if (legacyNoCap) return Math.max(Math.floor(available / computedItemWidth), 2)
  return setting
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
  '手机竖屏列数直接取主题设置（: songlistColumns）',
  /:\s*songlistColumns\b/.test(SRC),
)
check(
  '大屏分支仍按宽度反推（isLargeScreen + min(..., 10)）',
  /const isLargeScreen = isPad \|\| available >= 600/.test(SRC) &&
    /Math\.min\(Math\.max\(Math\.floor\(available \/ computedItemWidth\), 2\), 10\)/.test(SRC),
)
check(
  '列数来自主题设置 theme.songlistColumns',
  /useSettingValue\('theme\.songlistColumns'\)/.test(SRC),
)
check(
  '历史写法（手机竖屏写死 2）不得回归',
  !/const maxNum = [^\n]*\? 10 : 2/.test(SRC),
)

// ② 手机竖屏：设置 2 → 2 列（含触发过 3 列的宽屏机型）；设置 3 → 3 列
for (const [name, width, height, pixelRatio] of PHONES) {
  const num2 = columns({ width, height, pixelRatio, setting: 2 })
  check(`${name}（${width}×${height}pt）设 2 时 2 列`, num2 === 2, `实际 ${num2} 列`)
  const num3 = columns({ width, height, pixelRatio, setting: 3 })
  check(`${name}（${width}×${height}pt）设 3 时 3 列`, num3 === 3, `实际 ${num3} 列`)
}

// ③ iPad 仍按可用宽度排多列（设置项对大屏不生效）
for (const [name, width, height, pixelRatio] of PADS) {
  for (const setting of [2, 3]) {
    const num = columns({ width, height, pixelRatio, isPad: true, setting })
    check(`${name}（设 ${setting}）仍排多列（≥4）`, num >= 4, `实际 ${num} 列`)
  }
}

// ④ 反例：去掉设置项、回到「手机也按宽度反推」（= 修复前）必须能在宽屏手机上复现 3 列，
//    否则「设 2 时全 2 列」的断言没有区分力
const beforeFix = columns({ width: 430, height: 932, pixelRatio: 3, legacyNoCap: true })
check('反例：无设置项时 430pt 机型复现 3 列（与「设 2 → 2 列」形成区分）', beforeFix === 3, `实际 ${beforeFix} 列`)

if (failures.length) {
  console.error(`✗ sim-songlist-grid-columns：${failures.length} 项失败`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('✓ sim-songlist-grid-columns：手机竖屏 2 / 3 列可切换、iPad 自适应多列（含 1 例反例）')
