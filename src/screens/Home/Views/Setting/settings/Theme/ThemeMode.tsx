import { memo } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import { createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { getTheme } from '@/theme/themes'
import { applyTheme } from '@/core/theme'
import themeState from '@/store/theme/state'

// 深色模式三态选择：跟随系统 / 浅色 / 深色。
// 用户反馈「深色模式没有可由系统控制」，把原来拆分的「跟随系统」+「深色模式」
// 两个独立开关合并成一个三选一，语义更清晰。
// 状态映射：
//   跟随系统 -> common.isAutoTheme = true
//   浅色     -> common.isAutoTheme = false, common.isDarkMode = false
//   深色     -> common.isAutoTheme = false, common.isDarkMode = true
export default memo(() => {
  const t = useI18n()
  const isAutoTheme = useSettingValue('common.isAutoTheme')
  const isDarkMode = useSettingValue('common.isDarkMode')

  const applyMode = (mode: 'auto' | 'light' | 'dark') => {
    updateSetting({
      'common.isAutoTheme': mode === 'auto',
      'common.isDarkMode': mode === 'dark',
    })
    void getTheme().then((theme) => {
      if (theme.id == themeState.theme.id) return
      applyTheme(theme)
    })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={isAutoTheme}
        label={t('setting_basic_theme_mode_auto')}
        onChange={() => applyMode('auto')}
      />
      <CheckBoxItem
        check={!isAutoTheme && !isDarkMode}
        label={t('setting_basic_theme_mode_light')}
        onChange={() => applyMode('light')}
      />
      <CheckBoxItem
        check={!isAutoTheme && isDarkMode}
        label={t('setting_basic_theme_mode_dark')}
        onChange={() => applyMode('dark')}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
