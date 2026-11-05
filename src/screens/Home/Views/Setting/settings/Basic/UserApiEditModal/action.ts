import { importUserApi } from '@/core/userApi'
import { readFile, writeFile } from '@/utils/fs'
import { getUserApiScript, getUserApiList } from '@/utils/data'
import { log } from '@/utils/log'
import { toast } from '@/utils/tools'
import { filterFileName } from '@/utils/common'

/**
 * 导出文件名净化（2026-10 安全审计）。
 *
 * 音源名称来自用户导入的脚本内容（utils/data.ts 只限制长度），此前直接拼进
 * `${dirPath}/${apiInfo.name}.js`。名称里带 `../` 时 writeFile 会逃出所选目录、
 * 覆盖 App 沙盒内的其它文件。复用项目既有的 filterFileName（去掉 \ / : * ? # " < > |），
 * 再兜底去掉 `..` 与首尾空白/点，保证结果只能是目标目录下的一个文件名。
 */
const toSafeScriptFileName = (name: string) => {
  const base = filterFileName(String(name ?? ''))
    .replace(/\.\./g, '')
    .replace(/^[\s.]+|[\s.]+$/g, '')
  return `${base || 'user_api'}.js`
}

export const handleImportScript = async(script: string) => {
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
    .then(async(script) => {
      if (script == null) throw new Error('Read file failed')
      void handleImportScript(script)
    })
    .catch((error: any) => {
      toast(global.i18n.t('user_api_import_failed_tip', { message: error.message }), 'long')
    })
}

export const handleExportUserApi = async(apiId: string, path: string) => {
  try {
    const script = await getUserApiScript(apiId)
    const apiList = await getUserApiList()
    const apiInfo = apiList.find(api => api.id === apiId)

    if (!apiInfo) {
      throw new Error('API not found')
    }

    const fileName = toSafeScriptFileName(apiInfo.name)
    const fullPath = path.endsWith('/') ? `${path}${fileName}` : `${path}/${fileName}`

    await writeFile(fullPath, script)
    toast(global.i18n.t('user_api_export_success_tip'))
  } catch (error: any) {
    log.error(error.stack)
    toast(global.i18n.t('user_api_export_failed_tip', { message: error.message }), 'long')
  }
}

// iOS 导出：写入指定目录下的 <名称>.js 并返回完整路径（供系统分享面板使用）
export const handleExportUserApiToFile = async(apiId: string, dirPath: string): Promise<string> => {
  const script = await getUserApiScript(apiId)
  const apiList = await getUserApiList()
  const apiInfo = apiList.find(api => api.id === apiId)
  if (!apiInfo) throw new Error('API not found')
  const fileName = toSafeScriptFileName(apiInfo.name)
  const fullPath = dirPath.endsWith('/') ? `${dirPath}${fileName}` : `${dirPath}/${fileName}`
  await writeFile(fullPath, script)
  return fullPath
}
