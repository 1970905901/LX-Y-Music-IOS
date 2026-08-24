import { importUserApi } from '@/core/userApi'
import { readFile, writeFile } from '@/utils/fs'
import { getUserApiScript, getUserApiList } from '@/utils/data'
import { log } from '@/utils/log'
import { toast } from '@/utils/tools'

export const handleImportScript = async (script: string) => {
  await importUserApi(script)
    .then(() => {
      toast(global.i18n.t('user_api_import_success_tip'))
    })
    .catch((error: any) => {
      log.error(error.stack)
      toast(global.i18n.t('user_api_import_failed_tip', { message: error.message }), 'long')
    })
}

export const handleImportLocalFile = (path: string) => {
  // toast(global.i18n.t('setting_backup_part_import_list_tip_unzip'))
  void readFile(path)
    .then(async (script) => {
      if (script == null) throw new Error('Read file failed')
      void handleImportScript(script)
    })
    .catch((error: any) => {
      toast(global.i18n.t('user_api_import_failed_tip', { message: error.message }), 'long')
    })
}

export const handleExportUserApi = async (apiId: string, path: string) => {
  try {
    const script = await getUserApiScript(apiId)
    const apiList = await getUserApiList()
    const apiInfo = apiList.find(api => api.id === apiId)
    
    if (!apiInfo) {
      throw new Error('API not found')
    }

    const fileName = `${apiInfo.name}.js`
    const fullPath = path.endsWith('/') ? `${path}${fileName}` : `${path}/${fileName}`
    
    await writeFile(fullPath, script)
    toast(global.i18n.t('user_api_export_success_tip'))
  } catch (error: any) {
    log.error(error.stack)
    toast(global.i18n.t('user_api_export_failed_tip', { message: error.message }), 'long')
  }
}
