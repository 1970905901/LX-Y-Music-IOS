/**
 * sim-glass-contrast.js —— 玻璃底衬「材质模型 + 对比度」复刻脚本
 *
 * 复刻什么
 * --------
 * Tab 栏 / 迷你播放条的玻璃底衬由三层叠成：
 *   底下的滚动内容（专辑图模糊图） → 原生玻璃底衬 → 上层 RN 文字/图标
 * 本脚本用 WCAG 相对亮度串起这条合成链，回答两个纯逻辑问题：
 *   1. 「没有材质、只有染色覆层」时，玻璃对可读性到底有没有贡献？
 *   2. 有系统材质时，主题给出的文字色（c-450 等）在合成结果上是否达到 AA 4.5:1？
 *
 * 主题数据不写死：直接解析 src/theme/themes/themes.ts 里全部主题的
 * c-450（全 App 次级文字色，Tab 栏旧非选中色）。
 * 避免「脚本里的值和 App 里的值漂移」。
 *
 * 2026-09-29 模型同步（「纯玻璃」定案后）：
 *   - 磨砂覆层不再随主题色（c-primary-light-600），改为中性色：浅色白 / 深色黑
 *     （LGGlassViewFactory 现状）；
 *   - 深色模式有保底暗化 DARK_OVERLAY_FLOOR（LiquidGlass.tsx）——用户把玻璃
 *     不透明度拉到 0 时，深色材质下不存在任何文字色可达 AA，保底是必要条件；
 *   - Tab 栏非选中项文字/图标色改为按主题分派的中性灰
 *     （ModernTabBar.tsx TAB_INACTIVE_LIGHT/DARK），断言5/7 体检该分派色。
 *
 * 材质建模（重要：这是模型，不是真机采样）
 * ---------------------------------------
 * HIG 对 regular 材质的描述是「模糊并调整背景亮度，保文字可读」，即材质把
 * 背景亮度向「该系统模式下的中性基色」收敛。本脚本按此建模：
 *      L_mat = L_bg * (1 - k) + L_base * k        k = MATERIAL_CONVERGE
 * L_base 取系统中性基色：浅色模式 systemGray6 (242,242,247)，深色模式 (28,28,30)。
 * 真机上的真实收敛曲线由系统决定，本模型只用于验证「方向性结论」与「上下限」，
 * 不能替代真机目视。模型若不成立，下面带反例的断言会先失败。
 *
 * 已知局限：只覆盖内置主题。用户自定义主题（utils/data 里的 userThemes）不在
 * themes.ts 里，无法静态覆盖 —— 结论对自定义主题只有「同一公式」的参考意义。
 *
 * 运行：
 *   C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node.exe \
 *     scripts/sim-glass-contrast.js
 */

'use strict'

const fs = require('fs')
const path = require('path')

const THEMES_FILE = path.join(__dirname, '..', 'src', 'theme', 'themes', 'themes.ts')

// ---------------------------------------------------------------- 材质模型常量

/** 材质把背景亮度向中性基色收敛的比例（0 = 不收敛/无材质，1 = 完全变基色） */
const MATERIAL_CONVERGE = 0.8

/** 系统中性基色（sRGB 0~255）：浅色 systemGray6 / 深色 systemBackground */
const MATERIAL_BASE_LIGHT = [242, 242, 247]
const MATERIAL_BASE_DARK = [28, 28, 30]

/**
 * 染色覆层 alpha 的映射上限：用户设置 0~100 线性映射到覆层 alpha 0~TINT_ALPHA_CAP。
 * 覆层 alpha 到 1 会把材质完全盖住（合成结果退化成纯 tint 色），材质的自适应
 * 归零 —— 这是本脚本断言 4 要证明的事。
 */
const TINT_ALPHA_CAP = 0.6

/**
 * 磨砂覆层中性色（「纯玻璃」定案：不随主题色，浅色白 / 深色黑 ——
 * LGGlassViewFactory 现状）。
 */
const OVERLAY_LIGHT = [255, 255, 255]
const OVERLAY_DARK = [0, 0, 0]

/**
 * 深色模式磨砂覆层的最终 alpha 保底（LiquidGlass.tsx DARK_OVERLAY_FLOOR_USER
 * × TINT_ALPHA_CAP 换算而来）：无保底时（alpha 可取 0）深色材质下任何文字色
 * 都无法达 AA（断言7 验证此必要性）。
 */
const DARK_OVERLAY_FLOOR = 0.2

/**
 * Tab 栏非选中项文字/图标分派色（ModernTabBar.tsx TAB_INACTIVE_LIGHT/DARK），
 * 替换在玻璃上不达标的 c-450。⚠️ 与组件人工同步（组件有反向指路注释）。
 */
const TAB_INACTIVE_LIGHT_V = 94
const TAB_INACTIVE_DARK_V = 248

/** AA 要求：文字 ≤17px 需 4.5:1（Tab 栏文字 size=12） */
const AA_NORMAL = 4.5

/** 代表「专辑图模糊图」的背景亮度档位（灰色等效，避免依赖具体图片） */
const BACKGROUNDS = [
  { name: '近白封面', L: 0.95 },
  { name: '浅色封面', L: 0.75 },
  { name: '中灰封面', L: 0.50 },
  { name: '深色封面', L: 0.25 },
  { name: '近黑封面', L: 0.05 },
]

// ---------------------------------------------------------------- WCAG 计算

const srgbToLinear = (c8) => {
  const c = c8 / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** rgb [0~255] → WCAG 相对亮度 */
const luminance = ([r, g, b]) =>
  0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)

const contrast = (l1, l2) => {
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

/** 灰度 L 反查 8bit 灰值（用于「建议文字色」） */

/** 把亮度 L 与一个颜色按 alpha 合成（在 L 空间近似，用于定性结论） */
const compositeL = (baseL, colorL, alpha) => baseL * (1 - alpha) + colorL * alpha

// ---------------------------------------------------------------- 主题解析

const parseThemes = (src) => {
  const themes = []
  // 每个主题块以 `    id: 'xxx',` 开头
  const chunks = src.split(/\n {4}id: '/).slice(1)
  for (const chunk of chunks) {
    const id = chunk.slice(0, chunk.indexOf("'"))
    const isDark = /isDark:\s*true/.test(chunk)
    const pick = (key) => {
      const m = chunk.match(new RegExp(`'${key}':\\s*'rgba?\\(([^)]*)\\)'`))
      if (!m) return null
      const nums = m[1].split(',').map((s) => parseFloat(s.trim()))
      return nums.slice(0, 3).map((n) => Math.round(n))
    }
    const tint = pick('c-primary-light-600')
    const label = pick('c-450')
    if (!tint || !label) continue
    themes.push({ id, isDark, tint, label })
  }
  return themes
}

// ---------------------------------------------------------------- 合成链

/**
 * 玻璃底衬的合成亮度。
 * @param bgL      背景（模糊专辑图）亮度
 * @param isDark   主题是否深色（决定材质中性基色）
 * @param hasMaterial 是否有系统材质
 * @param alpha    染色覆层最终 alpha
 * @param tintL    染色基色亮度
 */
const backingLuminance = ({ bgL, isDark, hasMaterial, alpha, tintL }) => {
  const base = hasMaterial
    ? compositeL(bgL, luminance(isDark ? MATERIAL_BASE_DARK : MATERIAL_BASE_LIGHT), MATERIAL_CONVERGE)
    : bgL
  return compositeL(base, tintL, alpha)
}

/** 用户设置 0~100 → 覆层实际 alpha */
const mapUserAlpha = (userValue) => Math.max(0, Math.min(1, userValue / 100)) * TINT_ALPHA_CAP

// ---------------------------------------------------------------- 断言框架

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`)
}

// ---------------------------------------------------------------- 主流程

const src = fs.readFileSync(THEMES_FILE, 'utf8')
const themes = parseThemes(src)
if (themes.length === 0) {
  console.error('未从 themes.ts 解析到任何主题，解析规则可能已失效')
  process.exit(1)
}
const lightThemes = themes.filter((t) => !t.isDark)
const darkThemes = themes.filter((t) => t.isDark)

console.log(`解析到 ${themes.length} 个内置主题（浅色 ${lightThemes.length} / 深色 ${darkThemes.length}）`)
console.log(`材质收敛系数 k=${MATERIAL_CONVERGE}，覆层 alpha 映射上限=${TINT_ALPHA_CAP}\n`)

// ---- 断言 1：现状（无材质）在覆层 alpha=0 时对可读性零贡献 -------------------
{
  const worst = []
  for (const t of themes) {
    for (const bg of BACKGROUNDS) {
      const withGlass = backingLuminance({
        bgL: bg.L, isDark: t.isDark, hasMaterial: false, alpha: 0, tintL: luminance(t.tint),
      })
      worst.push(Math.abs(withGlass - bg.L))
    }
  }
  const maxDelta = Math.max(...worst)
  check(
    '断言1 无材质 + 覆层 alpha=0 ⇒ 玻璃完全等于裸背景（零贡献）',
    maxDelta < 1e-9,
    `全部主题×背景的最大亮度差 = ${maxDelta.toExponential(2)}（应为 0）`,
  )
}

// ---- 断言 2：有材质时，合成亮度被压进材质基色附近（材质在做归一化） ---------
{
  const spreads = []
  for (const isDark of [false, true]) {
    const baseL = luminance(isDark ? MATERIAL_BASE_DARK : MATERIAL_BASE_LIGHT)
    const ls = BACKGROUNDS.map((bg) =>
      backingLuminance({ bgL: bg.L, isDark, hasMaterial: true, alpha: TINT_ALPHA_CAP, tintL: baseL }))
    spreads.push({ isDark, spread: Math.max(...ls) - Math.min(...ls), baseL })
  }
  // 反例性质：若材质不起作用（k=0），跨背景亮度跨度就是背景自身的跨度
  const rawSpread = Math.max(...BACKGROUNDS.map((b) => b.L)) - Math.min(...BACKGROUNDS.map((b) => b.L))
  const pass = spreads.every((s) => s.spread < rawSpread * 0.5)
  check(
    '断言2 有材质 ⇒ 跨背景亮度跨度被压缩一半以上（可读性的来源）',
    pass,
    spreads.map((s) => `${s.isDark ? '深色' : '浅色'}跨度=${s.spread.toFixed(3)}`).join('，') +
      `；无材质跨度=${rawSpread.toFixed(3)}`,
  )
}

// ---- 断言 3：覆层 alpha 映射上下限 -----------------------------------------
{
  const lo = mapUserAlpha(0)
  const hi = mapUserAlpha(100)
  const mid = mapUserAlpha(50)
  const monotonic = mapUserAlpha(30) <= mapUserAlpha(60) && mapUserAlpha(60) <= mapUserAlpha(90)
  check(
    '断言3 覆层 alpha 映射：0→0、100→上限、单调不减',
    lo === 0 && Math.abs(hi - TINT_ALPHA_CAP) < 1e-9 && monotonic,
    `map(0)=${lo}，map(50)=${mid.toFixed(2)}，map(100)=${hi.toFixed(2)}（上限 ${TINT_ALPHA_CAP}）`,
  )
}

// ---- 断言 4（带反例）：上限必须存在，否则材质「自适应」被完全盖住 -------------
// 判据不用「亮度变化幅度」（取决于 tint 与材质基色是否接近，不稳定），改用材质的
// 本质能力：跨背景的自适应。alpha=1 时合成结果与背景无关（跨度恒为 0）。
{
  const tintL = luminance(OVERLAY_LIGHT)
  const isDark = false
  const spanAt = (alpha) => {
    const ls = BACKGROUNDS.map((bg) =>
      backingLuminance({ bgL: bg.L, isDark, hasMaterial: true, alpha, tintL }))
    return Math.max(...ls) - Math.min(...ls)
  }
  const spanAtOne = spanAt(1)
  const spanAtCap = spanAt(TINT_ALPHA_CAP)
  check(
    '断言4 反例：alpha=1 ⇒ 跨背景自适应跨度归零，故上限必须 < 1',
    spanAtOne < 1e-9 && spanAtCap > 0.02,
    `alpha=1 跨度=${spanAtOne.toExponential(2)}（应为 0，材质被纯色覆层盖死）；` +
      `alpha=${TINT_ALPHA_CAP} 跨度=${spanAtCap.toFixed(3)}（自适应仍在）`,
  )
}

// ---- 断言 5：Tab 栏非选中项分派色在合成结果上是否达到 AA 4.5:1 ---------------
// 2026-09-29 修复后体检：Tab 栏已不再用 c-450（修复前在玻璃上最低 1.45:1、
// 全部 80 组不达标），改为按主题模式分派的中性灰。本条必须 PASS。
{
  const offenders = []
  let worst = null
  for (const isDark of [false, true]) {
    const v = isDark ? TAB_INACTIVE_DARK_V : TAB_INACTIVE_LIGHT_V
    const textL = luminance([v, v, v])
    const alpha = Math.max(mapUserAlpha(40), isDark ? DARK_OVERLAY_FLOOR : 0) // 默认设置 40 与保底取大
    for (const bg of BACKGROUNDS) {
      const bgL = backingLuminance({
        bgL: bg.L, isDark, hasMaterial: true, alpha, tintL: luminance(isDark ? OVERLAY_DARK : OVERLAY_LIGHT),
      })
      const ratio = contrast(textL, bgL)
      if (!worst || ratio < worst.ratio) worst = { isDark, bg: bg.name, ratio }
      if (ratio < AA_NORMAL) offenders.push({ mode: isDark ? '深色' : '浅色', bg: bg.name, ratio })
    }
  }
  const pass = offenders.length === 0
  check(
    `断言5 修复体检：Tab 栏非选中分派色（浅 ${TAB_INACTIVE_LIGHT_V} / 深 ${TAB_INACTIVE_DARK_V}）需 ≥ ${AA_NORMAL}:1`,
    pass,
    pass
      ? `全部通过，最坏 ${worst.ratio.toFixed(2)}:1（${worst.isDark ? '深色' : '浅色'}/${worst.bg}）`
      : `不达标 ${offenders.length} 组；样例：${offenders.slice(0, 4).map((o) => `${o.mode}/${o.bg}=${o.ratio.toFixed(2)}:1`).join('，')}`,
  )
}

// ---- 断言 6（模型无关）：c-450 自身决定了它「能放在多亮的背景上」 ------------
// 根因判据（历史记录）：c-450 曾是 Tab 栏非选中色，2026-09-29 已被分派色替换；
// 它仍是全 App 其它页面的次级文字色——但那些背景不是玻璃，不属本缺陷范围。
// 这条不依赖上面的材质模型：给定文字色的亮度 L_text，达 AA 的背景亮度只允许落在
//   上分支：[0, (L+0.05)/AA - 0.05]      （文字比背景暗）
//   下分支：[(L+0.05)*AA - 0.05, 1]      （文字比背景亮）
// 区间测度越小，说明这个颜色越挑背景。测度≈0 即「放哪都不行」，与材质无关。
{
  const allowedMeasure = (textL) => {
    const hi = (textL + 0.05) / AA_NORMAL - 0.05
    const lo = (textL + 0.05) * AA_NORMAL - 0.05
    let m = 0
    if (hi > 0) m += Math.min(hi, 1)
    if (lo < 1) m += 1 - Math.max(lo, 0)
    return m
  }
  const measures = themes.map((t) => ({ id: t.id, isDark: t.isDark, m: allowedMeasure(luminance(t.label)) }))
  const worst = measures.reduce((a, b) => (a.m <= b.m ? a : b))
  const allTiny = measures.every((x) => x.m < 0.2)
  check(
    '断言6 根因判据（历史）：旧非选中色 c-450 可用的背景亮度区间测度 < 0.2（与材质无关）',
    allTiny,
    `最受限 ${worst.id}（${worst.isDark ? '深色' : '浅色'}）测度=${worst.m.toFixed(3)}；` +
      `即该颜色只能在 ${(worst.m * 100).toFixed(1)}% 的背景亮度范围内达标 —— 材质无论多厚都救不了`,
  )
}

// ---- 断言 7（修复验证）：分派色在 glassOpacity 全域 + 全背景下达标 ------------
// 浅色分派色须在 alpha 全域 [0, 上限] 达标；深色分派色在 [保底, 上限] 达标；
// 并反例验证「无保底时深色确实无解」——即保底暗化是必要条件，不是装饰。
{
  const grayWorksEverywhere = (v, isDark, alphaMin, alphaMax) => {
    const textL = luminance([v, v, v])
    const tintL = luminance(isDark ? OVERLAY_DARK : OVERLAY_LIGHT)
    for (let a = alphaMin; a <= alphaMax + 1e-9; a += 0.02) {
      const alpha = Math.min(a, alphaMax)
      for (const bg of BACKGROUNDS) {
        const bgL = backingLuminance({ bgL: bg.L, isDark, hasMaterial: true, alpha, tintL })
        if (contrast(textL, bgL) < AA_NORMAL) return false
      }
    }
    return true
  }
  const lightOk = grayWorksEverywhere(TAB_INACTIVE_LIGHT_V, false, 0, TINT_ALPHA_CAP)
  const darkOk = grayWorksEverywhere(TAB_INACTIVE_DARK_V, true, DARK_OVERLAY_FLOOR, TINT_ALPHA_CAP)
  const darkNeedsFloor = !grayWorksEverywhere(TAB_INACTIVE_DARK_V, true, 0, TINT_ALPHA_CAP)
  const pass = lightOk && darkOk && darkNeedsFloor
  check(
    `断言7 修复验证：分派色（浅 ${TAB_INACTIVE_LIGHT_V} / 深 ${TAB_INACTIVE_DARK_V}）在 glassOpacity 全域达 ${AA_NORMAL}:1，且深色保底必要`,
    pass,
    `浅色全域[0,${TINT_ALPHA_CAP}]：${lightOk ? '达标' : '不达标'}；` +
      `深色[保底${DARK_OVERLAY_FLOOR},${TINT_ALPHA_CAP}]：${darkOk ? '达标' : '不达标'}；` +
      `无保底时深色：${darkNeedsFloor ? '确实无解（保底暗化必要）' : '竟可达标（保底可撤销）'}`,
  )
}

// ---------------------------------------------------------------- 汇总

const failed = results.filter((r) => !r.pass)
console.log(`\n===== ${results.length - failed.length}/${results.length} 项通过 =====`)
if (failed.length > 0) {
  console.log('未通过（属预期体检项，不一定是回归）：')
  for (const f of failed) console.log(`  - ${f.name}`)
}
// 断言 1~4 是设计不变量，必须通过；断言 5~7 是现状体检，允许失败但必须被看到
const INVARIANT_PREFIXES = ['断言1', '断言2', '断言3', '断言4']
const invariantFailed = failed.filter((f) =>
  INVARIANT_PREFIXES.some((p) => f.name.startsWith(p)))
if (invariantFailed.length > 0) {
  console.error(`\n设计不变量被破坏 ${invariantFailed.length} 项，退出码 1`)
  process.exit(1)
}
