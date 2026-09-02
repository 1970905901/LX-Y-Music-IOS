import { memo } from 'react'
import SubTitle from '../../components/SubTitle'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { getDefaultDownloadPath } from '@/utils/downloadPath'

export default memo(() => {
  const t = useI18n()
  const downloadPath = useSettingValue('download.path')

  const defaultDownloadPath = getDefaultDownloadPath()

  return (
    <SubTitle title={t('setting_download_path')}>
      <Text style={styles.path} numberOfLines={2}>
        {t('setting_download_path_label', { path: downloadPath || defaultDownloadPath })}
      </Text>
    </SubTitle>
  )
})

const styles = createStyle({
  path: {
    marginBottom: 10,
  },
})
