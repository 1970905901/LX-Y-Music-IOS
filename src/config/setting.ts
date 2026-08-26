import { storageDataPrefix, storageDataPrefixOld, NAV_MENUS } from '@/config/constant'
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

  // 扁平模式顺序补全：把 navOrder 中新增、但用户已有 navFlatOrder 缺失的菜单项追加到末尾。
  // 修复「后加的导航项（如百度网盘）在关闭分组后从侧边栏 / 自定义排序列表 / 播放页 PagerView 消失」的迁移缺口。
  const navOrder = updatedSetting.setting['common.navOrder'] as string[] | undefined
  const navFlatOrder = (updatedSetting.setting['common.navFlatOrder'] as string[] | undefined) ?? []
  if (Array.isArray(navOrder) && navOrder.length) {
    const flatSet = new Set(navFlatOrder)
    const missing = navOrder.filter(id => !flatSet.has(id) && NAV_MENUS.some(m => m.id === id))
    if (missing.length) {
      // @ts-expect-error 补全缺失的扁平导航项（运行时为字符串数组，类型受 NAV_ID_Type 约束）
      updatedSetting.setting['common.navFlatOrder'] = [...navFlatOrder, ...missing]
    }
  }

  void saveData(storageDataPrefix.setting, updatedSetting.setting)

  return updatedSetting
}
