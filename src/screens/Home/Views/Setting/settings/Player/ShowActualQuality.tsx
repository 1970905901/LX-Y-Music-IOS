import { memo } from 'react'
import { View } from 'react-native'

import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'
import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const showActualQuality = useSettingValue('player.showActualQuality')

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={showActualQuality}
        label={t('setting_player_show_actual_quality')}
        onChange={(value) => updateSetting({ 'player.showActualQuality': value })}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
