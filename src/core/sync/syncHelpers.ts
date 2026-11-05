import { getListMusics } from '@/core/list'
import listState from '@/store/list/state'
import settingState from '@/store/setting/state'
import { LIST_IDS } from '@/config/constant'
import { getPlayHistory, getUserApiList, getUserApiScript } from '@/utils/data.ts'
import { normalizeDownloadTasksForSync } from '@/utils/data/download'
import downloadState from '@/store/download/state'

/**
 * 同步 / 备份 / WebDAV 上传的敏感字段黑名单。
 *
 * 历史坑（2026-10 安全评审）：名单漏了 QQ 与酷狗 Cookie，于是「导出备份」「上传到
 * WebDAV」会把这两个平台的完整登录态一起交出去（分享备份 = 交出账号）。
 *
 * 因此除了显式名单，下面还有一条**按后缀**的兜底规则：任何以 `_cookie` /
 * `_token` / `_password` 结尾、或键名里含 `secret` 的设置都不进同步数据 ——
 * 以后新增平台时即使忘了往名单里加，也不会再泄露凭据。
 */
const SENSITIVE_SETTING_KEYS: Array<keyof LX.AppSetting> = [
  'common.wy_cookie',
  'common.kg_cookie',
  'common.tx_cookie',
  'common.wy_serpapi_key',
  'common.yt_cookie',
  'sync.webdav.password',
]

const SENSITIVE_KEY_PATTERN = /(?:^|[._])(?:cookie|token|password|passwd|secret|credential)s?$/i
const SENSITIVE_KEY_FRAGMENT = /(?:secret|credential)/i

/** 该设置键是否禁止进入同步 / 备份数据（导出给回归契约脚本断言） */
export const isSensitiveSettingKey = (key: string): boolean =>
  (SENSITIVE_SETTING_KEYS as string[]).includes(key) ||
  SENSITIVE_KEY_PATTERN.test(key) ||
  SENSITIVE_KEY_FRAGMENT.test(key)

export const filterSensitiveSettingsForSync = (settings: Partial<LX.AppSetting>) => {
  const nextSettings = { ...settings }
  for (const key of Object.keys(nextSettings)) {
    if (isSensitiveSettingKey(key)) delete (nextSettings as Record<string, unknown>)[key]
  }
  return nextSettings
}

export const getAllDataForSync = async() => {
  const defaultList = await getListMusics(listState.defaultList.id)
  const loveList = await getListMusics(listState.loveList.id)
  const tempList = await getListMusics(LIST_IDS.TEMP)
  const userList = []
  for await (const list of listState.userList) {
    userList.push({ ...list, list: await getListMusics(list.id) })
  }
  const lists = { defaultList, loveList, userList, tempList }
  const playHistory = await getPlayHistory()
  const downloadTasks = normalizeDownloadTasksForSync(downloadState.tasks)
  const settings = filterSensitiveSettingsForSync(settingState.setting)

  const userApiList = await getUserApiList()
  const userApiScripts: Record<string, string> = {}
  for (const api of userApiList) {
    userApiScripts[api.id] = await getUserApiScript(api.id)
  }
  const userApis = {
    list: userApiList,
    scripts: userApiScripts,
  }

  return { lists, playHistory, downloadTasks, settings, userApis }
}
