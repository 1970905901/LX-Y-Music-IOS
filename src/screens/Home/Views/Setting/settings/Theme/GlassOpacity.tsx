// screens/Home/Views/Setting/settings/Theme/GlassOpacity.tsx
// 磨砂玻璃（Tab 栏 / 迷你播放条 / 透镜药丸）的染色覆层不透明度。
// 实时生效：原生 LGFrostedGlassView / 透镜药丸的覆层 alpha 由该设置驱动。

import { memo, useCallback, useState } from 'react'
import { View } from 'react-native'
import SubTitle from '../../components/SubTitle'
import Slider, { type SliderProps } from '../../components/Slider'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const glassOpacity = useSettingValue('theme.glassOpacity')
  const theme = useTheme()
  const [sliderSize, setSliderSize] = useState(glassOpacity)
  const [isSliding, setSliding] = useState(false)

  const handleSlidingStart = useCallback<NonNullable<SliderProps['onSlidingStart']>>(() => {
    setSliding(true)
  }, [])

  const handleValueChange = useCallback<NonNullable<SliderProps['onValueChange']>>((value) => {
    setSliderSize(value)
  }, [])

  const handleSlidingComplete = useCallback<NonNullable<SliderProps['onSlidingComplete']>>(
    (value) => {
      setSliding(false)
      if (glassOpacity === value) return
      updateSetting({ 'theme.glassOpacity': value })
    },
    [glassOpacity],
  )

  return (
    <SubTitle title={'玻璃不透明度'}>
      <View style={styles.content}>
        <Text style={{ color: theme['c-primary-font'] }}>
          {isSliding ? sliderSize : glassOpacity}
        </Text>
        <Slider
          minimumValue={0}
          maximumValue={100}
          onSlidingComplete={handleSlidingComplete}
          onValueChange={handleValueChange}
          onSlidingStart={handleSlidingStart}
          step={1}
          value={glassOpacity}
        />
      </View>
    </SubTitle>
  )
})

const styles = createStyle({
  content: {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
  },
})
