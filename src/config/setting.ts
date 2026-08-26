import { storageDataPrefix, storageDataPrefixOld, NAV_MENUS, NAV_GROUPS } from '@/config/constant'
import defaultSetting from '@/config/defaultSetting'
import { getData, removeData, saveData } from '@/plugins/storage'
import migrateSetting from './migrateSetting'
import settingState from '@/store/setting/state'
import { migrateMetaData, migrateListData } from './migrate'
import { exitApp, tipDialog } from '@/utils/tools'

const primitiveType = ['string', 'boolean', 'number']
const checkPrimitiveType = (val: any): boolean => val === null || primitiveType.includes(typeof val)

const arraysEqual = (a: any[], b: any[]): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

const DEEP_KEYS = ['common.navStatus', 'common.navOrder', 'common.sectionExpandedStatus', 'player.failureStrategy', 'search.enabledSources', 'common.navGroupExpanded', 'common.navGroupOrder', 'common.navFlatOrder', 'common.navGroupVisible']

const mergeSetting = (
  originSetting: LX.AppSetting,
  targetSetting?: Partial<LX.AppSetting> | null
): {
  setting: LX.AppSetting
  updatedSettingKeys: Array<keyof LX.AppSetting>
  updatedSetting: Partial<LX.AppSetting>
} => {
  let originSettingCopy: LX.AppSetting = { ...originSetting }
  const updatedSettingKeys: Array<keyof LX.AppSetting> = []
  const updatedSetting: Partial<LX.AppSetting> = {}

  if (targetSetting) {
    const originSettingKeys = Object.keys(originSettingCopy)
    const targetSettingKeys = Object.keys(targetSetting)

    const processKey = (key: keyof LX.AppSetting) => {
      const targetValue: any = targetSetting[key]
      const isPrimitive = checkPrimitiveType(targetValue)
      let shouldSkip = false
      
      if (!isPrimitive && !DEEP_KEYS.includes(key as string)) {
        shouldSkip = true
      } else if (DEEP_KEYS.includes(key as string)) {
        if (Array.isArray(targetValue) && Array.isArray(originSettingCopy[key])) {
          if (arraysEqual(targetValue, originSettingCopy[key])) shouldSkip = true
        } else if (typeof targetValue === 'object' && typeof originSettingCopy[key] === 'object' && targetValue !== null && originSettingCopy[key] !== null) {
          if (JSON.stringify(targetValue) === JSON.stringify(originSettingCopy[key])) shouldSkip = true
        } else if (targetValue == originSettingCopy[key]) {
          shouldSkip = true
        }
      } else if (targetValue == originSettingCopy[key]) {
        shouldSkip = true
      }

      if (!shouldSkip) {
        updatedSettingKeys.push(key)
        updatedSetting[key] = targetValue
        // @ts-expect-error
        originSettingCopy[key] = targetValue
      }
    }

    if (originSettingKeys.length > targetSettingKeys.length) {
      for (const key of targetSettingKeys as Array<keyof LX.AppSetting>) {
        processKey(key)
      }
    } else {
      for (const key of originSettingKeys as Array<keyof LX.AppSetting>) {
        if (targetSetting[key] !== undefined) {
          processKey(key)
        }
      }
    }
  }

  return {
    setting: originSettingCopy,
    updatedSettingKeys,
    updatedSetting,
  }
}
export const updateSetting = (setting?: Partial<LX.AppSetting> | null, isInit: boolean = false) => {
  let originSetting: LX.AppSetting
  if (isInit) {
    originSetting = { ...defaultSetting }
  } else originSetting = settingState.setting

  const result = mergeSetting(originSetting, setting)

  result.setting.version = defaultSetting.version

  return result
}

export const initSetting = async () => {
  let setting: Partial<LX.AppSetting> | null = await getData(storageDataPrefix.setting)

  // try migrate setting before v1
  if (!setting) {
    const config = await getData<{ setting?: any }>(storageDataPrefixOld.setting)
    if (config != null) {
      setting = migrateSetting(config)
      try {
        await migrateListData()
        await migrateMetaData()
      } catch (err: any) {
        void tipDialog({
          title: '数据迁移失败 (Failed to migrate data)',
          message: `请截图并在 GitHub 反馈。为了防止数据丢失，应用将停止运行。错误信息：\n${(err.stack ?? err.message) as string}`,
          btnText: 'Exit',
          bgClose: false,
        }).then(() => {
          exitApp()
        })
        throw err
      }
      await removeData(storageDataPrefixOld.setting)
    }
  }

  const updatedSetting = updateSetting(setting, true)

  // 导航顺序迁移：以当前 NAV_MENUS / NAV_GROUPS 为权威来源，把后续新增的菜单项
  // （如百度网盘）补进老用户持久化的 navOrder、navFlatOrder 与 navGroupOrder 末尾，
  // 避免侧边栏、自定义排序列表、播放页 PagerView 在任何模式下丢失新增项。
  const allMenuIds = NAV_MENUS.map(m => m.id)
  const patchOrder = (key: 'common.navOrder' | 'common.navFlatOrder') => {
    const order = updatedSetting.setting[key] as string[] | undefined
    if (!Array.isArray(order)) return
    const set = new Set(order)
    const missing = allMenuIds.filter(id => !set.has(id))
    if (!missing.length) return
    // 空数组保持为空，让运行时 getEffectiveFlatOrder 回退到 navOrder / NAV_MENUS，
    // 避免把从未自定义过扁平顺序的老用户的 flat 顺序强制覆盖成默认顺序。
    if (order.length === 0 && key === 'common.navFlatOrder') return
    // @ts-expect-error 补全缺失的导航项（运行时为字符串数组，类型受 NAV_ID_Type 约束）
    updatedSetting.setting[key] = [...order, ...missing]
  }
  patchOrder('common.navOrder')
  patchOrder('common.navFlatOrder')

  // 另外把 navOrder 里存在、navFlatOrder 仍缺失的项再补一次（兼容旧逻辑）。
  const navOrder = updatedSetting.setting['common.navOrder'] as string[] | undefined
  const navFlatOrder = (updatedSetting.setting['common.navFlatOrder'] as string[] | undefined) ?? []
  if (Array.isArray(navOrder) && navOrder.length) {
    const flatSet = new Set(navFlatOrder)
    const missing = navOrder.filter(id => !flatSet.has(id) && NAV_MENUS.some(m => m.id === id))
    if (missing.length) {
      // @ts-expect-error
      updatedSetting.setting['common.navFlatOrder'] = [...navFlatOrder, ...missing]
    }
  }

  // 分组顺序迁移：每个分组补全缺失的当前子项。
  const navGroupOrder = (updatedSetting.setting['common.navGroupOrder'] as Record<string, string[]> | undefined) ?? {}
  let patchedGroupOrder: Record<string, string[]> | null = null
  for (const group of NAV_GROUPS) {
    const saved = navGroupOrder[group.id] ?? []
    if (!Array.isArray(saved)) continue
    const set = new Set(saved)
    const missing = group.children.filter(id => !set.has(id))
    if (missing.length) {
      patchedGroupOrder = patchedGroupOrder ?? { ...navGroupOrder }
      patchedGroupOrder[group.id] = [...saved, ...missing]
    }
  }
  if (patchedGroupOrder) {
    updatedSetting.setting['common.navGroupOrder'] = patchedGroupOrder
  }

  void saveData(storageDataPrefix.setting, updatedSetting.setting)

  return updatedSetting
}
