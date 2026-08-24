import ChoosePath, { type ChoosePathType } from '@/components/common/ChoosePath'
import { USER_API_SOURCE_FILE_EXT_RXP } from '@/config/constant'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { handleImportLocalFile, handleExportUserApi } from './action'

export interface SelectInfo {
  action: 'import' | 'export'
  apiId?: string
}
const initSelectInfo = {}

export interface ScriptImportExportType {
  import: () => void
  export: (apiId: string) => void
}

export default forwardRef<ScriptImportExportType, {}>((props, ref) => {
  const [visible, setVisible] = useState(false)
  const choosePathRef = useRef<ChoosePathType>(null)
  const selectInfoRef = useRef<SelectInfo>(initSelectInfo as SelectInfo)

  useImperativeHandle(ref, () => ({
    import() {
      selectInfoRef.current = {
        action: 'import',
      }
      if (visible) {
        choosePathRef.current?.show({
          title: global.i18n.t('user_api_import_desc'),
          dirOnly: false,
          filter: USER_API_SOURCE_FILE_EXT_RXP,
        })
      } else {
        setVisible(true)
        requestAnimationFrame(() => {
          choosePathRef.current?.show({
            title: global.i18n.t('user_api_import_desc'),
            dirOnly: false,
            filter: USER_API_SOURCE_FILE_EXT_RXP,
          })
        })
      }
    },
    export(apiId) {
      selectInfoRef.current = {
        action: 'export',
        apiId,
      }
      if (visible) {
        choosePathRef.current?.show({
          title: global.i18n.t('user_api_export_desc'),
          dirOnly: true,
          filter: USER_API_SOURCE_FILE_EXT_RXP,
        })
      } else {
        setVisible(true)
        requestAnimationFrame(() => {
          choosePathRef.current?.show({
            title: global.i18n.t('user_api_export_desc'),
            dirOnly: true,
            filter: USER_API_SOURCE_FILE_EXT_RXP,
          })
        })
      }
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
