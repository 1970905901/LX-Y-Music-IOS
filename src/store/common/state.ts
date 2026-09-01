import { type NAV_ID_Type, type COMPONENT_IDS } from '@/config/constant'

export interface InitState {
  fontSize: number
  statusbarHeight: number
  // 底部安全区高度（pt）：Home 指示器 / iPad 底部区域。
  // 底部弹层与列表据此补 paddingBottom，避免最后一行被系统 UI 遮挡。
  safeAreaBottom: number
  componentIds: Array<{ name: COMPONENT_IDS; id: string }>
  navActiveId: NAV_ID_Type
  lastNavActiveId: NAV_ID_Type
  sourceNames: Record<LX.OnlineSource | 'all', string>
  bgPic: string | null
}

const initData = {}

const state: InitState = {
  fontSize: global.lx.fontSize,
  statusbarHeight: 0,
  safeAreaBottom: 0,
  componentIds: [],
  navActiveId: 'nav_love',
  lastNavActiveId: 'nav_love',
  sourceNames: initData as InitState['sourceNames'],
  bgPic: null,
}

export default state
