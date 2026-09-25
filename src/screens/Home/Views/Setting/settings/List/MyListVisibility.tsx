import { memo, useCallback, useMemo } from 'react'
import { View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBoxItem from '../../components/CheckBoxItem'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useMyList } from '@/store/list/hook'
import { LIST_IDS } from '@/config/constant'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { designRadius, designSpacing } from '@/theme/DesignTokens'

const PLATFORM_ITEM_IDS = [
  'nav_my_playlist',
  'nav_kg_playlist',
  'nav_tx_playlist',
  'nav_followed_artists',
  'nav_subscribed_albums',
] as const

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const allList = useMyList()
  const visibility = useSettingValue('list.myListVisibility')

  const listItems = useMemo(() => {
    return allList.map((list) => ({
      id: list.id,
      name: list.id === LIST_IDS.DEFAULT
        ? t('list_name_default')
        : list.id === LIST_IDS.LOVE
          ? t('list_name_love')
          : list.name,
    }))
  }, [allList, t])

  const platformItems = useMemo(() => {
    return PLATFORM_ITEM_IDS.map(id => ({ id, name: t(id) }))
  }, [t])

  const handleChange = useCallback((listId: string, visible: boolean) => {
    updateSetting({
      'list.myListVisibility': {
        ...visibility,
        [listId]: visible,
      },
    })
  }, [visibility])

  return (
    <SubTitle title={t('setting_list_my_list_visibility')}>
      <Text style={styles.tip} size={12} color={theme['c-font-label']}>
        {t('setting_list_my_list_visibility_tip')}
      </Text>
      <View style={{ ...styles.content, borderColor: theme['c-border-background'] }}>
        {listItems.map((item) => (
          <CheckBoxItem
            key={item.id}
            check={visibility[item.id] ?? true}
            label={item.name}
            onChange={(visible) => { handleChange(item.id, visible) }}
          />
        ))}
        {platformItems.map((item) => (
          <CheckBoxItem
            key={item.id}
            check={visibility[item.id] ?? true}
            label={item.name}
            onChange={(visible) => { handleChange(item.id, visible) }}
          />
        ))}
      </View>
    </SubTitle>
  )
})

const styles = createStyle({
  tip: {
    marginBottom: designSpacing.sm,
  },
  content: {
    borderWidth: 1,
    borderRadius: designRadius.sm,
    padding: designSpacing.sm,
  },
})
