import { memo } from 'react'

import SliderRow from '../../components/SliderRow'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'

export default memo(() => {
  const t = useI18n()
  const subContainerOpacity = useSettingValue('theme.subContainerOpacity')

  return (
    <SliderRow
      settingKey="theme.subContainerOpacity"
      title={t('setting_basic_theme_sub_container_opacity')}
      // 这一项的作用域不直观：效果只出现在「基本设置 → 自定义源」与
      // 「播放设置 → 播放失败策略优先级」两处的列表容器上，主题页里看不到，
      // 且多数主题的主背景色是不透明白色、浅色主题下几乎无视觉差异，
      // 极易被当成「调了没用」。故在行下方直接标注它影响什么。
      desc={t('setting_basic_theme_sub_container_opacity_desc')}
      value={subContainerOpacity}
    />
  )
})
