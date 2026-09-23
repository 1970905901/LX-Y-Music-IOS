import { memo } from 'react'
import { View } from 'react-native'

import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { useSettingValue } from '@/store/setting/hook'
import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const showActualPlatform = useSettingValue('player.showActualPlatform')

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={showActualPlatform}
        label={t('setting_player_show_actual_platform')}
        onChange={(value) => updateSetting({ 'player.showActualPlatform': value })}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
