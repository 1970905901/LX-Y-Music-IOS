// screens/Home/Views/Setting/components/SliderRow.tsx
//
// 设置页「数值 + 滑块」行。原本 4 个主题设置（背景模糊度 / 背景图片不透明度 /
// 玻璃不透明度 / 容器背景不透明度）各自复制了一份完全相同的布局，其中有一个
// 共同缺陷：
//
//   左侧数值 Text 的宽度会随数值位数变化（0 → 9 → 100 位数不同、字宽不同），
//   而 Slider 是 flexGrow:1 —— 数值一变宽，Slider 的可用宽度被压缩，它的圆角
//   容器就会跟着缩窄/左移。用户拖动滑块时数值持续跳动，看到的正是「后面那个
//   圆角容器跟着动」。
//
// 修法：给数值固定一个能容纳最大值的宽度、并右对齐，使该区宽度恒定 ——
// 滑块容器不再随拖动改变尺寸。用 tabular 数字（等宽数字）进一步避免数字
// 逐位跳动。三处（0~100 的整数）最大是 "100"，按时值宽度留够即可。

import { memo, useCallback, useState } from 'react'
import { View } from 'react-native'

import SubTitle from './SubTitle'
import Slider, { type SliderProps } from './Slider'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { createStyle } from '@/utils/tools'
import { updateSetting } from '@/core/common'

interface SliderRowProps {
  /** 该行对应的设置项 key（值必须是 number） */
  settingKey: 'theme.blur' | 'theme.glassOpacity' | 'theme.picOpacity' | 'theme.subContainerOpacity'
  title: string
  value: number
  minimumValue?: number
  maximumValue?: number
  step?: number
}

export default memo(({
  settingKey,
  title,
  value,
  minimumValue = 0,
  maximumValue = 100,
  step = 1,
}: SliderRowProps) => {
  const theme = useTheme()
  const settingValue = useSettingValue(settingKey)
  const [sliderValue, setSliderValue] = useState(settingValue)
  const [isSliding, setSliding] = useState(false)

  const handleSlidingStart = useCallback<NonNullable<SliderProps['onSlidingStart']>>(() => {
    setSliding(true)
  }, [])

  const handleValueChange = useCallback<NonNullable<SliderProps['onValueChange']>>((next) => {
    setSliderValue(next)
  }, [])

  const handleSlidingComplete = useCallback<NonNullable<SliderProps['onSlidingComplete']>>(
    (next) => {
      setSliding(false)
      if (settingValue === next) return
      // updateSetting 的 key 是联合类型，这里按传入的具体 key 收窄
      updateSetting({ [settingKey]: next } as Partial<LX.AppSetting>)
    },
    [settingValue, settingKey],
  )

  return (
    <SubTitle title={title}>
      <View style={styles.content}>
        <Text style={styles.value} color={theme['c-primary-font']}>
          {isSliding ? sliderValue : settingValue}
        </Text>
        <Slider
          minimumValue={minimumValue}
          maximumValue={maximumValue}
          onSlidingComplete={handleSlidingComplete}
          onValueChange={handleValueChange}
          onSlidingStart={handleSlidingStart}
          step={step}
          value={value}
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
  value: {
    // 固定宽度 + 右对齐：数值从 1 位变 3 位时不改变占用宽度，滑块容器因此不再
    // 随拖动伸缩（此前该区宽度随位数变化，把 flexGrow 的滑块挤窄/推左）。
    // 宽度按最大 3 位数（100）预留；用等宽数字避免逐位跳动。
    width: 34,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    marginRight: 8,
  },
})
