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
import { designSpacing, designTypography } from '@/theme/DesignTokens'

interface SliderRowProps {
  /** 该行对应的设置项 key（值必须是 number） */
  settingKey: 'theme.blur' | 'theme.glassOpacity' | 'theme.picOpacity' | 'theme.subContainerOpacity' | 'theme.cardOpacity' | 'theme.tabBarDistance'
  title: string
  value: number
  /**
   * 行下方的说明小字：讲清「这个值到底改变了什么」。
   * 适用于作用域不直观、或与所在页面对不上的设置项 —— 例如「容器背景不透明度」
   * 效果只出现在音源页/播放页，若只写标题，用户在主题页拖动会以为「调了没用」。
   */
  desc?: string
  minimumValue?: number
  maximumValue?: number
  step?: number
  /**
   * 值写入设置后的回调。用于「改完还需要主动重算」的设置项：
   * 例如底边不透明度走主题色令牌，必须重新生成主题色板并广播才会全局生效。
   */
  onChanged?: () => void
}

export default memo(({
  settingKey,
  title,
  value,
  desc,
  minimumValue = 0,
  maximumValue = 100,
  step = 1,
  onChanged,
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
      onChanged?.()
    },
    [settingValue, settingKey, onChanged],
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
      {desc ? (
        <Text style={styles.desc} color={theme['c-font-label']} size={designTypography.caption}>
          {desc}
        </Text>
      ) : null}
    </SubTitle>
  )
})

const styles = createStyle({
  content: {
    // 明确按内容区宽度铺满，给下面 flexShrink:1 的滑块一个确定的收缩基准。
    // 不写这条时，行的宽度会被滑块自身的内容宽度反向撑开，右侧的 flexShrink
    // 就失去了可收缩的空间（与 Slider.tsx 里 flexShrink 的注释是一对因果）。
    width: '100%',
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
  desc: {
    // 与滑块卡片之间留一点呼吸；用次级文字色，避免抢标题的视觉层级。
    marginTop: designSpacing.xs,
    lineHeight: 16,
  },
})
