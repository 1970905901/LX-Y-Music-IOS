import { memo, useMemo } from 'react'
import { processColor, requireNativeComponent, StyleSheet, type ProcessedColorValue, type ViewProps } from 'react-native'

import { isIOS26_2OrAbove } from '@/utils/tools'

type LiquidGlassProps = ViewProps & {
  /**
   * 染色基色（不透明主题色，明暗自适应由主题本身保证）。两形态都吃：
   * 磨砂 → 染色覆层基色；液态 → shader materialTint。
   * 透明度独立由 glassOpacity 控制（仅磨砂形态）。
   * 传 rgb()/rgba() 字符串，组件内部会过一次 processColor。
   * **本应用不传**（2026-09-28 定案：玻璃不跟随主题色、纯玻璃）——不传时磨砂走
   * 原生中性覆层色（浅色白/深色黑），液态走 kit 预设动态色（浅色蓝白/深色近黑）。
   */
  tint?: string
  /**
   * 染色覆层的**用户值** 0~1（对应设置 theme.glassOpacity / 100）。
   * 原生侧会再乘 maxTintAlpha(0.6) 封顶，故 1 表示「染色拉满」。
   * 仅磨砂形态生效（液态形态下设置 UI 已隐藏该行）。
   */
  glassOpacity?: number
  /**
   * App 主题是否为深色（传 `theme.isDark`）。**磨砂形态必须传**：
   * 系统材质（UIBlurEffect / UIGlassEffect）是动态材质、按系统的 userInterfaceStyle 解析明暗，
   * 而本项目没有在 window 层统一明暗，App 主题可与系统不一致 ——
   * 不传就会在「App 深色 + 系统浅色」时渲染出一层亮色磨砂（反之亦然）。
   * 液态形态的明暗由主题染色表达，此 prop 不生效（无对应 selector）。
   */
  dark?: boolean
  /**
   * 液态玻璃开关（设置 theme.liquidGlass）：仅 iOS 14~26.1 生效。
   * 开 → vendored Metal 液态玻璃（DnV1eX/LiquidGlassKit 核心效果：折射 + 边缘光；
   * 上游定位即 iOS 13~18 的 backport）；关 → 系统磨砂。
   * 切换时原生整体重建背衬，主题属性由宿主重放。
   * **iOS 26.2+ 恒按 false 处理**（组件内兜底，2026-09-30 定案）：26.2+ 强制
   * 系统磨砂、开关已从设置页隐藏，即使调用方漏门控传入 true 也不会透传到原生
   * （原生 26.2+ 的液态分支 = UIGlassEffect(.regular)，白底/图底切换闪烁）。
   */
  liquid?: boolean
  /**
   * 省电门（2026-09-30）：玻璃组件所在屏幕被压栈页**完全覆盖**时传 true，
   * 原生暂停 Metal 逐帧渲染（MTKView.isPaused）——不可见期间的纯功耗，返回该屏
   * 即恢复、下一帧重捕获背景无残帧。磨砂档（26.2+ / 开关关）原生 no-op。
   * 判定用 useHomeCovered / useScreenCovered（store/common/hook），不要手写。
   */
  paused?: boolean
}

/**
 * 原生组件视角的 props：原生侧的 `tint` 收到的**不是** JS 侧的 rgb()/rgba() 字符串，
 * 而是经 `processColor` 预处理后的色值（number 或 OpaqueColorValue），故单独覆写该字段类型，
 * 不再复用外层「给 JS 调用方看的 `tint?: string`」。
 */
type LiquidGlassNativeProps = Omit<LiquidGlassProps, 'tint'> & { tint?: ProcessedColorValue }

const NativeLiquidGlass = requireNativeComponent<LiquidGlassNativeProps>('LiquidGlassView')

/**
 * 深色模式磨砂覆层的**最终 alpha 保底**（与 scripts/sim-glass-contrast.js 的
 * DARK_OVERLAY_FLOOR 同步）：深色材质基色极暗，但近白封面经材质收敛后仍有 ~0.2
 * 亮度——用户把玻璃不透明度拉到 0 时，深色模式下**不存在任何**文字色能达标
 * AA 4.5:1（亮文字需要背景亮度 ≤ 0.183，0.2 收敛结果做不到）。保底 0.2 暗化把
 * 最坏背景压到 ≤0.16，配合非选中项近白文字（Tab 栏 TAB_INACTIVE_DARK=248）稳定 ≥4.5:1。
 * prop 是用户值域（原生再乘 maxTintAlpha=0.6），故换算 0.2/0.6 ≈ 0.333。
 */
const DARK_OVERLAY_FLOOR_USER = 0.2 / 0.6

/**
 * 玻璃背景层（双形态，liquid prop 切换）：
 *   - 液态（开关开）：vendored LiquidGlassKit 的 Metal 折射玻璃 —— 染色 +
 *     背景微模糊 + 折射 + 边缘光。渲染行为与上游 DnV1eX/LiquidGlassKit 一致：
 *     连续渲染、逐帧捕获、实时折射（无按需渲染/省电层）。
 *   - 磨砂（默认）：系统材质 + 有上限的主题染色覆层 —— iOS 26+ UIGlassEffect(.regular)、
 *     其余 UIBlurEffect(.systemMaterial)。材质不自己画，交给系统；**不要**假设两个
 *     版本带观感一致，这是设计意图（HIG「一致性即信任」）。
 *
 * 用法：作为容器的第一个子元素渲染，默认绝对定位铺满父容器；
 * 父容器需设置 `borderRadius` + `overflow: 'hidden'` 裁出圆角形状，
 * 内容子元素渲染在其上层。原生的 userInteractionEnabled 已关闭，触摸全部穿透。
 */
const LiquidGlass = memo(({ tint, glassOpacity = 0.4, dark = false, liquid = false, paused = false, style }: LiquidGlassProps) => {
  // 26.2+ 强制磨砂兜底（2026-09-30 定案）：UIGlassEffect(.regular) 在白底/图底
  // 页面切换瞬间闪烁，液态玻璃开关已在 26.2+ 从设置页隐藏。业务层已在各消费点
  // 门控（ModernTabBar / PlayerBar），此处兜底保证**任何**调用方漏门控（残留的
  // theme.liquidGlass=true）时，液态 prop 也到不了原生。契约守卫：
  // scripts/sim-glass-dark-contract.js 不变量8（comp-fallback）。
  const effectiveLiquid = liquid && !isIOS26_2OrAbove
  // 深色模式可读性保底：用户值与保底取大（仅磨砂形态的覆层；液态形态 glassOpacity
  // 本就无作用，不受影响）。浅色模式 floor=0，行为不变。
  const effectiveGlassOpacity = useMemo(
    () => (dark ? Math.max(glassOpacity, DARK_OVERLAY_FLOOR_USER) : glassOpacity),
    [dark, glassOpacity],
  )
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
      glassOpacity={effectiveGlassOpacity}
      dark={dark}
      liquid={effectiveLiquid}
      paused={paused}
      tint={nativeTint}
      pointerEvents="none"
    />
  )
})

export default LiquidGlass
