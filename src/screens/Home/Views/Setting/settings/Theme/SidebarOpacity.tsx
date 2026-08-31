import { memo, useCallback, useState } from 'react'
import { View } from 'react-native'
import SubTitle from '../../components/SubTitle'
import Slider, { type SliderProps } from '../../components/Slider'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const t = useI18n()
  const sidebarOpacity = useSettingValue('theme.sidebarOpacity')
  const theme = useTheme()
  const [sliderSize, setSliding] = useState(sidebarOpacity)
  const [isSliding, setSlidingState] = useState(false)

  const handleSlidingStart = useCallback<NonNullable<SliderProps['onSlidingStart']>>(() => {
    setSlidingState(true)
  }, [])

  const handleValueChange = useCallback<NonNullable<SliderProps['onValueChange']>>((value) => {
    setSliding(value)
  }, [])

  const handleSlidingComplete = useCallback<NonNullable<SliderProps['onSlidingComplete']>>(
    (value) => {
      setSlidingState(false)
      if (sidebarOpacity === value) return
      updateSetting({ 'theme.sidebarOpacity': value })
    },
    [sidebarOpacity]
  )

  return (
    <SubTitle title={t('setting_basic_theme_sidebar_opacity')}>
      <View style={styles.content}>
        <Text style={{ color: theme['c-primary-font'] }}>
          {isSliding ? sliderSize : sidebarOpacity}%
        </Text>
        <Slider
          minimumValue={0}
          maximumValue={100}
          onSlidingComplete={handleSlidingComplete}
          onValueChange={handleValueChange}
          onSlidingStart={handleSlidingStart}
          step={1}
          value={sidebarOpacity}
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
