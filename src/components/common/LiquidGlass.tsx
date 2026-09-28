import { memo, useMemo } from 'react'
import { processColor, requireNativeComponent, StyleSheet, type ProcessedColorValue, type ViewProps } from 'react-native'

type LiquidGlassProps = ViewProps & {
  /**
   * 染色基色（不透明主题色，明暗自适应由主题本身保证）。两形态都吃：
   * 磨砂 → 染色覆层基色；液态 → shader materialTint。
   * 透明度独立由 glassOpacity 控制（仅磨砂形态）。
   * 传 rgb()/rgba() 字符串，组件内部会过一次 processColor。
   * **本应用不传**（2026-09-28 定案：玻璃不跟随主题色、纯玻璃）——不传时磨砂走
   * 原生中性覆层色（浅色白/深色黑），液态走 kit 预设动态色（浅色蓝白/深色近黑）。
   */
  tint?: string
  /**
   * 染色覆层的**用户值** 0~1（对应设置 theme.glassOpacity / 100）。
   * 原生侧会再乘 maxTintAlpha(0.6) 封顶，故 1 表示「染色拉满」。
   * 仅磨砂形态生效（液态形态下设置 UI 已隐藏该行）。
   */
  glassOpacity?: number
  /**
   * App 主题是否为深色（传 `theme.isDark`）。**磨砂形态必须传**：
   * 系统材质（UIBlurEffect / UIGlassEffect）是动态材质、按系统的 userInterfaceStyle 解析明暗，
   * 而本项目没有在 window 层统一明暗，App 主题可与系统不一致 ——
   * 不传就会在「App 深色 + 系统浅色」时渲染出一层亮色磨砂（反之亦然）。
   * 液态形态的明暗由主题染色表达，此 prop 不生效（无对应 selector）。
   */
  dark?: boolean
  /**
   * 液态玻璃开关（设置 theme.liquidGlass）：全 iOS 版本生效。
   * 开 → vendored Metal 液态玻璃（DnV1eX/LiquidGlassKit 核心效果：折射 + 边缘光；
   * 上游定位即 iOS 13~18 的 backport）；关 → 系统磨砂。
   * 切换时原生整体重建背衬，主题属性由宿主重放。
   */
  liquid?: boolean
}

/**
 * 原生组件视角的 props：原生侧的 `tint` 收到的**不是** JS 侧的 rgb()/rgba() 字符串，
 * 而是经 `processColor` 预处理后的色值（number 或 OpaqueColorValue），故单独覆写该字段类型，
 * 不再复用外层「给 JS 调用方看的 `tint?: string`」。
 */
type LiquidGlassNativeProps = Omit<LiquidGlassProps, 'tint'> & { tint?: ProcessedColorValue }

const NativeLiquidGlass = requireNativeComponent<LiquidGlassNativeProps>('LiquidGlassView')

/**
 * 玻璃背景层（双形态，liquid prop 切换）：
 *   - 液态（开关开）：vendored LiquidGlassKit 的 Metal 折射玻璃 —— 染色 +
 *     背景微模糊 + 折射 + 边缘光。渲染行为与上游 DnV1eX/LiquidGlassKit 一致：
 *     连续渲染、逐帧捕获、实时折射（无按需渲染/省电层）。
 *   - 磨砂（默认）：系统材质 + 有上限的主题染色覆层 —— iOS 26+ UIGlassEffect(.regular)、
 *     其余 UIBlurEffect(.systemMaterial)。材质不自己画，交给系统；**不要**假设两个
 *     版本带观感一致，这是设计意图（HIG「一致性即信任」）。
 *
 * 用法：作为容器的第一个子元素渲染，默认绝对定位铺满父容器；
 * 父容器需设置 `borderRadius` + `overflow: 'hidden'` 裁出圆角形状，
 * 内容子元素渲染在其上层。原生的 userInteractionEnabled 已关闭，触摸全部穿透。
 */
const LiquidGlass = memo(({ tint, glassOpacity = 0.4, dark = false, liquid = false, style }: LiquidGlassProps) => {
  // 原生 RCTConvert UIColor: 只认 processColor 预处理后的数值（rgb()/rgba() 字符串
  // 会被静默转成 nil——染色曾因此从不跟随主题），必须过一次 processColor 再过桥
  const nativeTint = useMemo(
    () => (tint != null ? processColor(tint) ?? undefined : undefined),
    [tint],
  )
  const glassStyle = useMemo(
    () => StyleSheet.compose(StyleSheet.absoluteFill, style),
    [style],
  )
  return (
    <NativeLiquidGlass
      style={glassStyle}
      glassOpacity={glassOpacity}
      dark={dark}
      liquid={liquid}
      tint={nativeTint}
      pointerEvents="none"
    />
  )
})

export default LiquidGlass
