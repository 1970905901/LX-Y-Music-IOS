import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const isShowMyListSubMenu = useSettingValue('list.isShowMyListSubMenu')
  const setShowMyListSubMenu = (isShowMyListSubMenu: boolean) => {
    updateSetting({ 'list.isShowMyListSubMenu': isShowMyListSubMenu })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={isShowMyListSubMenu}
        label={t('setting_basic_show_my_list_sub_menu')}
        onChange={setShowMyListSubMenu}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})