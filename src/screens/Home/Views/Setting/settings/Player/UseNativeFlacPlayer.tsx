import { memo } from 'react'
import { View } from 'react-native'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle, toast } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'
import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const useNativeFlacPlayer = useSettingValue('player.useNativeFlacPlayer')
  const setUseNativeFlacPlayer = (val: boolean) => {
    updateSetting({ 'player.useNativeFlacPlayer': val })
    toast(t('setting_play_use_native_flac_tip'))
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={useNativeFlacPlayer}
        onChange={setUseNativeFlacPlayer}
        helpDesc={t('setting_play_use_native_flac_desc')}
        label={t('setting_play_use_native_flac')}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
