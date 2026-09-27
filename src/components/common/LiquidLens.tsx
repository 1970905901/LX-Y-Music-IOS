import { memo } from 'react'
import { requireNativeComponent, type ViewProps } from 'react-native'

type LiquidLensProps = ViewProps & {
  /**
   * 药丸目标中心 X（相对本组件左上角）。首次设置直接落位，之后由原生
   * UIView 弹簧动画滑动过去；被抬起时药丸自带加速度挤压/拉伸变形。
   */
  x: number
  /**
   * 按下态：true 时药丸 morph 成完整液态玻璃（内部 Metal 渲染仅在此时运行，
   * 静止零开销）。长按拖拽由原生手势直接驱动，一般无需从 JS 传此 prop。
   */
  lifted?: boolean
  /** 静止药丸底色（rgba 字符串）。不传走原生默认（white 0.3）。 */
  pillColor?: string
  /** 药丸宽度，默认 56。 */
  pillWidth?: number
  /** tab 数量：长按拖拽松手时用于把落点位置换算成 tab 序号。 */
  tabCount?: number
  /** 主题染色（rgba 字符串）：透镜玻璃与底部栏玻璃同色（防止深色内容上闪黑）。 */
  tint?: string
  /** 长按拖拽松手事件：落点所在 tab 序号。JS 收到后切换对应页面。 */
  onDragSelect?: (event: { nativeEvent: { index: number } }) => void
}

const NativeLiquidLens = requireNativeComponent<LiquidLensProps>('LiquidGlassLens')

/**
 * 液态玻璃透镜药丸（原生 vendored LiquidLensView，复刻 iOS 26 TabBar 的
 * _UILiquidLensView）：tab 切换时药丸弹性滑动到目标项，按压时 morph 成
 * 完整液态玻璃并伴随加速度挤压/拉伸变形。
 *
 * 长按交互（原生实现）：长按 0.35s 抬起透镜 → 拖动跟手（挤压/拉伸）→
 * 松手时通过 onDragSelect 通知落点 tab；快速点击不受影响。
 *
 * 用法：绝对定位成一条与药丸等高的横向条带（宽度=容器宽），置于玻璃背景
 * 之上、tab 内容之下；通过 `x` 指定目标中心。原生的 userInteractionEnabled
 * 已关闭，触摸全部穿透。
 */
const LiquidLens = memo(({ x, lifted = false, pillColor, pillWidth, tabCount, tint, onDragSelect, style }: LiquidLensProps) => {
  return (
    <NativeLiquidLens
      style={style}
      x={x}
      lifted={lifted}
      pillColor={pillColor}
      pillWidth={pillWidth}
      tabCount={tabCount}
      tint={tint}
      onDragSelect={onDragSelect}
      pointerEvents="none"
    />
  )
})

export default LiquidLens
