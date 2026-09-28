import { memo, useMemo } from 'react'

import Slider, { type SliderProps } from '@react-native-community/slider'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { designRadius } from '@/theme/DesignTokens'

export type { SliderProps }

export default memo(
  ({
    value,
    minimumValue,
    maximumValue,
    onSlidingStart,
    onSlidingComplete,
    onValueChange,
    step,
  }: SliderProps) => {
    const theme = useTheme()

    // 与设置页其它行统一（对齐推荐页「排行榜」按钮的视觉语言）
    const cardStyle = useMemo(() => ({
      borderRadius: designRadius.md,
      borderWidth: 1,
      backgroundColor: theme['c-primary-light-900-alpha-200'],
      borderColor: theme['c-border-background'],
    }), [theme])

    return (
      <Slider
        value={value}
        style={[styles.slider, cardStyle]}
        minimumValue={minimumValue}
        maximumValue={maximumValue}
        minimumTrackTintColor={theme['c-button-background-active']}
        maximumTrackTintColor={theme['c-button-background']}
        thumbTintColor={theme['c-primary-light-100']}
        onSlidingStart={onSlidingStart}
        onSlidingComplete={onSlidingComplete}
        onValueChange={onValueChange}
        step={step}
      />
    )
  },
)

const styles = createStyle({
  slider: {
    // 行内布局：左侧是宽度固定的数值区（SliderRow 的 34pt + 8pt 间距 = 42pt），
    // 滑块占据剩余的全部宽度。
    //
    // ⚠️ 必须允许收缩（flexShrink: 1）。原先写的是 flexShrink: 0，滑块会拒绝收窄：
    // 它的 flexBasis 被 maxWidth 钳住，于是「数值区 + 滑块」按 42 + 320 = 362pt 撑开，
    // 而 390pt 屏的内容区只有 390 - 32×2 = 326pt、扣掉数值区仅剩 284pt —— 整行因此
    // 向右溢出。截图实测（1170×2532px = 390×844pt @3x）：轨道右端 380.3pt，而内容区
    // 右边界只有 358pt；按 maxWidth + 左右边框推得滑块容器右端约 396pt，已越过 390pt
    // 的屏幕右边界。视觉上就是「这几个调节没有居中 / 右侧几乎不留白 /
    // 与上方卡片的右边缘对不齐」。
    flexGrow: 1,
    flexShrink: 1,
    // 不再限死最大宽度：设置页其它控件（各种卡片）都是撑满内容区的，滑块限宽
    // 会在大屏（iPad 横屏内容区可达 ~936pt）缩在左侧、右侧留出一大片空白。
    height: 40,
    marginTop: -2,
  },
})
