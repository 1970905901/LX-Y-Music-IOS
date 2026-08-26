import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const playDetailSwipeSwitch = useSettingValue('common.playDetailSwipeSwitch')
  const setPlayDetailSwipeSwitch = (playDetailSwipeSwitch: boolean) => {
    updateSetting({ 'common.playDetailSwipeSwitch': playDetailSwipeSwitch })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={playDetailSwipeSwitch}
        label={t('setting_basic_playdetail_swipe_switch')}
        onChange={setPlayDetailSwipeSwitch}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
