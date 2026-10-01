// screens/Home/Views/Setting/settings/Theme/TabBarDistance.tsx
//
// 「Tab 栏距离」（0~100）：首页展开态迷你播放器与底部 Tab 栏之间的间距。
// 100 = 当前间距（手机 12pt / iPad 横屏 8pt），0 = 播放器贴在 Tab 栏上。
// 该间距是固定 token（与字体大小设置无关），滑杆只在 0~当前值之间缩放它，
// 消费点见 components/player/PlayerBar 的 bottomExpanded 计算。

import { memo } from 'react'

import SliderRow from '../../components/SliderRow'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'

export default memo(() => {
  const t = useI18n()
  const tabBarDistance = useSettingValue('theme.tabBarDistance')

  return (
    <SliderRow
      settingKey="theme.tabBarDistance"
      title={t('setting_basic_theme_tab_bar_distance')}
      desc={t('setting_basic_theme_tab_bar_distance_desc')}
      value={tabBarDistance}
    />
  )
})
