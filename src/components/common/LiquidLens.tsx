import { memo, useMemo } from 'react'
import { processColor, requireNativeComponent, type ProcessedColorValue, type ViewProps } from 'react-native'

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
  /** 磨砂染色覆层不透明度 0~1（用户设置 theme.glassOpacity / 100）。 */
  glassOpacity?: number
  /** 药丸宽度，默认 56。 */
  pillWidth?: number
  /** tab 数量：长按拖拽松手时用于把落点位置换算成 tab 序号。 */
  tabCount?: number
  /** 主题染色（rgba 字符串）：透镜玻璃与底部栏玻璃同色（防止深色内容上闪黑）。 */
  tint?: string
  /** 长按拖拽松手事件：落点所在 tab 序号。JS 收到后切换对应页面。 */
  onDragSelect?: (event: { nativeEvent: { index: number } }) => void
}

/**
 * 原生组件视角的 props：原生侧的 `tint` 收到的是经 `processColor` 预处理后的色值
 * （number 或 OpaqueColorValue），而非 JS 侧的 rgba 字符串，故单独覆写该字段类型。
 */
type LiquidLensNativeProps = Omit<LiquidLensProps, 'tint'> & { tint?: ProcessedColorValue }

const NativeLiquidLens = requireNativeComponent<LiquidLensNativeProps>('LiquidGlassLens')

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
const LiquidLens = memo(({ x, lifted = false, glassOpacity = 0.4, pillWidth, tabCount, tint, onDragSelect, style }: LiquidLensProps) => {
  // 原生 RCTConvert UIColor: 只认 processColor 预处理后的数值（rgb() 字符串会静默
  // 转成 nil），与 LiquidGlass 同因同修
  const nativeTint = useMemo(
    () => (tint != null ? processColor(tint) ?? undefined : undefined),
    [tint],
  )
  return (
    <NativeLiquidLens
      style={style}
      x={x}
      lifted={lifted}
      glassOpacity={glassOpacity}
      pillWidth={pillWidth}
      tabCount={tabCount}
      tint={nativeTint}
      onDragSelect={onDragSelect}
      pointerEvents="none"
    />
  )
})

export default LiquidLens
