import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle, toast } from '@/utils/tools'
import { memo, useCallback } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const hideNavigationBar = useSettingValue('common.hideNavigationBar')
  const setHideNavigationBar = useCallback((newValue: boolean) => {
    updateSetting({ 'common.hideNavigationBar': newValue })
    toast(t('setting_play_handle_audio_focus_tip'), 'long')
  }, [t])

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={hideNavigationBar}
        label={t('setting_other_hide_navigation_bar')}
        helpDesc={t('setting_other_hide_navigation_bar_tip')}
        onChange={setHideNavigationBar}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
