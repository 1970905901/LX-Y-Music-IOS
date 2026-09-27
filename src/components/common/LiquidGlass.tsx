import { memo, useMemo } from 'react'
import { requireNativeComponent, StyleSheet, type StyleProp, type ViewProps, type ViewStyle } from 'react-native'

type LiquidGlassProps = ViewProps & {
  /**
   * 磨砂染色基色（不透明主题色，明暗自适应由主题本身保证）。
   * 透明度独立由 glassOpacity 控制。
   */
  tint?: string
  /**
   * 染色覆层不透明度 0~1（用户设置 theme.glassOpacity / 100），控制磨砂玻璃的「实度」。
   */
  glassOpacity?: number
}

const NativeLiquidGlass = requireNativeComponent<LiquidGlassProps>('LiquidGlassView')

/**
 * 高透磨砂玻璃背景层（原生 LGFrostedGlassView：UIBlurEffect(.systemUltraThinMaterial)
 * + 主题染色覆层，Core Animation backdrop 通道 GPU 合成）。
 *
 * 液态玻璃（Metal 逐帧整窗捕获）已下线：实时性与列表主线程开销无法兼得，且材质
 * 透明度不可调。磨砂路径实时、零逐帧 CPU、全 iOS 版本行为一致，不透明度可调。
 *
 * 用法：作为容器的第一个子元素渲染，默认绝对定位铺满父容器；
 * 父容器需设置 `borderRadius` + `overflow: 'hidden'` 裁出圆角玻璃形状，
 * 内容子元素渲染在其上层。原生的 userInteractionEnabled 已关闭，触摸全部穿透。
 */
const LiquidGlass = memo(({ tint, glassOpacity = 0.6, style }: LiquidGlassProps) => {
  const glassStyle = useMemo(
    () => StyleSheet.compose(StyleSheet.absoluteFill, style),
    [style],
  )
  return <NativeLiquidGlass style={glassStyle} glassOpacity={glassOpacity} tint={tint} pointerEvents="none" />
})

export default LiquidGlass
