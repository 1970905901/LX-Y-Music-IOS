import { memo, useMemo } from 'react'
import { requireNativeComponent, StyleSheet, type StyleProp, type ViewProps, type ViewStyle } from 'react-native'
import { useLiquidGlassActive } from '@/utils/liquidGlassActivity'

type LiquidGlassProps = ViewProps & {
  /**
   * 连续渲染帧率上限（MTKView preferredFramesPerSecond）。默认 30：脉冲/挂载活跃
   * 期间逐帧整窗捕获（drawHierarchy + 同步模糊）开销极高，30fps 减半且磨砂折射
   * 内容观感无差异；需要更顺滑的个别场景可显式传更高值。
   */
  fps?: number
  /**
   * 渲染活跃开关（省电核心）：静止时原生渲染时钟停止；滚动/拖拽期间玻璃冻结在
   * 最后一帧（原生手势观察），滚动停止后自动补一帧；挂载后自带约 1s 活跃窗，
   * 无触摸的内容变化由 pulseLiquidGlass() 脉冲驱动。
   */
  active?: boolean
  /**
   * 主题染色（rgba 字符串）：玻璃材质色跟随 App 主题（如绿主题 → 淡绿磨砂玻璃）。
   * 不传时走玻璃默认材质色（浅色蓝白 / 深色近黑的动态色）。
   */
  tint?: string
}

const NativeLiquidGlass = requireNativeComponent<LiquidGlassProps>('LiquidGlassView')

/**
 * 液态玻璃背景层（vendored LiquidGlassKit：iOS 26+ 用系统原生 UIGlassEffect(.regular)，
 * iOS 13-25 用 MTKView + Metal 着色器自研折射）。磨砂液态玻璃：染色 + 背景微模糊 +
 * 折射 + 边缘光，透出背后内容的轮廓。
 *
 * 用法：作为容器的第一个子元素渲染，默认绝对定位铺满父容器；
 * 父容器需设置 `borderRadius` + `overflow: 'hidden'` 裁出圆角玻璃形状，
 * 内容子元素渲染在其上层。原生的 userInteractionEnabled 已关闭，触摸全部穿透。
 *
 * 省电机制（自研路径）：静止时原生渲染时钟停止（保留最后一帧）；滚动/拖拽期间
 * 玻璃冻结在最后一帧、停止后原生自动补一帧（滚动中逐帧整窗捕获是列表掉帧与
 * 玻璃边缘黑影的根源，已移除）；挂载后自带约 1s 活跃窗；无触摸的内容变化
 * （切 Tab、换主题、换歌）由业务代码调用 pulseLiquidGlass()（@/utils/liquidGlassActivity）恢复。
 * iOS 26 原生路径由系统合成，本身零逐帧开销。
 */
const LiquidGlass = memo(({ fps = 30, tint, style }: LiquidGlassProps) => {
  const active = useLiquidGlassActive()
  const glassStyle = useMemo<StyleProp<ViewStyle>>(
    () => StyleSheet.compose(StyleSheet.absoluteFill, style),
    [style],
  )
  return <NativeLiquidGlass style={glassStyle} fps={fps} active={active} tint={tint} pointerEvents="none" />
})

export default LiquidGlass
