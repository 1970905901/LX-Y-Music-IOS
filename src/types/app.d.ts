import type { AppEventTypes } from '@/event/appEvent'
import type { ListEventTypes } from '@/event/listEvent'
import type { DislikeEventTypes } from '@/event/dislikeEvent'
import type { StateEventTypes } from '@/event/stateEvent'
import type { I18n } from '@/lang/i18n'
import type { Buffer as _Buffer } from 'buffer'
import type { SettingScreenIds } from '@/screens/Home/Views/Setting'

// interface Process {
//   env: {
//     NODE_ENV: 'development' | 'production'
//   }
//   versions: {
//     app: string
//   }
// }
interface GlobalData {
  fontSize: number
  gettingUrlId: string
  isCarMode: boolean

  playerError: boolean;
  // event_app: AppType
  // event_list: ListType

  playerStatus: {
    isInitialized: boolean
    isRegisteredService: boolean
    isIniting: boolean
    ignoreTrackPlayerLifecycle: boolean
    // 用户主动暂停标记（App 内暂停按钮 / 控制中心 RemotePause）。
    // 用于「返回前台自动播放」判定：true 时回前台不自动恢复，尊重用户意图；
    // 系统音频中断（RemoteDuck）暂停不置此标记。
    userPaused: boolean
    // 系统音频中断（RemoteDuck）暂停前的抑制标志：避免把「被其他 App 打断的暂停」
    // 误判为 userPaused。暂停事件处理时若为 true 则消费并跳过 userPaused 标记。
    suppressUserPaused: boolean
  }
  restorePlayInfo: LX.Player.SavedPlayInfo | null
  isScreenKeepAwake: boolean
  isPlayedStop: boolean
  isEnableLog: boolean
  isEnableSyncLog: boolean
  isEnableUserApiLog: boolean
  playerTrackId: string

  qualityList: LX.QualityList
  apis: Partial<LX.UserApi.UserApiSources>
  apiInitPromise: [Promise<boolean>, boolean, (success: boolean) => void]

  jumpMyListPosition: boolean
  jumpTxPlaylistPosition: boolean
  jumpKgPlaylistPosition: boolean

  settingActiveId: SettingScreenIds

  /**
   * 首页是否正在滚动中，用于防止意外误触播放歌曲
   */
  homePagerIdle: boolean

  // windowInfo: {
  //   screenW: number
  //   screenH: number
  //   fontScale: number
  //   pixelRatio: number
  //   screenPxW: number
  //   screenPxH: number
  // }

  // syncKeyInfo: LX.Sync.KeyInfo
}
interface Artist {
  id: string | number;
  name: string;
}
declare global {
  var isDev: boolean
  var lx: GlobalData
  var i18n: I18n
  var app_event: AppEventTypes & {
    emit: (eventName: string, ...args: any[]) => void;
    changeHomePageScrollEnabled: (enabled: boolean) => void;
    showArtistSelector: (artists: Artist[], onSelect: (artist: Artist) => void) => void;
    triggerSearch: (text: string) => void;
    'wy-cookie-set': (cookie: string) => void
    'tx-cookie-set': (cookie: string) => void
    'yt-cookie-set': (cookie: string) => void
    showWebLogin: () => void
    showTxWebLogin: () => void
    showKgWebLogin: () => void
    showYouTubeLogin: () => void
    showVideoPlayer: (url: string) => void
  }
  var list_event: ListEventTypes
  var dislike_event: DislikeEventTypes
  var state_event: StateEventTypes

  var Buffer: typeof _Buffer

  module NodeJS {
    interface ProcessVersions {
      app: string
    }
  }
  // var process: Process
}
