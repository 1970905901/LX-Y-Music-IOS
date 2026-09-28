// screens/Home/Views/Setting/settings/Theme/GlassOpacity.tsx
// 玻璃（Tab 栏 / 迷你播放条 / 收起圆钮）的染色覆层不透明度。
// 实时生效：原生 LGFrostedGlassView 的覆层 alpha 由该设置驱动。

import { memo } from 'react'

import SliderRow from '../../components/SliderRow'
import { useSettingValue } from '@/store/setting/hook'

export default memo(() => {
  const glassOpacity = useSettingValue('theme.glassOpacity')

  return <SliderRow settingKey="theme.glassOpacity" title={'玻璃不透明度'} value={glassOpacity} />
})
