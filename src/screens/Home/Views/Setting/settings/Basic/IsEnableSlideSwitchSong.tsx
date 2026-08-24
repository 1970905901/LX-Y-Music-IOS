import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const isEnableSlideSwitchSong = useSettingValue('player.isEnableSlideSwitchSong')
  const setIsEnableSlideSwitchSong = (isEnableSlideSwitchSong: boolean) => {
    updateSetting({ 'player.isEnableSlideSwitchSong': isEnableSlideSwitchSong })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={isEnableSlideSwitchSong}
        label={t('setting_basic_slide_switch_song')}
        onChange={setIsEnableSlideSwitchSong}
        helpDesc={t('setting_basic_slide_switch_song_tip')}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
    // marginBottom: 15,
  },
})