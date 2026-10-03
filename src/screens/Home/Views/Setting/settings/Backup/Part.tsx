import { memo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'

// import { gzip, ungzip } from 'pako'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { designSpacing } from '@/theme/DesignTokens'
import ListImportExport, { type ListImportExportType } from './ListImportExport'

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const listImportExportRef = useRef<ListImportExportType>(null)

  return (
    <>
      <SubTitle title={t('setting_backup_part')}>
        <View style={styles.list}>
          <Button onPress={() => listImportExportRef.current?.import()}>
            {t('setting_backup_part_import_list')}
          </Button>
          <Button onPress={() => listImportExportRef.current?.export()}>
            {t('setting_backup_part_export_list')}
          </Button>
          {/* <Button onPress={() => importAndExportData('import', 'setting')}>{t('setting_backup_part_import_setting')}</Button>
          <Button onPress={() => importAndExportData('export', 'setting')}>{t('setting_backup_part_export_setting')}</Button> */}
        </View>
        {/* 说明小字原先与两个按钮挤在同一个 flex 行里（被按钮挤在右侧/贴在按钮下方），
            现拆成独立一块：与按钮行左端对齐，并在上方留出间距 */}
        <Text style={styles.tip} size={12} color={theme['c-font-label']}>
          {t('setting_backup_all_tip')}
        </Text>
      </SubTitle>
      {/* <SubTitle title={t('setting_backup_all')}>
        <View style={styles.list}>
          <Button onPress={() => importAndExportData('import', 'all')}>{t('setting_backup_all_import')}</Button>
          <Button onPress={() => importAndExportData('export', 'all')}>{t('setting_backup_all_export')}</Button>
        </View>
      </SubTitle> */}
      <ListImportExport ref={listImportExportRef} />
    </>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingLeft: designSpacing.md,
    marginTop: designSpacing.xs,
  },
  tip: {
    // 与按钮行共用同一个左内边距（左对齐），并向下留一点间距，避免小字挤在按钮上/按钮右侧
    marginTop: designSpacing.sm,
    paddingLeft: designSpacing.md,
    paddingRight: designSpacing.md,
  },
})
