export const HEADER_HEIGHT = 42
export const LIST_ITEM_HEIGHT = 70
export const LIST_SCROLL_POSITION_KEY = '__LIST_SCROLL_POSITION_KEY__'

export const SPLIT_CHAR = {
  DISLIKE_NAME: '@',
  DISLIKE_NAME_ALIAS: '#',
} as const

export const LIST_IDS = {
  DEFAULT: 'default',
  LOVE: 'love',
  TEMP: 'temp',
  DOWNLOAD: 'download',
  PLAY_LATER: null,
} as const


export enum COMPONENT_IDS {
  home = 'home',
  playDetail = 'playDetail',
  songlistDetail = 'songlistDetail',
  comment = 'comment',
  ARTIST_DETAIL = 'ARTIST_DETAIL',
  ALBUM_DETAIL_SCREEN = 'ALBUM_DETAIL_SCREEN',
  DOWNLOAD_MANAGER = 'DOWNLOAD_MANAGER',
  SIMILAR_SONGS_SCREEN = 'SIMILAR_SONGS_SCREEN',
}

export enum NAV_SHEAR_NATIVE_IDS {
  playDetail_pic = 'playDetail_pic',
  playDetail_header = 'playDetail_header',
  playDetail_player = 'playDetail_player',
  songlistDetail_pic = 'songlistDetail_pic',
  songlistDetail_title = 'songlistDetail_title',
}

export const storageDataPrefix = {
  setting: '@setting_v1',
  userList: '@user_list',
  viewPrevState: '@view_prev_state',

  list: '@list__',
  listScrollPosition: '@list_scroll_position',
  listPrevSelectId: '@list_prev_select_id',
  playHistory: '@play_history',

  lyric: '@lyric__',
  musicUrl: '@music_url__',
  musicOtherSource: '@music_other_source__',
  playInfo: '@play_info',

  sync: '@sync_',
  syncAuthKey: '@sync_auth_key',
  syncHost: '@sync_host',
  syncHostHistory: '@sync_host_history',

  openStoragePath: '@open_storage_path',
  selectedManagedFolder: '@selected_managed_folder',
  notificationTipEnable: '@notification_tip_enable',
  ignoringBatteryOptimizationTipEnable: '@ignoring_battery_optimization_tip_enable',

  searchHistoryList: '@search_history_list',
  listUpdateInfo: '@list_update_info',
  ignoreVersion: '@ignore_version',
  ignoreVersionFailTipTimeKey: '@ignore_version_fail_tip_time',
  leaderboardSetting: '@leaderboard_setting',
  songListSetting: '@songist_setting',
  searchSetting: '@search_setting',
  lastSelectQuality: '@last_select_quality',

  fontSize: '@font_size',

  theme: '@theme',

  cheatTip: '@cheat_tip',
  remoteLyricTip: '@remote_lyric_tip',

  dislikeList: '@dislike_list',
  playlistType: '@playlist_type',

  userApi: '@user_api__',
  downloadList: '@download_list',
  wyUidCache: '@wy_uid_cache__',
  similarSongsCache: '@similar_songs_cache',
  localAnnouncementId: '@local_announcement_id',
} as const

export const storageDataPrefixOld = {
  setting: '@setting',
  list: '@list__',
  listPosition: '@listposition__',
  listSort: '@listsort__',
  playInfo: '@play_info',
  syncAuthKey: '@sync_auth_key',
  syncHost: '@sync_host',
  syncHostHistory: '@sync_host_history',
  notificationTipEnable: '@notification_tip_enable',
} as const

export const APP_PROVIDER_NAME = 'com.lxwalnut.music.mobile.provider'

export const NAV_MENUS = [
  { id: 'nav_search', icon: 'search-2' },
  { id: 'nav_love', icon: 'love' },
  { id: 'nav_my_playlist', icon: 'album' },
  { id: 'nav_daily_rec', icon: 'svg:calendar' },
  { id: 'nav_kg_playlist', icon: 'album' },
  { id: 'nav_kg_daily_rec', icon: 'svg:calendar' },
  { id: 'nav_tx_playlist', icon: 'album' },
  { id: 'nav_tx_daily_rec', icon: 'svg:calendar' },
  { id: 'nav_songlist', icon: 'album' },
  { id: 'nav_top', icon: 'leaderboard' },
  { id: 'nav_followed_artists', icon: 'svg:artist' },
  { id: 'nav_subscribed_albums', icon: 'svg:album-disc' },
  { id: 'nav_webdav', icon: 'svg:onedrive' },
  { id: 'nav_onedrive', icon: 'svg:onedrive' },
  { id: 'nav_local_download', icon: 'download-2' },
  { id: 'nav_play_history', icon: 'music_time' },
  { id: 'nav_setting', icon: 'setting' },
] as const

export type NAV_ID_Type = (typeof NAV_MENUS)[number]['id']

export interface NavGroup {
  id: string
  label: string
  icon: string
  children: NAV_ID_Type[]
}

export const NAV_GROUPS: NavGroup[] = [
  { id: 'group_online', label: 'group_online', icon: 'album', children: ['nav_tx_playlist', 'nav_my_playlist', 'nav_kg_playlist', 'nav_followed_artists', 'nav_subscribed_albums'] },
  { id: 'group_daily', label: 'group_daily', icon: 'svg:calendar', children: ['nav_tx_daily_rec', 'nav_daily_rec', 'nav_kg_daily_rec'] },
  { id: 'group_cloud', label: 'group_cloud', icon: 'svg:onedrive', children: ['nav_webdav', 'nav_onedrive'] },
]

/**
 * 扁平模式（关闭侧边栏分组）下的有效导航顺序。
 * 以用户自定义的 navFlatOrder 为主；都没有时回退到 navOrder；再回退到 NAV_MENUS 默认顺序。
 * 最后以 NAV_MENUS 为权威来源，把 base 中缺失的合法菜单项（如后续新增的百度网盘）
 * 追加到末尾，确保老用户持久化的顺序不完整时，侧边栏 / 自定义排序列表 / 播放页 PagerView
 * 三处都不会丢失新增导航项。
 */
export const getEffectiveFlatOrder = (
  navFlatOrder: string[] | undefined | null,
  navOrder: string[] | undefined | null,
): NAV_ID_Type[] => {
  const base: NAV_ID_Type[] =
    Array.isArray(navFlatOrder) && navFlatOrder.length > 0
      ? (navFlatOrder as NAV_ID_Type[])
      : (Array.isArray(navOrder) && navOrder.length > 0 ? (navOrder as NAV_ID_Type[]) : NAV_MENUS.map(m => m.id))
  const allMenuIds = NAV_MENUS.map(m => m.id)
  // 过滤已废弃的菜单 id（如合并前的 nav_download_music / nav_local_music），
  // 避免老用户持久化顺序里的残留项渲染成未知页面
  const validBase = base.filter(id => allMenuIds.includes(id))
  const set = new Set(validBase)
  const extra = allMenuIds.filter(id => !set.has(id))
  return extra.length ? [...validBase, ...extra] : validBase
}

/**
 * 分组模式下某分组的最终子项顺序。
 * 以用户自定义的 navGroupOrder[group.id] 为主，缺失时回退到 group.children。
 * 最后以 group.children 为权威来源，追加保存顺序中缺失的新增子项（如百度网盘），
 * 避免老用户持久化的分组顺序不完整导致侧边栏分组内漏项。
 */
export const getEffectiveGroupChildren = (
  group: NavGroup,
  savedOrder: string[] | undefined | null,
): NAV_ID_Type[] => {
  const base: NAV_ID_Type[] =
    Array.isArray(savedOrder) && savedOrder.length > 0
      ? (savedOrder.filter(id => group.children.includes(id as NAV_ID_Type)) as NAV_ID_Type[])
      : ([...group.children] as NAV_ID_Type[])
  const set = new Set(base)
  const extra = (group.children.filter(id => !set.has(id as NAV_ID_Type)) as NAV_ID_Type[])
  return extra.length ? [...base, ...extra] : base
}

export const LXM_FILE_EXT_RXP = ['json', 'lxmc', 'bin']
export const USER_API_SOURCE_FILE_EXT_RXP = ['js']

export const MUSIC_TOGGLE_MODE = {
  listLoop: 'listLoop',
  random: 'random',
  list: 'list',
  singleLoop: 'singleLoop',
  heartbeat: 'heartbeat',
  none: 'none',
} as const

export const MUSIC_TOGGLE_MODE_LIST = [
  MUSIC_TOGGLE_MODE.listLoop,
  MUSIC_TOGGLE_MODE.random,
  MUSIC_TOGGLE_MODE.list,
  MUSIC_TOGGLE_MODE.singleLoop,
  MUSIC_TOGGLE_MODE.none,
] as const

export const DEFAULT_SETTING = {
  leaderboard: {
    source: 'kw' as LX.OnlineSource,
    boardId: 'kw__16',
  },

  songList: {
    source: 'kw' as LX.OnlineSource,
    sortId: 'new',
    tagName: '',
    tagId: '',
  },

  search: {
    temp_source: 'wy' as LX.OnlineSource,
    source: 'wy' as LX.OnlineSource | 'wy',
    type: 'music' as 'music' | 'songlist' | 'singer' | 'album',
  },

  viewPrevState: {
    id: 'nav_search' as NAV_ID_Type,
  },
}
