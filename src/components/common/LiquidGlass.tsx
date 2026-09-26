import { memo, useMemo } from 'react'
import { requireNativeComponent, StyleSheet, type StyleProp, type ViewProps, type ViewStyle } from 'react-native'
import { useLiquidGlassActive } from '@/utils/liquidGlassActivity'

type LiquidGlassProps = ViewProps & {
  /**
   * 连续渲染帧率上限（MTKView preferredFramesPerSecond）。
   * 玻璃活跃期（滚动/转场/内容变化）每帧都要捕获背后内容做折射，30 已足够平滑。
   */
  fps?: number
  /**
   * 渲染活跃开关（省电核心）：静止时原生渲染时钟停止；滚动/拖拽由原生手势观察自动
   * 恢复，挂载后自带约 1s 活跃窗，无触摸的内容变化由 pulseLiquidGlass() 脉冲驱动。
   */
  active?: boolean
}

const NativeLiquidGlass = requireNativeComponent<LiquidGlassProps>('LiquidGlassView')

/**
 * 液态玻璃背景层（vendored LiquidGlassKit：iOS 26+ 用系统原生 UIGlassEffect(.clear)，
 * iOS 13-25 用 MTKView + Metal 着色器自研折射）。纯透明玻璃：透背景、不随主题变化。
 *
 * 用法：作为容器的第一个子元素渲染，默认绝对定位铺满父容器；
 * 父容器需设置 `borderRadius` + `overflow: 'hidden'` 裁出圆角玻璃形状，
 * 内容子元素渲染在其上层。原生的 userInteractionEnabled 已关闭，触摸全部穿透。
 *
 * 省电机制（自研路径）：静止时原生渲染时钟停止（保留最后一帧）；滚动/拖拽由原生
 * 窗口手势观察自动恢复，挂载后自带约 1s 活跃窗；无触摸的内容变化（切 Tab、换主题、
 * 换歌）由业务代码调用 pulseLiquidGlass()（@/utils/liquidGlassActivity）恢复。
 * iOS 26 原生路径由系统合成，本身零逐帧开销。
 */
const LiquidGlass = memo(({ fps = 30, style }: LiquidGlassProps) => {
  const active = useLiquidGlassActive()
  const glassStyle = useMemo<StyleProp<ViewStyle>>(
    () => StyleSheet.compose(StyleSheet.absoluteFill, style),
    [style],
  )
  return <NativeLiquidGlass style={glassStyle} fps={fps} active={active} pointerEvents="none" />
})

export default LiquidGlass
