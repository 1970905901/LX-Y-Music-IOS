import { memo } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { createStyle, toast } from '@/utils/tools'

export default memo(() => {
  const t = useI18n()
  const isEnableUrlCache = useSettingValue('player.isEnableUrlCache')

  const setIsEnableUrlCache = (value: boolean) => {
    updateSetting({ 'player.isEnableUrlCache': value })
    toast(t('setting_play_url_cache_tip'))
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={isEnableUrlCache}
        onChange={setIsEnableUrlCache}
        helpDesc={t('setting_play_url_cache_desc')}
        label={t('setting_play_url_cache')}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
