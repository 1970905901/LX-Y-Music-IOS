import { exitApp as utilExitApp } from '@/utils/nativeModules/utils'
import { destroy as destroyPlayer } from '@/plugins/player/utils'
import { initSetting as initAppSetting } from '@/config/setting'
import { setLanguage as applyLanguage } from '@/lang/i18n'

import settingActions from '@/store/setting/action'
import commonActions from '@/store/common/action'
import commonState, { } from '@/store/common/state'
import { type COMPONENT_IDS } from '@/config/constant'

import {
  saveFontSize,
  saveViewPrevState,
} from '@/utils/data'
import { showPactModal as handleShowPactModal } from '@/navigation'

/**
 * 初始化设置
 */
export const initSetting = async() => {
  const setting = (await initAppSetting()).setting
  settingActions.updateSetting(setting)
  return setting
}

/**
 * 更新设置
 * @param setting 新设置
 */
export const updateSetting = (setting: Partial<LX.AppSetting>) => {
  settingActions.updateSetting(setting)
}

export const setLanguage = (locale: Parameters<typeof applyLanguage>[0]) => {
  updateSetting({ 'common.langId': locale })
  global.state_event.languageChanged(locale)
  requestAnimationFrame(() => {
    applyLanguage(locale)
  })
}

let isDestroying = false
export const exitApp = (reason: string) => {
  console.log('Handle Exit App, Reason: ' + reason)
  if (isDestroying) return
  isDestroying = true
  void Promise.all([
    destroyPlayer(),
  ]).finally(() => {
    isDestroying = false
    utilExitApp()
  })
}

export const setFontSize = (size: number) => {
  global.lx.fontSize = size
  commonActions.setFontSize(size)
  void saveFontSize(size)
}

export const setStatusbarHeight = (size: number) => {
  commonActions.setStatusbarHeight(size)
}

export const setSafeAreaBottom = (size: number) => {
  commonActions.setSafeAreaBottom(size)
}

export const setComponentId = (name: COMPONENT_IDS, id: string) => {
  commonActions.setComponentId(name, id)
}
export const removeComponentId = (name: string) => {
  commonActions.removeComponentId(name)
}

export const setNavActiveId = (id: Parameters<typeof commonActions.setNavActiveId>['0']) => {
  if (id == commonState.navActiveId) return
  commonActions.setNavActiveId(id)
  if (id != 'nav_setting' && id != 'nav_play_history') {
    commonActions.setLastNavActiveId(id)
    saveViewPrevState({ id })
  }
}

/**
 * 请求把 Home 的 PagerView 强制同步到当前 navActiveId。
 *
 * 与 setNavActiveId 的区别：**不受同值短路影响**，即使 navActiveId 未变也会重新
 * 广播一次，让 PagerView 的消费方有机会校正原生落点。
 *
 * 使用场景（务必理解，否则会误用）：navActiveId 是 JS 侧状态，PagerView 的当前页
 * 是原生状态，二者正常情况下由 onPageSelected 同步。但在 App 从后台恢复时，iOS 可能
 * 回收/重建 PagerView 的原生子视图，使原生落点回到第 0 页（推荐页），而 navActiveId
 * 仍是后台前的值（如 'nav_top'）。此时界面显示推荐页，用户再点排行榜按钮 →
 * setNavActiveId('nav_top') 被同值短路、事件不发 → PagerView 永不校正 →
 * 「点了没反应」，而该行横向 scroll 是原生的、仍可滑动。
 * 本函数用于「点击后无论 navActiveId 是否变化，都确保 PagerView 落到目标页」。
 */
export const forceSyncNavActiveId = () => {
  global.lx.homePagerForceSync = true
  commonActions.reassertNavActiveId()
}

export const showPactModal = () => {
  handleShowPactModal()
}

export const setBgPic = (pic: string | null) => {
  commonActions.setBgPic(pic)
}
