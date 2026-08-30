import { memo, useCallback, useState } from 'react'
import { View } from 'react-native'
import SubTitle from '../../components/SubTitle'
import Slider, { type SliderProps } from '../../components/Slider'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const miniPlayerOpacity = useSettingValue('theme.miniPlayerOpacity')
  const theme = useTheme()

  const [sliderValue, setSliderValue] = useState(miniPlayerOpacity)
  const [isSliding, setSliding] = useState(false)

  const handleSlidingStart = useCallback<NonNullable<SliderProps['onSlidingStart']>>(() => {
    setSliding(true)
  }, [])

  const handleValueChange = useCallback<NonNullable<SliderProps['onValueChange']>>((value) => {
    setSliderValue(value)
  }, [])

  const handleSlidingComplete = useCallback<NonNullable<SliderProps['onSlidingComplete']>>(
    (value) => {
      setSliding(false)
      if (miniPlayerOpacity === value) return
      updateSetting({ 'theme.miniPlayerOpacity': value })
    },
    [miniPlayerOpacity]
  )

  return (
    <SubTitle title={'迷你播放器不透明度'}>
      <View style={styles.content}>
        <Text style={{ color: theme['c-primary-font'] }}>
          {isSliding ? sliderValue : miniPlayerOpacity}
        </Text>
        <Slider
          minimumValue={0}
          maximumValue={100}
          onSlidingComplete={handleSlidingComplete}
          onValueChange={handleValueChange}
          onSlidingStart={handleSlidingStart}
          step={1}
          value={miniPlayerOpacity}
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
