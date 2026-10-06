import { version } from '../../package.json'
import { createAppEventHub } from '@/event/appEvent'
import { createListEventHub } from '@/event/listEvent'
import { createDislikeEventHub } from '@/event/dislikeEvent'
import { createStateEventHub } from '@/event/stateEvent'
if (process.versions == null) {
  // @ts-expect-error
  process.versions = {
    app: version,
  }
} else process.versions.app = version

global.lx = {
  fontSize: 0.9,
  playerStatus: {
    isInitialized: false,
    isRegisteredService: false,
    isIniting: false,
    ignoreTrackPlayerLifecycle: false,
    // 置位时刻（ms）：该标记必须有时间上界，见 engine/index.ts 的
    // shouldIgnoreTrackPlayerLifecycle 注释（残留 = 引擎事件被永久忽略）
    ignoreTrackPlayerLifecycleAtMs: 0,
    userPaused: false,
    suppressUserPaused: false,
  },
  isCarMode: false,

  playerError: false,
  restorePlayInfo: null,

  isScreenKeepAwake: false,

  isPlayedStop: false,

  isEnableLog: true,
  isEnableSyncLog: false,
  isEnableUserApiLog: false,

  playerTrackId: '',

  gettingUrlId: '',

  qualityList: {},
  apis: {},
  apiInitPromise: [Promise.resolve(false), true, () => { }],

  settingActiveId: 'basic',

  homePagerIdle: true,

  // 见 core/common.ts 的 forceSyncNavActiveId()：一次性标记，请求 Home 的 PagerView
  // 强制同步到当前 navActiveId（绕过 setNavActiveId 的同值短路）。
  homePagerForceSync: false,
}

global.app_event = createAppEventHub() as typeof globalThis.app_event
global.list_event = createListEventHub()
global.dislike_event = createDislikeEventHub()
global.state_event = createStateEventHub()
