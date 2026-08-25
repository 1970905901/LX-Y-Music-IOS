import ChoosePath, { type ChoosePathType } from '@/components/common/ChoosePath'
import { LXM_FILE_EXT_RXP } from '@/config/constant'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { selectFile } from '@/utils/fs'
import { handleExportList, handleImportList } from './actions'

export interface SelectInfo {
  // listInfo: LX.List.MyListInfo
  // selectedList: LX.Music.MusicInfo[]
  // index: number
  // listId: string
  // single: boolean
  action: 'import' | 'export'
}
const initSelectInfo = {}

// export interface ListImportExportProps {
//   // onRename: (listInfo: LX.List.UserListInfo) => void
//   // onImport: (index: number) => void
//   // onExport: (listInfo: LX.List.MyListInfo) => void
//   // onSync: (listInfo: LX.List.UserListInfo) => void
//   // onRemove: (listInfo: LX.List.MyListInfo) => void
// }
export interface ListImportExportType {
  import: () => void
  export: () => void
}

export default forwardRef<ListImportExportType, {}>((props, ref) => {
  const [visible, setVisible] = useState(false)
  const choosePathRef = useRef<ChoosePathType>(null)
  const selectInfoRef = useRef<SelectInfo>(initSelectInfo as SelectInfo)
  console.log('render import export')

  useImperativeHandle(ref, () => ({
    import() {
      selectInfoRef.current.action = 'import'
      // iOS：导入备份文件使用系统原生文档选择器（UIDocumentPicker）
      if (Platform.OS === 'ios') {
        void selectFile({ extTypes: LXM_FILE_EXT_RXP })
          .then((res) => {
            if (res?.data) handleImportList(res.data)
          })
          .catch((err: any) => {
            if (err?.code === 'picker_cancelled') return
            // 原生选择器不可用或失败时回退到内置目录浏览器
            if (visible) {
              choosePathRef.current?.show({
                title: global.i18n.t('setting_backup_all_import_desc'),
                dirOnly: false,
                filter: LXM_FILE_EXT_RXP,
              })
            } else {
              setVisible(true)
              requestAnimationFrame(() => {
                choosePathRef.current?.show({
                  title: global.i18n.t('setting_backup_all_import_desc'),
                  dirOnly: false,
                  filter: LXM_FILE_EXT_RXP,
                })
              })
            }
          })
        return
      }
      if (visible) {
        choosePathRef.current?.show({
          title: global.i18n.t('setting_backup_all_import_desc'),
          dirOnly: false,
          filter: LXM_FILE_EXT_RXP,
        })
      } else {
        setVisible(true)
        requestAnimationFrame(() => {
          choosePathRef.current?.show({
            title: global.i18n.t('setting_backup_all_import_desc'),
            dirOnly: false,
            filter: LXM_FILE_EXT_RXP,
          })
        })
      }
    },
    export() {
      selectInfoRef.current.action = 'export'
      if (visible) {
        choosePathRef.current?.show({
          title: global.i18n.t('setting_backup_all_export_desc'),
          dirOnly: true,
          filter: LXM_FILE_EXT_RXP,
        })
      } else {
        setVisible(true)
        requestAnimationFrame(() => {
          choosePathRef.current?.show({
            title: global.i18n.t('setting_backup_all_export_desc'),
            dirOnly: true,
            filter: LXM_FILE_EXT_RXP,
          })
        })
      }
    },
  }))

  const onConfirmPath = (path: string) => {
    switch (selectInfoRef.current.action) {
      case 'import':
        handleImportList(path)
        break
      case 'export':
        handleExportList(path)
        break
    }
  }

  return visible ? <ChoosePath ref={choosePathRef} onConfirm={onConfirmPath} /> : null
})
