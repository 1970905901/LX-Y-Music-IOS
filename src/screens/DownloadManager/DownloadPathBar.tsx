import { memo } from 'react'
import { View } from 'react-native'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { getDefaultDownloadPath } from '@/utils/downloadPath'

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const downloadPath = useSettingValue('download.path')

  const defaultDownloadPath = getDefaultDownloadPath()

  return (
    <View style={[styles.card, { backgroundColor: theme['c-primary-alpha-900'] }]}>
      <View style={styles.cardHeader}>
        <Icon name="add_folder" size={18} color={theme['c-primary']} />
        <Text style={styles.cardTitle}>{t('setting_download_path')}</Text>
      </View>
      <Text style={styles.pathText} color={theme['c-font-label']} numberOfLines={2}>
        {t('setting_download_path_label', { path: downloadPath || defaultDownloadPath })}
      </Text>
    </View>
  )
})

const styles = createStyle({
  card: {
    marginHorizontal: 15,
    marginTop: 12,
    marginBottom: 4,
    padding: 14,
    borderRadius: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  pathText: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
})
