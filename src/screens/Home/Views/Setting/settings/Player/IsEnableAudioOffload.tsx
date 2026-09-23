import { memo } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { createStyle, toast } from '@/utils/tools'

export default memo(() => {
  const t = useI18n()
  const isEnableAudioOffload = useSettingValue('player.isEnableAudioOffload')

  const setIsEnableAudioOffload = (value: boolean) => {
    updateSetting({ 'player.isEnableAudioOffload': value })
    toast(t('setting_play_handle_audio_focus_tip'))
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={isEnableAudioOffload}
        onChange={setIsEnableAudioOffload}
        helpDesc={t('setting_play_audio_offload_tip')}
        label={t('setting_play_audio_offload')}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
