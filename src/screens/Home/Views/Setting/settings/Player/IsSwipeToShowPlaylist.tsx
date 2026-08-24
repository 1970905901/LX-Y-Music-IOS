import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle, toast } from '@/utils/tools'
import { memo, useCallback } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const isSwipeToShowPlaylist = useSettingValue('player.isSwipeToShowPlaylist')
  const setSwipeToShowPlaylist = useCallback((isSwipeToShowPlaylist: boolean) => {
    updateSetting({ 'player.isSwipeToShowPlaylist': isSwipeToShowPlaylist })
    toast(t('setting_play_handle_audio_focus_tip'), 'long')
  }, [t])

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={isSwipeToShowPlaylist}
        label={t('setting_player_swipe_to_show_playlist')}
        onChange={setSwipeToShowPlaylist}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
