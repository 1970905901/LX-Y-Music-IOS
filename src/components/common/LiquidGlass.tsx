import { memo, useMemo } from 'react'
import { requireNativeComponent, StyleSheet, type StyleProp, type ViewProps, type ViewStyle } from 'react-native'

type LiquidGlassProps = ViewProps & {
  /**
   * 染色基色（不透明主题色，明暗自适应由主题本身保证）。
   * 透明度独立由 glassOpacity 控制。
   */
  tint?: string
  /**
   * 染色覆层不透明度 0~1（用户设置 theme.glassOpacity / 100）。纯透明玻璃：
   * 无模糊，仅一层随主题的染色纱。
   */
  glassOpacity?: number
}

const NativeLiquidGlass = requireNativeComponent<LiquidGlassProps>('LiquidGlassView')

/**
 * 纯透明玻璃背景层（原生 LGFrostedGlassView：单层主题染色覆层，无模糊、无捕获）。
 *
 * 液态玻璃与系统磨砂均已下线：纯染色覆层零 GPU/CPU 成本，透明度用户可调，
 * 染色随主题明暗自动切换。
 *
 * 用法：作为容器的第一个子元素渲染，默认绝对定位铺满父容器；
 * 父容器需设置 `borderRadius` + `overflow: 'hidden'` 裁出圆角形状，
 * 内容子元素渲染在其上层。原生的 userInteractionEnabled 已关闭，触摸全部穿透。
 */
const LiquidGlass = memo(({ tint, glassOpacity = 0.4, style }: LiquidGlassProps) => {
  const glassStyle = useMemo(
    () => StyleSheet.compose(StyleSheet.absoluteFill, style),
    [style],
  )
  return <NativeLiquidGlass style={glassStyle} glassOpacity={glassOpacity} tint={tint} pointerEvents="none" />
})

export default LiquidGlass
