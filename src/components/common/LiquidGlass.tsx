import { memo, useMemo } from 'react'
import { processColor, requireNativeComponent, StyleSheet, type ProcessedColorValue, type ViewProps } from 'react-native'

type LiquidGlassProps = ViewProps & {
  /**
   * 染色基色（不透明主题色，明暗自适应由主题本身保证）。
   * 透明度独立由 glassOpacity 控制。传 rgb()/rgba() 字符串，组件内部会过一次 processColor。
   */
  tint?: string
  /**
   * 染色覆层的**用户值** 0~1（对应设置 theme.glassOpacity / 100）。
   * 原生侧会再乘 maxTintAlpha(0.6) 封顶，故 1 表示「染色拉满」，
   * 不会把底下的系统材质盖住（见 LGGlassViewFactory.swift）。
   */
  glassOpacity?: number
  /**
   * App 主题是否为深色（传 `theme.isDark`）。**必须传**：
   * 系统材质（UIBlurEffect / UIGlassEffect）是动态材质、按系统的 userInterfaceStyle 解析明暗，
   * 而本项目没有在 window 层统一明暗，App 主题可与系统不一致 ——
   * 不传就会在「App 深色 + 系统浅色」时渲染出一层亮色磨砂（反之亦然）。
   */
  dark?: boolean
}

/**
 * 原生组件视角的 props：原生侧的 `tint` 收到的**不是** JS 侧的 rgb()/rgba() 字符串，
 * 而是经 `processColor` 预处理后的色值（number 或 OpaqueColorValue），故单独覆写该字段类型，
 * 不再复用外层「给 JS 调用方看的 `tint?: string`」。
 */
type LiquidGlassNativeProps = Omit<LiquidGlassProps, 'tint'> & { tint?: ProcessedColorValue }

const NativeLiquidGlass = requireNativeComponent<LiquidGlassNativeProps>('LiquidGlassView')

/**
 * 玻璃背景层（原生 LGFrostedGlassView：**该系统自己的材质** + 有上限的主题染色覆层）。
 *
 * 材质不自己画，一律交给系统 —— 什么版本用什么版本的系统材质：
 *   - iOS 26+（且用 Xcode 26 编译）：UIGlassEffect(.regular)，即官方 Liquid Glass；
 *   - 其余系统：UIBlurEffect(.systemMaterial)。
 * 两者都是系统合成，无逐帧整窗捕获、无 CPU 逐帧成本。因此**不要**假设两个版本带
 * 观感一致：同一个系统材质在 iOS 14~18 与 iOS 26 上本就长得不一样，这是设计意图
 * （HIG「一致性即信任」：系统控件什么样，我们就什么样）。
 *
 * 材质档位取 regular 而非最薄的 ultraThin：HIG 对 regular 的描述是「模糊并调整背景
 * 亮度，保文字可读」，也正是浮在专辑图上的导航层需要的；ultraThin 对比度最差，
 * HIG 明确不推荐在其上放低对比内容。量化见 scripts/sim-glass-contrast.js。
 *
 * 用法：作为容器的第一个子元素渲染，默认绝对定位铺满父容器；
 * 父容器需设置 `borderRadius` + `overflow: 'hidden'` 裁出圆角形状，
 * 内容子元素渲染在其上层。原生的 userInteractionEnabled 已关闭，触摸全部穿透。
 */
const LiquidGlass = memo(({ tint, glassOpacity = 0.4, dark = false, style }: LiquidGlassProps) => {
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
      tint={nativeTint}
      pointerEvents="none"
    />
  )
})

export default LiquidGlass
