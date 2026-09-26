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
 * 液态玻璃背景层（原生 vendored LiquidGlassKit，MTKView + Metal 着色器实时折射）。
 *
 * 用法：作为容器的第一个子元素渲染，默认绝对定位铺满父容器；
 * 父容器需设置 `borderRadius` + `overflow: 'hidden'` 裁出圆角玻璃形状，
 * 内容子元素渲染在其上层。原生的 userInteractionEnabled 已关闭，触摸全部穿透。
 *
 * 省电机制：静止时原生渲染时钟停止（保留最后一帧）；滚动/拖拽由原生窗口手势观察
 * 自动恢复，挂载后自带约 1s 活跃窗；无触摸的内容变化（切 Tab、换主题、换歌）由业务
 * 代码调用 pulseLiquidGlass()（@/utils/liquidGlassActivity）恢复。
 *
 * 原生组件由 `ios/Vendor/LiquidGlassKit` 提供（RCT_EXPORT_MODULE 注册名 LiquidGlassView），
 * 需要 `pod install` 后重新编译原生包；仅跑旧包 + 新 JS 时本组件会渲染失败（红屏提示
 * 找不到原生组件），属预期行为——重新构建原生即可。
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
