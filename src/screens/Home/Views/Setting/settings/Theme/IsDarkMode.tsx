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

// 手动深色模式开关：始终显示。开启后强制使用 black 主题，
// 关闭则使用用户选定的主题。主动开启时会同时关闭「跟随系统」，
// 避免「跟随系统」优先级高于手动深色模式导致开关无效。
export default memo(() => {
  const t = useI18n()
  const isDarkMode = useSettingValue('common.isDarkMode')

  const setIsDarkMode = (isDarkMode: boolean) => {
    updateSetting({
      'common.isDarkMode': isDarkMode,
      ...(isDarkMode ? { 'common.isAutoTheme': false } : {}),
    })
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
