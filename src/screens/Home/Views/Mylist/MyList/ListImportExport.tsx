import ChoosePath, { type ChoosePathType } from '@/components/common/ChoosePath'
import { LXM_FILE_EXT_RXP } from '@/config/constant'
import { forwardRef, useImperativeHandle, useRef, useState, type MutableRefObject } from 'react'
import { Platform } from 'react-native'
import { selectFile, selectFolder, shareFile, temporaryDirectoryPath } from '@/utils/fs'
import { handleExport, handleImport, handleImportMediaFile, exportListToFile } from './listAction'
import { toast } from '@/utils/tools'
import { log } from '@/utils/log'

export interface SelectInfo {
  listInfo: LX.List.MyListInfo
  // selectedList: LX.Music.MusicInfo[]
  index: number
  // listId: string
  // single: boolean
  action: 'import' | 'export' | 'selectFile'
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
  import: (listInfo: LX.List.MyListInfo, index: number) => void
  export: (listInfo: LX.List.MyListInfo, index: number) => void
  selectFile: (listInfo: LX.List.MyListInfo, index: number) => void
}

const showChoosePath = (
  choosePathRef: MutableRefObject<ChoosePathType | null>,
  visible: boolean,
  setVisible: (v: boolean) => void,
  opts: { title: string; dirOnly: boolean; filter?: string[]; isPersist?: boolean },
) => {
  if (visible) {
    choosePathRef.current?.show(opts)
  } else {
    setVisible(true)
    requestAnimationFrame(() => {
      choosePathRef.current?.show(opts)
    })
  }
}

export default forwardRef<ListImportExportType, {}>((props, ref) => {
  const [visible, setVisible] = useState(false)
  const choosePathRef = useRef<ChoosePathType>(null)
  const selectInfoRef = useRef<SelectInfo>(initSelectInfo as SelectInfo)
  // console.log('render import export')

  useImperativeHandle(ref, () => ({
    import(listInfo, index) {
      selectInfoRef.current = {
        action: 'import',
        listInfo,
        index,
      }
      // iOS：导入歌单文件使用系统原生文档选择器（UIDocumentPicker）
      if (Platform.OS === 'ios') {
        void selectFile({ extTypes: LXM_FILE_EXT_RXP })
          .then((res) => {
            if (res?.data) handleImport(res.data, index)
          })
          .catch((err: any) => {
            if (err?.code === 'picker_cancelled') return
            // 原生选择器不可用或失败时回退到内置目录浏览器
            showChoosePath(choosePathRef, visible, setVisible, {
              title: global.i18n.t('list_import_part_desc'),
              dirOnly: false,
              filter: LXM_FILE_EXT_RXP,
            })
          })
        return
      }
      showChoosePath(choosePathRef, visible, setVisible, {
        title: global.i18n.t('list_import_part_desc'),
        dirOnly: false,
        filter: LXM_FILE_EXT_RXP,
      })
    },
    export(listInfo, index) {
      selectInfoRef.current = {
        action: 'export',
        listInfo,
        index,
      }
      // iOS：导出歌单使用系统原生分享面板（UIActivityViewController）
      if (Platform.OS === 'ios') {
        toast(global.i18n.t('setting_backup_part_export_list_tip_zip'))
        void exportListToFile(listInfo, temporaryDirectoryPath)
          .then((filePath) => shareFile(filePath))
          .then(() => toast(global.i18n.t('setting_backup_part_export_list_tip_success')))
          .catch((err: any) => {
            if (err?.code === 'file_not_found') {
              toast(global.i18n.t('setting_backup_part_export_list_tip_failed'))
              return
            }
            log.error(err)
            toast(
              global.i18n.t('setting_backup_part_export_list_tip_failed') + ': ' + (err?.message ?? '')
            )
          })
        return
      }
      showChoosePath(choosePathRef, visible, setVisible, {
        title: global.i18n.t('list_export_part_desc'),
        dirOnly: true,
        filter: LXM_FILE_EXT_RXP,
      })
    },
    selectFile(listInfo, index) {
      selectInfoRef.current = {
        action: 'selectFile',
        listInfo,
        index,
      }
      // iOS：选择本地音乐文件夹使用系统原生文件夹选择器（UIDocumentPicker 目录模式）
      if (Platform.OS === 'ios') {
        void selectFolder()
          .then((res) => {
            const path = res?.path
            if (!path) return
            void handleImportMediaFile(listInfo, path)
          })
          .catch((err: any) => {
            if (err?.code === 'picker_cancelled') return
          })
        return
      }
      showChoosePath(choosePathRef, visible, setVisible, {
        title: global.i18n.t('list_select_local_file_desc'),
        dirOnly: true,
        isPersist: true,
      })
    },
  }))

  const onConfirmPath = (path: string) => {
    switch (selectInfoRef.current.action) {
      case 'import':
        handleImport(path, selectInfoRef.current.index)
        break
      case 'export':
        handleExport(selectInfoRef.current.listInfo, path)
        break
      case 'selectFile':
        void handleImportMediaFile(selectInfoRef.current.listInfo, path)
        break
    }
  }

  return visible ? <ChoosePath ref={choosePathRef} onConfirm={onConfirmPath} /> : null
})
