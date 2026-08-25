import ChoosePath, { type ChoosePathType } from '@/components/common/ChoosePath'
import { USER_API_SOURCE_FILE_EXT_RXP } from '@/config/constant'
import { forwardRef, useImperativeHandle, useRef, useState, type MutableRefObject } from 'react'
import { Platform } from 'react-native'
import { selectFile, shareFile, temporaryDirectoryPath } from '@/utils/fs'
import { handleImportLocalFile, handleExportUserApi, handleExportUserApiToFile } from './action'
import { toast } from '@/utils/tools'
import { log } from '@/utils/log'

export interface SelectInfo {
  action: 'import' | 'export'
  apiId?: string
}
const initSelectInfo = {}

export interface ScriptImportExportType {
  import: () => void
  export: (apiId: string) => void
}

export interface ScriptImportExportProps {
  /**
   * iOS 上调用原生选择器/分享面板前调用，并传入一个 proceed 回调。
   * proceed 内部才真正调起原生面板（UIDocumentPicker / UIActivityViewController）。
   * 父组件会先完全卸载底层 RN Modal，再在 proceed 中调起原生面板，
   * 从而避免原生面板覆盖在仍存在的 RN Modal 上、dismiss 后整页卡死。
   */
  onBeforeNativePicker?: (proceed: () => void) => void
  /**
   * iOS 上原生选择器/分享面板结束后调用，用于重新显示 RN Modal。
   */
  onAfterNativePicker?: () => void
}

const showChoosePath = (
  choosePathRef: MutableRefObject<ChoosePathType | null>,
  visible: boolean,
  setVisible: (v: boolean) => void,
  opts: { title: string; dirOnly: boolean; filter?: string[] },
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

export default forwardRef<ScriptImportExportType, ScriptImportExportProps>((props, ref) => {
  const { onBeforeNativePicker, onAfterNativePicker } = props
  const [visible, setVisible] = useState(false)
  const choosePathRef = useRef<ChoosePathType>(null)
  const selectInfoRef = useRef<SelectInfo>(initSelectInfo as SelectInfo)

  useImperativeHandle(ref, () => ({
    import() {
      selectInfoRef.current = {
        action: 'import',
      }
      // iOS：使用系统原生文档选择器（UIDocumentPicker），而非安卓风格目录浏览器。
      // 将原生面板调用包进 proceed：父组件会先完全卸载底层 RN Modal，再执行 proceed，
      // 避免 UIDocumentPicker 覆盖在仍存在的 RN Modal 上、dismiss 后整页卡死。
      if (Platform.OS === 'ios') {
        onBeforeNativePicker?.(() => {
          void selectFile({ extTypes: USER_API_SOURCE_FILE_EXT_RXP })
            .then((res) => {
              if (res?.data) handleImportLocalFile(res.data)
            })
            .catch((err: any) => {
              if (err?.code === 'picker_cancelled') return
              // 诊断：把原生选择器失败原因直接弹出，便于真机复现后定位“本地导入没反应”的根因
              // （如 picker_present=找不到可呈现的 VC、picker_busy=上一个面板未释放）。
              toast(global.i18n.t('user_api_import_failed_tip', { message: err?.message ?? '' }), 'long')
              // 原生选择器不可用或失败时回退到内置目录浏览器
              showChoosePath(choosePathRef, visible, setVisible, {
                title: global.i18n.t('user_api_import_desc'),
                dirOnly: false,
                filter: USER_API_SOURCE_FILE_EXT_RXP,
              })
            })
            .finally(() => {
              onAfterNativePicker?.()
            })
        })
        return
      }
      showChoosePath(choosePathRef, visible, setVisible, {
        title: global.i18n.t('user_api_import_desc'),
        dirOnly: false,
        filter: USER_API_SOURCE_FILE_EXT_RXP,
      })
    },
    export(apiId) {
      selectInfoRef.current = {
        action: 'export',
        apiId,
      }
      // iOS：导出自定义源使用系统原生分享面板（UIActivityViewController）。
      // 同样包进 proceed，确保面板调起前底层 RN Modal 已完全卸载。
      if (Platform.OS === 'ios') {
        onBeforeNativePicker?.(() => {
          void handleExportUserApiToFile(apiId, temporaryDirectoryPath)
            .then((fullPath) => shareFile(fullPath))
            .then(() => toast(global.i18n.t('user_api_export_success_tip')))
            .catch((err: any) => {
              if (err?.code === 'file_not_found') {
                toast(global.i18n.t('user_api_export_failed_tip', { message: '' }), 'long')
                return
              }
              log.error(err)
              toast(global.i18n.t('user_api_export_failed_tip', { message: err?.message ?? '' }), 'long')
            })
            .finally(() => {
              onAfterNativePicker?.()
            })
        })
        return
      }
      showChoosePath(choosePathRef, visible, setVisible, {
        title: global.i18n.t('user_api_export_desc'),
        dirOnly: true,
        filter: USER_API_SOURCE_FILE_EXT_RXP,
      })
    },
  }))

  const onConfirmPath = (path: string) => {
    switch (selectInfoRef.current.action) {
      case 'import':
        handleImportLocalFile(path)
        break
      case 'export':
        if (selectInfoRef.current.apiId) {
          void handleExportUserApi(selectInfoRef.current.apiId, path)
        }
        break
    }
  }

  return visible ? <ChoosePath ref={choosePathRef} onConfirm={onConfirmPath} /> : null
})
