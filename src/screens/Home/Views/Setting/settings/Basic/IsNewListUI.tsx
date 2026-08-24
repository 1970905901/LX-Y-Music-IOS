import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const isNewListUI = useSettingValue('list.isNewListUI')
  const setNewListUI = (isNewListUI: boolean) => {
    updateSetting({ 'list.isNewListUI': isNewListUI })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={isNewListUI}
        label={t('setting_basic_new_list_ui')}
        onChange={setNewListUI}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
