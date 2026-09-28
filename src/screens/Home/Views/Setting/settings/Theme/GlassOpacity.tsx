// screens/Home/Views/Setting/settings/Theme/GlassOpacity.tsx
// 玻璃（Tab 栏 / 迷你播放条 / 收起圆钮）的**染色覆层**浓度，不是材质浓度。
// 实时生效：值经原生 LGFrostedGlassView 传给覆层 alpha，并乘 maxTintAlpha(0.6) 封顶
// （见 LGGlassViewFactory.swift）。底下的材质由系统按 OS 提供，不随本设置变化 ——
// 所以拉到 100 也只是染色最浓，不会变成实色块、不会盖掉材质。
// TODO: title 目前是硬编码中文，与 SubContainerOpacity 的 t(...) 写法不一致，待统一。

import { memo } from 'react'

import SliderRow from '../../components/SliderRow'
import { useSettingValue } from '@/store/setting/hook'

export default memo(() => {
  const glassOpacity = useSettingValue('theme.glassOpacity')

  return <SliderRow settingKey="theme.glassOpacity" title={'玻璃不透明度'} value={glassOpacity} />
})
