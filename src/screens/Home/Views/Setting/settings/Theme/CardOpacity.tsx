// screens/Home/Views/Setting/settings/Theme/CardOpacity.tsx
//
// 「底边不透明度」：全软件半透明底（排行榜按钮、设置页开关行与操作按钮、首页卡片、
// 歌单卡等）的浓淡。这些底统一取自主题色令牌 c-primary-light-900-alpha-200，
// 因此改值后必须重新生成主题色板并广播（refreshActiveTheme），否则当前页不会变。
// 0 = 完全透明（只剩描边/文字），80 = 与历史外观一致，100 = 主题色最浓。

import { memo } from 'react'

import SliderRow from '../../components/SliderRow'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { refreshActiveTheme } from '@/core/theme'

export default memo(() => {
  const t = useI18n()
  const cardOpacity = useSettingValue('theme.cardOpacity')

  return (
    <SliderRow
      settingKey="theme.cardOpacity"
      title={t('setting_basic_theme_card_opacity')}
      desc={t('setting_basic_theme_card_opacity_desc')}
      value={cardOpacity}
      onChanged={refreshActiveTheme}
    />
  )
})
