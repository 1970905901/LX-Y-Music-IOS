/**
 * 设置页「数值 + 滑块」行（Setting/components/SliderRow.tsx + Slider.tsx）宽度模型。
 *
 * 现象（用户反馈）：「主题设置」里的背景模糊度 / 背景图片不透明度 / 玻璃不透明度 /
 * 容器背景不透明度 这 4 个调节没有居中 —— 滑块横条右端几乎贴住屏幕右侧，
 * 与上方卡片的右边缘对不齐。
 *
 * 布局规则（与 RN/Yoga 一致）：
 *   ScrollView.contentContainerStyle.paddingHorizontal = 32（designSpacing.xl）
 *   SubTitle.container (column, alignItems 默认 stretch)
 *   └─ SliderRow.content (flexDirection:row, width:'100%')
 *      ├─ Text 数值区  width:34 + textAlign:right + marginRight:8 = 42pt（固定）
 *      └─ Slider       flexGrow:1, flexShrink:?, maxWidth:?
 *
 *   行可用宽度 available = 屏宽 - 2*32
 *   滑块应得宽度      = available - 42
 *
 * 关键：Slider 的 flexBasis 会被 maxWidth 钳住（≈320pt）；若同时 flexShrink:0，
 *       滑块拒绝收窄 —— 整行按 42 + 320 撑开并向右溢出内容区。
 *       flexShrink:1 后滑块才会收窄到「剩余空间」，右端与上方卡片对齐。
 *
 * 运行：node scripts/sim-setting-slider-width.js
 */

// ---- 基准数据：从用户截图（1170x2532 px = 390x844 pt @3x）实测 ----
const PX_PER_PT = 3
const SHOT = {
  device: 'iPhone 12/13/14 (390x844pt)',
  screenW: 1170 / PX_PER_PT, // 390pt
  frame: [103 / PX_PER_PT, 1071 / PX_PER_PT], // 卡片（CheckBoxItem）左右边界 = 内容区
  // 4 个滑块圆点中心的横向位置（px → pt），由深灰实心圆像素聚类得到
  thumbs: [
    { value: 0, x: 274 / PX_PER_PT }, // 91.33pt
    { value: 3, x: 301 / PX_PER_PT }, // 100.33pt
    { value: 51, x: 715 / PX_PER_PT }, // 238.33pt
    { value: 91, x: 1063 / PX_PER_PT }, // 354.33pt
  ],
  railRight: 1141 / PX_PER_PT, // 由圆点线性反推的轨道右端 = 380.33pt
}

// ---- 样式常量（与源码一一对应） ----
const CONTENT_PADDING_H = 32 // SettingDetail/index.tsx contentStyle.paddingHorizontal
const VALUE_W = 34 // SliderRow styles.value.width
const VALUE_MARGIN_R = 8 // SliderRow styles.value.marginRight
const VALUE_BLOCK = VALUE_W + VALUE_MARGIN_R // 42
const SLIDER_MAX_WIDTH = 320 // Slider styles.slider.maxWidth（旧值，现已移除）
const SLIDER_BORDER = 1 // Slider styles.slider.borderWidth → 左右各 1pt
// UISlider 轨道相对容器左右的内缩（由截图反推：轨道左 91.3 - 容器左 74 ≈ 17pt）
const RAIL_INSET_FROM_SHOT = 17.3

const contentW = (screenW) => screenW - CONTENT_PADDING_H * 2
const sliderLeft = () => CONTENT_PADDING_H + VALUE_BLOCK

/**
 * 计算滑块布局结果。
 * @param {'old'|'new'} mode
 *   old = flexShrink:0 + maxWidth:320
 *   new = flexShrink:1、不设 maxWidth
 */
const layout = (screenW, mode) => {
  const avail = contentW(screenW)
  const left = sliderLeft()
  // 旧方案：flexShrink:0 拒绝收窄 —— 空间充裕时被 maxWidth 顶住，空间不足时
  // 仍然要 maxWidth（只能溢出）。两种情形都是同一个宽度，故直接取 maxWidth。
  // 新方案：flexShrink:1 —— 收窄到剩余空间（=available-42）以内；已移除 maxWidth，
  // 空间充裕时直接撑满，与设置页其它卡片控件保持一致的右边界。
  const sliderW = mode === 'old'
    ? SLIDER_MAX_WIDTH + SLIDER_BORDER * 2
    : avail - VALUE_BLOCK
  const right = left + sliderW
  const frameRight = screenW - CONTENT_PADDING_H
  return {
    avail,
    sliderW,
    left,
    right,
    frameRight,
    overflow: right > frameRight + 0.5,
    overflowPt: Math.max(0, right - frameRight),
    rail: [left + RAIL_INSET_FROM_SHOT, right - RAIL_INSET_FROM_SHOT],
  }
}

const round = (n, d = 1) => Number(n.toFixed(d))

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}${detail ? `  (${detail})` : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${detail ? `  (${detail})` : ''}`)
  }
}

console.log('='.repeat(74))
console.log('设置页「数值 + 滑块」行宽度模型回归')
console.log(`基准设备：${SHOT.device}，内容区 ${SHOT.frame[0].toFixed(1)}~${SHOT.frame[1].toFixed(1)}pt`)
console.log('='.repeat(74))

// ---- 第 1 节：用截图实测校验模型（回归基准） ----
console.log('\n[1] 截图实测 → 反推旧方案（flexShrink:0）的实际几何')
{
  const x0 = SHOT.thumbs.find((t) => t.value === 0).x
  const x91 = SHOT.thumbs.find((t) => t.value === 91).x
  const railSpan = (x91 - x0) / 0.91 // 值 0 在 0%、值 91 在 91%
  console.log(`  由 4 个圆点反推轨道：${round(x0)}~${round(SHOT.railRight)}pt（宽 ${round(railSpan)}pt）`)
  for (const t of SHOT.thumbs) {
    const predicted = x0 + (t.value / 100) * railSpan
    console.log(`    值 ${String(t.value).padStart(3)}：预测 ${round(predicted).toString().padStart(6)}pt / 实测 ${round(t.x).toString().padStart(6)}pt`)
  }
  const worst = Math.max(...SHOT.thumbs.map((t) => Math.abs(x0 + (t.value / 100) * railSpan - t.x)))
  check('圆点位置线性吻合（线性滑块，模型可用）', worst < 1.5, `最大误差 ${round(worst, 2)}pt`)

  const oldL = layout(SHOT.screenW, 'old')
  console.log(`  旧方案：滑块 ${round(oldL.left)}~${round(oldL.right)}pt，宽 ${round(oldL.sliderW)}pt`)
  console.log(`  内容区右界 ${round(oldL.frameRight)}pt，屏幕右界 ${SHOT.screenW}pt`)
  check('可用空间装不下 maxWidth 的滑块', oldL.avail - VALUE_BLOCK < SLIDER_MAX_WIDTH,
    `可用 ${round(oldL.avail - VALUE_BLOCK)}pt < maxWidth ${SLIDER_MAX_WIDTH}pt`)
  check('旧方案确实溢出内容区', oldL.overflow, `溢出 ${round(oldL.overflowPt)}pt`)
  check('旧方案右端顶住屏幕边缘', oldL.right >= SHOT.screenW - 6,
    `right=${round(oldL.right)} / screen=${SHOT.screenW}`)
  check('模型算出的轨道右端与截图实测一致（±3pt）',
    Math.abs(oldL.rail[1] - SHOT.railRight) < 3,
    `模型 ${round(oldL.rail[1])} / 实测 ${round(SHOT.railRight)}`)
}

// ---- 第 2 节：新方案的几何 ----
console.log('\n[2] 新方案（flexShrink:1、不设 maxWidth）')
{
  const nw = layout(SHOT.screenW, 'new')
  console.log(`  数值区 ${VALUE_BLOCK}pt + 滑块 ${round(nw.sliderW)}pt = ${round(VALUE_BLOCK + nw.sliderW)}pt`)
  console.log(`  滑块 ${round(nw.left)}~${round(nw.right)}pt，内容区 ${CONTENT_PADDING_H}~${round(nw.frameRight)}pt`)
  check('不再溢出', !nw.overflow)
  check('滑块右端与内容区右边界对齐（±1pt）', Math.abs(nw.right - nw.frameRight) <= 1,
    `right=${round(nw.right)} / frame=${round(nw.frameRight)}`)
  check('与上方卡片右边缘一致（±2pt）', Math.abs(nw.right - SHOT.frame[1]) <= 2,
    `滑块 ${round(nw.right)} / 卡片 ${round(SHOT.frame[1])}`)
  check('右侧不再有多余留白（行的右端 = 内容区右界）', Math.abs(nw.frameRight - nw.right) <= 1)
  check('滑块宽度明显大于数值区（视觉合理）', nw.sliderW > VALUE_BLOCK * 2.5, `w=${round(nw.sliderW)}`)
  check('相对旧方案收窄（不再是 maxWidth 撑开的溢出宽）', nw.sliderW < layout(SHOT.screenW, 'old').sliderW,
    `${round(nw.sliderW)} < ${round(layout(SHOT.screenW, 'old').sliderW)}`)
}

// ---- 第 3 节：多屏宽遍历（含小屏与 iPad 横屏） ----
console.log('\n[3] 多屏宽遍历')
{
  const screens = [
    { name: 'iPhone SE (320pt)', w: 320 },
    { name: 'iPhone SE2/8 (375pt)', w: 375 },
    { name: 'iPhone 12/13/14 (390pt)', w: 390 },
    { name: 'iPhone Pro Max (430pt)', w: 430 },
    { name: 'iPad 竖屏 (768pt)', w: 768 },
    { name: 'iPad 横屏限宽 (1000pt)', w: 1000 },
  ]
  console.log('  屏宽                         可用   滑块宽   右端   内容区右界   旧方案')
  for (const s of screens) {
    const nw = layout(s.w, 'new')
    const ow = layout(s.w, 'old')
    console.log(
      `  ${s.name.padEnd(28)} ${round(nw.avail).toString().padStart(4)}  ${round(nw.sliderW).toString().padStart(6)}  ${round(nw.right).toString().padStart(6)}  ${round(nw.frameRight).toString().padStart(9)}   ${ow.overflow ? `溢出 ${round(ow.overflowPt)}pt` : '正常'}`,
    )
    check(`${s.name}：不溢出且右端对齐`, !nw.overflow && Math.abs(nw.right - nw.frameRight) <= 1)
    check(`${s.name}：滑块有可用宽度（>=120pt）`, nw.sliderW >= 120, `w=${round(nw.sliderW)}`)
  }
}

// ---- 第 4 节：拖动时的稳定性 ----
console.log('\n[4] 拖动时滑块的稳定性')
{
  const nw = layout(390, 'new')
  check('滑块左端固定（由固定宽度的数值区决定）',
    Math.abs(nw.left - (CONTENT_PADDING_H + VALUE_BLOCK)) < 0.001, `left=${round(nw.left)}`)
  check('数值区宽度固定为 34pt（1~3 位数字均不推挤滑块）', VALUE_W === 34)
  // 数值区必须容纳最长数值 "100"（tabular-nums 下 3 位数字约 20pt），
  // 否则拖动到 100 时数字会被裁切或换行、反过来撑动整行。
  const digitsW = 3 * 6.6
  check('数值区 34pt 足以容纳 "100" 而不裁切', VALUE_W >= digitsW, `需 ${round(digitsW)}pt / 有 ${VALUE_W}pt`)
}

console.log('\n' + '='.repeat(74))
console.log(`结果：${pass} 通过 / ${fail} 失败`)
console.log('='.repeat(74))
process.exit(fail ? 1 : 0)
