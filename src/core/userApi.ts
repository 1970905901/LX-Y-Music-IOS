import { action, state } from '@/store/userApi'
import {
  addUserApi,
  getUserApiScript,
  removeUserApi as removeUserApiFromStore,
  setUserApiAllowShowUpdateAlert as setUserApiAllowShowUpdateAlertFromStore,
  setUserApiList as setUserApiListFromStore,
} from '@/utils/data'
import { destroy, loadScript } from '@/utils/nativeModules/userApi'
import { log as writeLog } from '@/utils/log'
import { getAllKeys, removeDataMultiple, saveDataMultiple } from '@/plugins/storage.ts'
import { storageDataPrefix } from '@/config/constant.ts'

export const setUserApi = async(apiId: string) => {
  global.lx.qualityList = {}
  setUserApiStatus(false, 'initing')

  const target = state.list.find((api) => api.id === apiId)
  if (!target) throw new Error('api not found')
  const script = await getUserApiScript(target.id)
  loadScript({ ...target, script })
}

export const destroyUserApi = () => {
  destroy()
}

export const setUserApiStatus: (typeof action)['setStatus'] = (status, message) => {
  action.setStatus(status, message)
}

export const setUserApiList: (typeof action)['setUserApiList'] = (list) => {
  action.setUserApiList(list)
}

export const importUserApi = async(script: string) => {
  const info = await addUserApi(script)
  action.addUserApi(info)
}

export const removeUserApi = async(ids: string[]) => {
  const list = await removeUserApiFromStore(ids)
  action.setUserApiList(list)
}

export const setUserApiAllowShowUpdateAlert = async(id: string, enable: boolean) => {
  await setUserApiAllowShowUpdateAlertFromStore(id, enable)
  action.setUserApiAllowShowUpdateAlert(id, enable)
}

export const reorderUserApi = async(list: LX.UserApi.UserApiInfo[]) => {
  const persisted = await setUserApiListFromStore(list)
  action.setUserApiList(persisted)
}

export const overwriteUserApis = async(data: { list: LX.UserApi.UserApiInfo[], scripts: Record<string, string> }) => {
  try {
    const allKeys = await getAllKeys()
    const oldScriptKeys = allKeys.filter(key => key.startsWith(storageDataPrefix.userApi) && key !== storageDataPrefix.userApi)
    const newScriptIds = new Set(Object.keys(data.scripts ?? {}))

    // 先写、后删（2026-10 审计）。
    //
    // 旧实现是「先删掉新数据里没有的旧脚本，再写新列表与新脚本」：写入阶段一旦失败
    // （存储满 / 桥调用异常），旧脚本已经删了、新脚本又没落盘 —— 用户的音源被永久清空，
    // 且 catch 只是记日志后重新抛出，没有回滚。
    // 现在把删除放到所有写入成功之后：任一步失败时磁盘上仍是「旧列表 + 旧脚本」的完整状态。
    const saveTasks: Array<[string, any]> = []
    saveTasks.push([storageDataPrefix.userApi, data.list])
    for (const [id, script] of Object.entries(data.scripts ?? {})) {
      saveTasks.push([`${storageDataPrefix.userApi}${id}`, script])
    }
    await saveDataMultiple(saveTasks)

    const keysToRemove = oldScriptKeys.filter(key => !newScriptIds.has(key.substring(storageDataPrefix.userApi.length)))
    if (keysToRemove.length) {
      // 清理失败不影响「新数据已生效」：脚本已写入，多余键只是残留存储。
      // 但仍要留痕，便于排查存储异常。
      await removeDataMultiple(keysToRemove).catch((error: any) => {
        log.error('Remove obsolete user api scripts failed:', error?.message)
      })
    }

    action.setUserApiList(data.list)
  } catch (error: any) {
    log.error('Overwrite user apis failed:', error.message)
    throw error
  }
}

export const log = {
  r_info(...params: any[]) {
    if (!global.lx.isEnableLog) return
    writeLog.info(...params)
  },
  r_warn(...params: any[]) {
    if (!global.lx.isEnableLog) return
    writeLog.warn(...params)
  },
  r_error(...params: any[]) {
    if (!global.lx.isEnableLog) return
    writeLog.error(...params)
  },
  log(...params: any[]) {
    if (!global.lx.isEnableLog) return
    if (!global.lx.isEnableUserApiLog) return
    writeLog.info(...params)
  },
  info(...params: any[]) {
    if (!global.lx.isEnableLog) return
    if (!global.lx.isEnableUserApiLog) return
    writeLog.info(...params)
  },
  warn(...params: any[]) {
    if (!global.lx.isEnableLog) return
    if (!global.lx.isEnableUserApiLog) return
    writeLog.warn(...params)
  },
  error(...params: any[]) {
    if (!global.lx.isEnableLog) return
    if (!global.lx.isEnableUserApiLog) return
    writeLog.error(...params)
  },
}
