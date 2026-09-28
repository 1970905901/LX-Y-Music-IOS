import state, { type InitState } from './state'
import { type COMPONENT_IDS } from '@/config/constant'

export default {
  setFontSize(size: number) {
    state.fontSize = size
    global.state_event.fontSizeUpdated(size)
  },
  setStatusbarHeight(size: number) {
    if (state.statusbarHeight == size) return
    state.statusbarHeight = size
    global.state_event.statusbarHeightUpdated(size)
  },
  setSafeAreaBottom(size: number) {
    if (state.safeAreaBottom == size) return
    state.safeAreaBottom = size
    global.state_event.safeAreaBottomUpdated(size)
  },
  setComponentId(name: COMPONENT_IDS, id: string) {
    state.componentIds.push({ name, id })
    global.state_event.componentIdsUpdated([...state.componentIds])
  },
  removeComponentId(id: string) {
    const initialLength = state.componentIds.length
    state.componentIds = state.componentIds.filter(item => item.id !== id)
    if (state.componentIds.length < initialLength) {
      global.state_event.componentIdsUpdated([...state.componentIds])
    }
  },
  setNavActiveId(id: InitState['navActiveId']) {
    state.navActiveId = id
    if (id != 'nav_setting' && id != 'nav_play_history') state.lastNavActiveId = id
    global.state_event.navActiveIdUpdated(id)
  },
  /**
   * 在不改变 navActiveId 的前提下，重新广播一次「当前导航 id」。
   *
   * 用途：`setNavActiveId` 有同值短路（id 相同直接 return，不发事件），这本身是
   * 防无谓重渲染的正确设计；但 PagerView 的**原生落点**可能与 navActiveId 失配
   * ——最典型的是 App 从后台恢复：iOS 回收/重建 PagerView 的原生子视图后，原生
   * 落点回到 0（推荐页），而 navActiveId 仍停在后台前的 'nav_top'。此时用户看到
   * 的是推荐页，再点排行榜按钮 → setNavActiveId('nav_top') 被同值短路 → 事件不发
   * → PagerView 不会被校正 → 「点了没反应」（而排行榜那行是原生驱动的横向
   * ScrollView，仍可滑动）。
   *
   * 本方法专供「请求把 PagerView 同步到当前 navActiveId」的场景，绕过同值短路。
   */
  reassertNavActiveId() {
    global.state_event.navActiveIdUpdated(state.navActiveId)
  },
  setLastNavActiveId(id: InitState['navActiveId']) {
    state.lastNavActiveId = id
  },
  setBgPic(pic: string | null) {
    state.bgPic = pic
    global.state_event.bgPicUpdated(pic)
  },
  setSourceNames(names: InitState['sourceNames']) {
    state.sourceNames = names
    global.state_event.sourceNamesUpdated(names)
  },
}
