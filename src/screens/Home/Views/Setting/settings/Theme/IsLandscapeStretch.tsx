import { memo } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import { createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'

export default memo(() => {
  const t = useI18n()
  const isLandscapeStretch = useSettingValue('theme.isLandscapeStretch')
  const setIsLandscapeStretch = (isLandscapeStretch: boolean) => {
    updateSetting({ 'theme.isLandscapeStretch': isLandscapeStretch })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={isLandscapeStretch}
        label={t('setting_basic_theme_landscape_stretch')}
        onChange={setIsLandscapeStretch}
      />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
