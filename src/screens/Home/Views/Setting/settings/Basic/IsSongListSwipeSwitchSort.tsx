import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const songListSwipeSwitchSort = useSettingValue('common.songListSwipeSwitchSort')
  const setSongListSwipeSwitchSort = (songListSwipeSwitchSort: boolean) => {
    updateSetting({ 'common.songListSwipeSwitchSort': songListSwipeSwitchSort })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={songListSwipeSwitchSort}
        label={t('setting_basic_songlist_swipe_switch_sort')}
        onChange={setSongListSwipeSwitchSort}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
