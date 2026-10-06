import TrackPlayer, { State } from 'react-native-track-player'
import { Platform } from 'react-native'
import { isNativeFlacActive, getNativeFlacState } from '../nativeFlac'
import { UnifiedPlayerEventBus } from './EventBus'
import { createTrackPlayerDriver } from './drivers/trackPlayerDriver'
import { createNativeFlacDriver } from './drivers/nativeFlacDriver'
import type { UnifiedPlaybackState, UnifiedPlayerEvent } from './types'

const bus = new UnifiedPlayerEventBus()

// 「忽略 TrackPlayer 生命周期」标记的时间上界（ms）。
// 该标记在 nativeFlac 接管（resourceLoader）与 reloadConfig 里置位，且都依赖 await 之后的
// finally 复位：任一步挂起（openStream 不返回、快照失败等）就会永久残留 —— 届时
// TrackPlayer 的 state / trackChanged 事件被全部忽略：不发布 nowPlaying（卡片冻结在旧态、
// 按钮方向反、进度条停走）、自动下一首等联动停摆，而音频照播（引擎层不受影响）。
// 与「换源闸门」「初始化粘滞标记」同一类缺陷：任何无限期闸门都必须有时间上界。
const IGNORE_TP_LIFECYCLE_MAX_MS = 30000
let loggedStaleIgnoreLifecycleAt = 0

const shouldIgnoreTrackPlayerLifecycle = () => {
  if (Platform.OS != 'ios') return false
  if (isNativeFlacActive()) return true
  if (!global.lx.playerStatus.ignoreTrackPlayerLifecycle) return false
  const since = global.lx.playerStatus.ignoreTrackPlayerLifecycleAtMs
  if (since > 0 && Date.now() - since > IGNORE_TP_LIFECYCLE_MAX_MS) {
    if (loggedStaleIgnoreLifecycleAt !== since) {
      loggedStaleIgnoreLifecycleAt = since
      console.log(`###LXPlayerGuard### ignoreTrackPlayerLifecycle 超时放行（已 ${Date.now() - since}ms）`)
    }
    return false
  }
  return true
}

const trackPlayerDriver = createTrackPlayerDriver(bus, shouldIgnoreTrackPlayerLifecycle)
const nativeFlacDriver = createNativeFlacDriver(bus)

let isInitialized = false

export const initUnifiedPlayerEngine = () => {
  if (isInitialized) return
  trackPlayerDriver.init()
  nativeFlacDriver.init()
  isInitialized = true
}

export const onUnifiedPlayerEvent = (listener: (event: UnifiedPlayerEvent) => void) => {
  initUnifiedPlayerEngine()
  return bus.on(listener)
}

export const getUnifiedPlaybackState = async(): Promise<UnifiedPlaybackState> => {
  initUnifiedPlayerEngine()
  if (Platform.OS == 'ios' && isNativeFlacActive()) {
    const state = await getNativeFlacState().catch(() => 'idle' as const)
    switch (state) {
      case 'loading':
        return 'loading'
      case 'buffering':
        return 'buffering'
      case 'playing':
        return 'playing'
      case 'paused':
        return 'paused'
      case 'stopped':
        return 'stopped'
      case 'idle':
      default:
        return 'idle'
    }
  }
  const state = await TrackPlayer.getState().catch(() => State.None)
  switch (state) {
    case State.Playing:
      return 'playing'
    case State.Buffering:
      return 'buffering'
    case State.Connecting:
      return 'loading'
    case State.Paused:
      return 'paused'
    case State.Stopped:
      return 'stopped'
    case State.Ready:
      return 'paused'
    case State.None:
    default:
      return 'idle'
  }
}
