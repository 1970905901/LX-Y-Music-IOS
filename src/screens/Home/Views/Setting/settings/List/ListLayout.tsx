import { memo } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'

import CheckBox from '@/components/common/CheckBox'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import type { ListLayoutMode } from '@/config/constant'
import SubTitle from '../../components/SubTitle'

const LAYOUT_OPTIONS: Array<{
  value: ListLayoutMode
  titleKey: string
  descKey: string
}> = [
  {
    value: 'classic',
    titleKey: 'setting_list_layout_style_one',
    descKey: 'setting_list_layout_style_one_desc',
  },
  {
    value: 'card',
    titleKey: 'setting_list_layout_style_two',
    descKey: 'setting_list_layout_style_two_desc',
  },
  {
    value: 'library',
    titleKey: 'setting_list_layout_style_three',
    descKey: 'setting_list_layout_style_three_desc',
  },
]

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const layoutMode = useSettingValue('list.layoutMode')

  return (
    <SubTitle title={t('setting_list_layout_nav')}>
      {LAYOUT_OPTIONS.map(option => (
        <TouchableOpacity
          key={option.value}
          style={styles.option}
          activeOpacity={0.7}
          onPress={() => updateSetting({ 'list.layoutMode': option.value })}
        >
          <CheckBox
            check={layoutMode === option.value}
            onChange={() => updateSetting({ 'list.layoutMode': option.value })}
          />
          <View style={styles.optionText}>
            <Text size={16}>{t(option.titleKey)}</Text>
            <Text size={12} color={theme['c-font-label']}>
              {t(option.descKey)}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </SubTitle>
  )
})

const styles = createStyle({
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
    paddingRight: 15,
  },
  optionText: {
    flex: 1,
    paddingLeft: 5,
    gap: 3,
  },
})
