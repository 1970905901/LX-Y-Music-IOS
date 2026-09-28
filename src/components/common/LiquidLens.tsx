import { memo, useMemo } from 'react'
import { processColor, requireNativeComponent, type ProcessedColorValue, type ViewProps } from 'react-native'

type LiquidLensProps = ViewProps & {
  /**
   * 药丸目标中心 X（相对本组件左上角）。首次设置直接落位，之后由原生
   * UIView 弹簧动画滑动过去；滑动期间药丸自带加速度挤压/拉伸变形。
   */
  x: number
  /**
   * 按下态：true 时药丸 morph 成完整液态玻璃（LiquidGlassView(.lens)，
   * Metal 折射 + 边缘光，与底部栏玻璃同源）。点击切换的抬落由原生
   * setTargetX 内部驱动，一般无需从 JS 传此 prop。
   */
  lifted?: boolean
  /**
   * 仅磨砂代餐时代有意义（液态形态无对应参数，原生为空操作）。保留 prop
   * 维持调用面兼容；底部栏玻璃的浓度由 LiquidGlass 的 glassOpacity 表达。
   */
  glassOpacity?: number
  /** 药丸宽度，默认 56。 */
  pillWidth?: number
  /**
   * 静止药丸底色（rgba 字符串）。**本应用不传**——走原生默认白 30%（上游
   * resting 药丸默认色，随透镜常显在选中 tab 上）；若真机上深浅主题观感
   * 需要分化，可按主题明暗传不同中性色。
   */
  pillColor?: string
  /**
   * 玻璃染色（rgba 字符串）。**本应用不传**（纯玻璃定案）——不传时用
   * .lens 预设的玻璃动态色。
   */
  tint?: string
}

/**
 * 原生组件视角的 props：原生侧的 `tint` 收到的是经 `processColor` 预处理后的色值
 * （number 或 OpaqueColorValue），而非 JS 侧的 rgba 字符串，故单独覆写该字段类型。
 */
type LiquidLensNativeProps = Omit<LiquidLensProps, 'tint'> & { tint?: ProcessedColorValue }

const NativeLiquidLens = requireNativeComponent<LiquidLensNativeProps>('LiquidGlassLens')

/**
 * 液态玻璃透镜药丸（原生 vendored LiquidLensView，复刻 iOS 26 TabBar 的
 * _UILiquidLensView）：静止态半透明白色药丸常显在选中 tab 上（上游 resting
 * 状态）；tab 切换时抬起 morph 成完整液态玻璃（LiquidGlassView(.lens) 液态
 * 引擎）并弹簧滑动，伴随加速度挤压/拉伸变形，落定回落静止药丸。全版本恒用
 * 自研透镜（上游亦为自研复刻，不调用系统私有类）。
 *
 * 切页交互只有快速点击（上层 tab Pressable → JS 切页 → x 更新）。长按/横滑
 * 拖拽切页已整体移除（上游 LiquidGlassKit 无此手势层，2026-09-29 定案）。
 *
 * 用法：绝对定位成一条与药丸等高的横向条带（宽度=容器宽），置于玻璃背景
 * 之上、tab 内容之下；通过 `x` 指定目标中心。原生的 userInteractionEnabled
 * 已关闭，触摸全部穿透。
 */
const LiquidLens = memo(({ x, lifted = false, glassOpacity = 0.4, pillColor, pillWidth, tint, style }: LiquidLensProps) => {
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
      pillColor={pillColor}
      pillWidth={pillWidth}
      tint={nativeTint}
      pointerEvents="none"
    />
  )
})

export default LiquidLens
