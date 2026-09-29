import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'

// 【对齐上游】player.autoSkipOnError：播放失败时自动跳下一首（默认开启）
export default memo(() => {
  const t = useI18n()
  const autoSkipOnError = useSettingValue('player.autoSkipOnError')
  const setAutoSkipOnError = (autoSkipOnError: boolean) => {
    updateSetting({ 'player.autoSkipOnError': autoSkipOnError })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={autoSkipOnError}
        onChange={setAutoSkipOnError}
        helpDesc={t('setting_play_auto_skip_error_tip')}
        label={t('setting_play_auto_skip_error')}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
