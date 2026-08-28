import { memo } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import { createStyle, getIsSupportedAutoTheme } from '@/utils/tools'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { getTheme } from '@/theme/themes'
import { applyTheme } from '@/core/theme'
import themeState from '@/store/theme/state'

// 手动深色模式开关：仅在「跟随系统（isAutoTheme）」关闭时显示。
// 开启后强制使用 black 主题（与 isAutoTheme + 系统深色 等效），关闭则使用用户选定的浅色主题。
export default memo(() => {
  const t = useI18n()
  const isAutoTheme = useSettingValue('common.isAutoTheme')
  const isSupportedAutoTheme = getIsSupportedAutoTheme()
  const isDarkMode = useSettingValue('common.isDarkMode')

  if (isSupportedAutoTheme && isAutoTheme) return null

  const setIsDarkMode = (isDarkMode: boolean) => {
    updateSetting({ 'common.isDarkMode': isDarkMode })
    void getTheme().then((theme) => {
      if (theme.id == themeState.theme.id) return
      applyTheme(theme)
    })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={!!isDarkMode}
        label={t('setting_basic_theme_dark_mode')}
        onChange={setIsDarkMode}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
