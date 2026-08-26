import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const autoPlayOnReturn = useSettingValue('player.autoPlayOnReturn')
  const setAutoPlayOnReturn = (autoPlayOnReturn: boolean) => {
    updateSetting({ 'player.autoPlayOnReturn': autoPlayOnReturn })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={autoPlayOnReturn}
        label={t('setting_player_auto_play_on_return')}
        onChange={setAutoPlayOnReturn}
        helpDesc={t('setting_player_auto_play_on_return_tip')}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
