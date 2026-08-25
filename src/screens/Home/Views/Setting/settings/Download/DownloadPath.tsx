import { memo, useRef } from 'react'
import { View, Platform } from 'react-native'
import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import FileSelect, { type FileSelectType } from '@/components/common/FileSelect'
import { selectFolder } from '@/utils/fs'
import { createStyle, toast } from '@/utils/tools'
import Text from '@/components/common/Text'
import { getDefaultDownloadPath } from '@/utils/downloadPath'

export default memo(() => {
  const t = useI18n()
  const downloadPath = useSettingValue('download.path')
  const fileSelectRef = useRef<FileSelectType>(null)

  const defaultDownloadPath = getDefaultDownloadPath()

  const handleSelectPath = () => {
    // iOS：使用系统原生文件夹选择器（UIDocumentPicker 目录模式）
    if (Platform.OS === 'ios') {
      void selectFolder()
        .then((res) => {
          const path = res?.path
          if (!path) return
          updateSetting({ 'download.path': path })
          toast(t('setting_download_path_set_success'))
        })
        .catch((err: any) => {
          if (err?.code === 'picker_cancelled') return
          if (err?.message) toast(err.message, 'long')
        })
      return
    }
    fileSelectRef.current?.show(
      {
        title: t('setting_download_path_select'),
        dirOnly: true,
      },
      (path) => {
        if (!path) return
        updateSetting({ 'download.path': path })
        toast(t('setting_download_path_set_success'))
      },
    )
  }

  const handleResetPath = () => {
    updateSetting({ 'download.path': '' })
    toast(t('setting_download_path_reset_success'))
  }

  return (
    <>
      <SubTitle title={t('setting_download_path')}>
        <Text style={styles.path} numberOfLines={2}>
          {t('setting_download_path_label', { path: downloadPath || defaultDownloadPath })}
        </Text>
        <View style={styles.btns}>
          <Button onPress={handleSelectPath}>{t('setting_download_path_select')}</Button>
          <Button onPress={handleResetPath}>{t('setting_download_path_default')}</Button>
        </View>
      </SubTitle>
      <FileSelect ref={fileSelectRef} />
    </>
  )
})

const styles = createStyle({
  path: {
    marginBottom: 10,
  },
  btns: {
    flexDirection: 'row',
  },
})
