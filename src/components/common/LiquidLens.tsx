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
   * 静止零开销）；false 回落为半透明药丸。由 tab 的 onPressIn/onPressOut 驱动。
   */
  lifted?: boolean
  /** 静止药丸底色（rgba 字符串），跟随应用主题明暗。 */
  pillColor?: string
  /** 药丸宽度，默认 56。 */
  pillWidth?: number
}

const NativeLiquidLens = requireNativeComponent<LiquidLensProps>('LiquidGlassLens')

/**
 * 液态玻璃透镜药丸（原生 vendored LiquidLensView，复刻 iOS 26 TabBar 的
 * _UILiquidLensView）：tab 切换时药丸弹性滑动到目标项，按压时 morph 成
 * 完整液态玻璃并伴随加速度挤压/拉伸变形。
 *
 * 用法：绝对定位成一条与药丸等高的横向条带（宽度=容器宽），置于玻璃背景
 * 之上、tab 内容之下；通过 `x` 指定目标中心。原生的 userInteractionEnabled
 * 已关闭，触摸全部穿透。
 */
const LiquidLens = memo(({ x, lifted = false, pillColor, pillWidth, style }: LiquidLensProps) => {
  return (
    <NativeLiquidLens
      style={style}
      x={x}
      lifted={lifted}
      pillColor={pillColor}
      pillWidth={pillWidth}
      pointerEvents="none"
    />
  )
})

export default LiquidLens
