/**
 * sim-songlist-columns.js
 *
 * 「歌单页封面 2 个一排 / 3 个一排可在 主题设置 里切换」契约（2026-10-03）。
 *
 * 用户诉求：歌单页封面 2 个一排和 3 个一排（两张截图），加到主题设置里可以切换。
 *
 * 背景：宽屏手机（Plus / Pro Max / 16 Pro，可用宽 ≥ ~395pt）按列宽公式会算出 3 列，
 * 封面缩到约 115pt、两行标题被截断，用户 2026-10-03 反馈后一度把手机竖屏上限**写死 2 列**
 * （5f3ffa0）。现在把 2 / 3 变成主题设置 `theme.songlistColumns`，默认 2（沿用当时观感）；
 * iPad 与大屏（可用宽 ≥ 600pt）仍按可用宽度自适应多列（大屏固定 2~3 列会浪费横向空间）。
 *
 * 本脚本守两件事：
 *   ① 设置 3 时**真的**能得到 3 列 —— 若沿用旧的「clamp(computed, 2, 列数上限)」公式，
 *      390pt 手机上 computed 恰好是 2，选 3 也会被夹回 2（用户会以为设置没生效）；
 *   ② 默认值 / 文案 / 主题设置入口 / 消费点 全链路齐全，且 iPad 分支仍自适应。
 *
 * 分工：机型矩阵（各 iPhone / iPad 的列数与列宽）由 scripts/sim-songlist-grid-columns.js 守着，
 *       本脚本只管「设置链路 + 选 3 别被夹回 2」这一层。
 *
 * 运行：node scripts/sim-songlist-columns.js
 * 退出码：不变量全过、且所有反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  list: 'src/screens/Home/Views/SongList/components/Songlist/List.tsx',
  defaults: 'src/config/defaultSetting.ts',
  types: 'src/types/app_setting.d.ts',
  themeScreen: 'src/screens/Home/Views/Setting/settings/ThemeScreen.tsx',
  optionUI: 'src/screens/Home/Views/Setting/settings/Theme/SonglistColumns.tsx',
  i18n: 'src/lang/zh-cn.json',
}
const I18N_KEYS = [
  'setting_basic_theme_songlist_columns',
  'setting_basic_theme_songlist_columns_desc',
  'setting_basic_theme_songlist_columns_2',
  'setting_basic_theme_songlist_columns_3',
]

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const REAL = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]))
const I18N = JSON.parse(REAL.i18n)

const structuralReasons = (files, i18n, optionUiExists) => {
  const reasons = []

  // ① 消费点：列数必须来自主题设置，手机分支不得写死
  if (!/useSettingValue\('theme\.songlistColumns'\)/.test(files.list)) {
    reasons.push('歌单封面网格没有读取 theme.songlistColumns')
  }
  if (!/const isLargeScreen = isPad \|\| available >= 600/.test(files.list)) {
    reasons.push('缺少「iPad / 大屏按宽度自适应」的分支判定')
  }
  if (!/:\s*songlistColumns\b/.test(files.list)) {
    reasons.push('手机竖屏分支没有直接使用设置里的列数（会被公式夹回 2）')
  }
  if (/const maxNum = isPad \|\| available >= 600 \? 10 : 2/.test(files.list)) {
    reasons.push('手机竖屏列数又被写死成 2（设置里的 3 个一排会失效）')
  }
  if (!/songlistColumns\]/.test(files.list)) {
    reasons.push('rowInfo 的 useMemo 依赖里没有 songlistColumns（改设置不会重算列数）')
  }

  // ② 默认值 / 类型
  if (!/'theme\.songlistColumns': 2,/.test(files.defaults)) {
    reasons.push("默认设置缺少 'theme.songlistColumns': 2")
  }
  if (!/'theme\.songlistColumns': 2 \| 3/.test(files.types)) {
    reasons.push("类型声明缺少 'theme.songlistColumns': 2 | 3")
  }

  // ③ 主题设置入口 + 两个选项
  if (!/<SonglistColumns \/>/.test(files.themeScreen)) {
    reasons.push('主题设置页没有挂 <SonglistColumns />')
  }
  if (!optionUiExists) {
    reasons.push('设置组件 Theme/SonglistColumns.tsx 不存在')
  } else {
    if (!/updateSetting\(\{ 'theme\.songlistColumns': 2 \}\)/.test(files.optionUI)) {
      reasons.push('设置组件没有「2 个一排」选项')
    }
    if (!/updateSetting\(\{ 'theme\.songlistColumns': 3 \}\)/.test(files.optionUI)) {
      reasons.push('设置组件没有「3 个一排」选项')
    }
    if (!/check=\{columns === 2\}/.test(files.optionUI) || !/check=\{columns === 3\}/.test(files.optionUI)) {
      reasons.push('设置组件的选中态没有跟随当前列数（单选语义缺失）')
    }
  }

  // ④ 文案
  for (const key of I18N_KEYS) {
    if (i18n[key] == null) reasons.push(`文案 ${key} 缺失`)
  }

  return reasons
}

const optionUiPath = path.join(ROOT, 'src/screens/Home/Views/Setting/settings/Theme/SonglistColumns.tsx')
const realReasons = structuralReasons(REAL, I18N, fs.existsSync(optionUiPath))

// ---------------------------------------------------------------------------
// 行为模型：复刻 List.tsx 的列数计算（scaleSizeW 用同样的 scale/pixelRatio 公式）
// ---------------------------------------------------------------------------
const scaleSize = (size, scale, pixelRatio, fontSize = 1) => Math.floor((size * scale) / pixelRatio) * fontSize

/** 手机 / iPad 的 (可用宽, 最小列宽, 列间距) —— 与 List.tsx 常量同源：110 / 150 / 20 设计值 */
const metrics = (width, { isPad = false, isHorizontal = false, scale, pixelRatio }) => {
  const available = width - 20
  return {
    available,
    minWidth: scaleSize(isHorizontal ? 150 : 110, scale, pixelRatio),
    gap: scaleSize(20, scale, pixelRatio),
    isPad: isPad || available >= 600,
  }
}

/** 复刻「旧」公式：列数上限 = 设置值，但先按宽度算 computed 再 clamp —— 390pt 选 3 会被夹回 2 */
const oldClampFormula = ({ available, minWidth, gap, isPad }, settingColumns) => {
  const maxNum = isPad ? 10 : settingColumns
  const n = Math.min(available / (minWidth + gap), 10)
  const computedItemWidth = Math.floor((available - gap) / n)
  return Math.min(Math.max(Math.floor(available / computedItemWidth), 2), maxNum)
}

/** 复刻「新」公式：手机竖屏直接用设置值；iPad / 大屏自适应 */
const resolveColumns = ({ available, minWidth, gap, isPad }, settingColumns) => {
  if (!isPad) return settingColumns
  const n = Math.min(available / (minWidth + gap), 10)
  const computedItemWidth = Math.floor((available - gap) / n)
  return Math.min(Math.max(Math.floor(available / computedItemWidth), 2), 10)
}

const models = []
{
  const phone390 = metrics(390, { scale: 3.1, pixelRatio: 3 })
  const phone430 = metrics(430, { scale: 3.1, pixelRatio: 3 })
  const phone320 = metrics(320, { scale: 2.56, pixelRatio: 3 })
  const padPortrait = metrics(768, { isPad: true, scale: 2.4, pixelRatio: 2 })
  const padLandscape = metrics(1024, { isPad: true, isHorizontal: true, scale: 2.4, pixelRatio: 2 })

  const ok =
    resolveColumns(phone390, 2) === 2 &&
    resolveColumns(phone390, 3) === 3 &&
    resolveColumns(phone430, 2) === 2 &&
    resolveColumns(phone430, 3) === 3 &&
    resolveColumns(phone320, 3) === 3 &&
    resolveColumns(padPortrait, 2) >= 3 && resolveColumns(padPortrait, 3) >= 3 &&
    resolveColumns(padLandscape, 2) >= 3 && resolveColumns(padLandscape, 3) >= 3
  models.push(['手机竖屏按设置 2 / 3 列；iPad 竖横屏仍自适应多列', ok])

  // 反例：旧 clamp 公式在 390pt 手机上选 3 会得到 2 —— 必须与「必须得到 3」的期望不同
  const counter = oldClampFormula(phone390, 3) === 2
  models.push(['反例：旧 clamp 公式会把 390pt 手机的「3 个一排」夹回 2 列', counter])

  // 列宽合理性：两列 / 三列的封面宽度都必须为正、且三列比两列窄
  const width2 = (phone390.available - phone390.gap) / resolveColumns(phone390, 2)
  const width3 = (phone390.available - phone390.gap) / resolveColumns(phone390, 3)
  models.push(['列宽 = (可用宽 − 间距) / 列数，且三列窄于两列', width2 > width3 && width3 > 0])
}

const failedModels = models.filter(([, pass]) => !pass)

// ---------------------------------------------------------------------------
// 结构反例（都必须被拦下）
// ---------------------------------------------------------------------------
const cases = []
{
  const tampered = {
    ...REAL,
    list: REAL.list.replace('      : songlistColumns\n', '      : 2\n'),
  }
  const caught = structuralReasons(tampered, I18N, true).some((r) => r.includes('没有直接使用设置里的列数'))
  cases.push(['手机分支改回写死 2 列', caught])
}
{
  const tampered = {
    ...REAL,
    defaults: REAL.defaults.replace("'theme.songlistColumns': 2,", "'theme.songlistColumns': 3,"),
  }
  const caught = structuralReasons(tampered, I18N, true).some((r) => r.includes('默认设置缺少'))
  cases.push(['默认列数被改成 3（应保持 2）', caught])
}
{
  const tampered = {
    ...REAL,
    themeScreen: REAL.themeScreen.replace('      <SonglistColumns />\n', ''),
  }
  const caught = structuralReasons(tampered, I18N, true).some((r) => r.includes('主题设置页没有挂'))
  cases.push(['主题设置页移除入口', caught])
}

const failedCases = cases.filter(([, caught]) => !caught)

// ---------------------------------------------------------------------------
console.log('列数模型（复刻 List.tsx 的 rowInfo 计算）')
for (const [name, pass] of models) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, caught] of cases) console.log(`${caught ? 'PASS' : 'FAIL'}  ${name} —— ${caught ? '已拦下' : '未拦下'}`)
console.log('')

let failed = 0
if (realReasons.length) {
  console.error(`FAIL  歌单封面列数契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
  failed++
}
if (failedModels.length) {
  console.error(`FAIL  列数模型未通过（${failedModels.length} 项）`)
  failed++
}
if (failedCases.length) {
  console.error(`FAIL  有反例未被拦下（${failedCases.length} 项，断言无区分力）`)
  failed++
}

if (!failed) {
  console.log(`PASS  歌单封面列数可在主题设置切换（结构不变量 6 组 + 行为模型 ${models.length} 例 + 结构反例 ${cases.length} 例）`)
  process.exit(0)
}
process.exit(1)
