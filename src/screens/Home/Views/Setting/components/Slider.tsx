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
    flexShrink: 0,
    flexGrow: 1,
    // width: '100%',
    maxWidth: 320,
    height: 40,
    marginTop: -2,
  },
})
