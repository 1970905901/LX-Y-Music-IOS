import { type NAV_ID_Type, type COMPONENT_IDS } from '@/config/constant'

export interface InitState {
  fontSize: number
  statusbarHeight: number
  // 顶部安全区高度（pt）：刘海 / 灵动岛 / iPad 状态栏区域。
  // 列表（ScrollView / FlatList）在 iOS 上会由 RN 自动叠加一份「安全区顶部插图」
  // （automaticallyAdjustContentInsets + RCTContentInsets），固定页头拿不到这份插图，
  // 必须自己补，否则大标题会贴住状态栏（详见 components/common/PageTopInset.tsx）。
  safeAreaTop: number
  // 底部安全区高度（pt）：Home 指示器 / iPad 底部区域。
  // 底部弹层与列表据此补 paddingBottom，避免最后一行被系统 UI 遮挡。
  safeAreaBottom: number
  componentIds: Array<{ name: COMPONENT_IDS, id: string }>
  navActiveId: NAV_ID_Type
  lastNavActiveId: NAV_ID_Type
  sourceNames: Record<LX.OnlineSource | 'all', string>
  bgPic: string | null
}

const initData = {}

const state: InitState = {
  fontSize: global.lx.fontSize,
  statusbarHeight: 0,
  safeAreaTop: 0,
  safeAreaBottom: 0,
  componentIds: [],
  navActiveId: 'nav_discovery',
  lastNavActiveId: 'nav_discovery',
  sourceNames: initData as InitState['sourceNames'],
  bgPic: null,
}

export default state
