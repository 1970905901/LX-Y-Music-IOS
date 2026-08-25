import { memo, useRef } from 'react'
import { View, Platform, TouchableOpacity } from 'react-native'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import FileSelect, { type FileSelectType } from '@/components/common/FileSelect'
import { selectFolder } from '@/utils/fs'
import { createStyle, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { getDefaultDownloadPath } from '@/utils/downloadPath'

// 与「设置 → 下载 → 下载路径」共用同一套 download.path 设置与选择逻辑，
// 让下载列表页也能直接查看 / 更改下载目录，二者保持一致、相互连通。
export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
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
    <View style={[styles.card, { backgroundColor: theme['c-primary-alpha-900'] }]}>
      <View style={styles.cardHeader}>
        <Icon name="add_folder" size={18} color={theme['c-primary']} />
        <Text style={styles.cardTitle}>{t('setting_download_path')}</Text>
      </View>
      <Text style={styles.pathText} color={theme['c-font-label']} numberOfLines={2}>
        {t('setting_download_path_label', { path: downloadPath || defaultDownloadPath })}
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={handleSelectPath} activeOpacity={0.6}>
          <Text color={theme['c-primary']} size={13}>{t('setting_download_path_select')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={handleResetPath} activeOpacity={0.6}>
          <Text color={theme['c-font-label']} size={13}>{t('setting_download_path_default')}</Text>
        </TouchableOpacity>
      </View>
      <FileSelect ref={fileSelectRef} />
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginRight: 10,
  },
})
