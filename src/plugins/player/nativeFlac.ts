import { Platform } from 'react-native'
import settingState from '@/store/setting/state'
import {
  getStreamingFlacBufferedPosition,
  getStreamingFlacDuration,
  getStreamingFlacPosition,
  getStreamingFlacPositionStamped,
  getStreamingFlacState,
  isStreamingFlacSupported,
  onStreamingFlacEvent,
  openStreamingFlac,
  pauseStreamingFlac,
  resetStreamingFlac,
  resumeStreamingFlac,
  setStreamingFlacRate,
  setStreamingFlacVolume,
  seekStreamingFlac,
  stopStreamingFlac,
  type StreamingFlacEvent,
} from '@/utils/nativeModules/streamingFlac'
import type { StampedPosition } from './seek'

type NativeFlacState = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'stopped'

type NativeFlacEvent =
  | { type: 'state', state: NativeFlacState, position?: number, duration?: number }
  | { type: 'ended', state?: NativeFlacState, position?: number, duration?: number, success?: boolean }
  | { type: 'warning', message?: string, state?: NativeFlacState, position?: number, duration?: number, code?: number, statusName?: string }
  | { type: 'error', message?: string, state?: NativeFlacState, position?: number, duration?: number }

interface NativeFlacPlaybackContext {
  musicInfo: LX.Player.PlayMusic
  url: string
  quality: LX.Quality | null
}

interface NativeFlacPlaybackSnapshot extends NativeFlacPlaybackContext {
  position: number
  state: NativeFlacState
}

const defaultUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile'

let currentTrackId = ''
let currentState: NativeFlacState = 'idle'
let currentMode: 'none' | 'stream' = 'none'
let currentPlaybackContext: NativeFlacPlaybackContext | null = null

const clearCurrentContext = (nextState: NativeFlacState) => {
  currentTrackId = ''
  currentMode = 'none'
  currentState = nextState
  currentPlaybackContext = null
}

const getMusicInfo = (musicInfo: LX.Player.PlayMusic) => 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
const isRemoteUrl = (url: string) => /^https?:\/\//i.test(url)

export const isNativeFlacPlayerAvailable = () => Platform.OS == 'ios' && isStreamingFlacSupported

const FLAC_QUALITIES = new Set<LX.Quality>(['flac', 'flac24bit', 'hires', 'master', 'atmos', 'atmos_plus'])

export const shouldUseNativeFlacPlayer = async(_musicInfo: LX.Player.PlayMusic, _url: string, quality?: LX.Quality | null) => {
  if (!settingState.setting['player.useNativeFlacPlayer']) return false
  return quality != null && FLAC_QUALITIES.has(quality)
}

export const prefetchNativeFlacPlayback = async(musicInfo: LX.Player.PlayMusic, url: string, quality?: LX.Quality | null) => {
  if (!await shouldUseNativeFlacPlayer(musicInfo, url, quality)) return false
  return isRemoteUrl(url)
}

export const startNativeFlacPlayback = async(musicInfo: LX.Player.PlayMusic, url: string, position: number, autoplay = true, quality: LX.Quality | null = null) => {
  await resetNativeFlacPlayback().catch(() => {})
  const nextTrackId = `nativeflac://${getMusicInfo(musicInfo).id}`
  const playbackContext: NativeFlacPlaybackContext = {
    musicInfo,
    url,
    quality: quality ?? null,
  }

  if (isRemoteUrl(url) && isStreamingFlacSupported) {
    currentTrackId = nextTrackId
    currentMode = 'stream'
    currentState = 'loading'
    try {
      await openStreamingFlac(url, { 'User-Agent': defaultUserAgent }, settingState.setting['player.volume'], settingState.setting['player.playbackRate'], autoplay)
      const seekPosition = position > 0
        ? await seekStreamingFlac(position).catch(() => position)
        : 0
      currentState = autoplay
        ? (seekPosition > 0 ? 'buffering' : 'loading')
        : 'paused'
      currentPlaybackContext = playbackContext
      return {
        position: seekPosition,
        duration: 0,
        trackId: nextTrackId,
      }
    } catch (err) {
      currentTrackId = ''
      currentMode = 'none'
      currentState = 'idle'
      throw err
    }
  }

  throw new Error('Native local FLAC playback is disabled')
}

export const pauseNativeFlacPlayback = async() => {
  if (!currentTrackId) return
  if (currentMode == 'stream') {
    await pauseStreamingFlac().catch(() => {})
  }
  currentState = 'paused'
}

export const resumeNativeFlacPlayback = async() => {
  if (!currentTrackId) return
  if (currentMode == 'stream') {
    await resumeStreamingFlac()
  }
  currentState = 'playing'
}

export const stopNativeFlacPlayback = async(reset = false) => {
  if (!currentTrackId) return
  const trackId = currentTrackId
  const mode = currentMode
  if (currentMode == 'stream') {
    if (reset) await resetStreamingFlac().catch(() => {})
    else await stopStreamingFlac().catch(() => {})
  }
  if (currentTrackId == trackId && currentMode == mode) clearCurrentContext(reset ? 'idle' : 'stopped')
}

export const resetNativeFlacPlayback = async() => {
  const mode = currentMode
  const trackId = currentTrackId

  // 本引擎从未激活（开关关闭 = 全程走 TrackPlayer/AVPlayer）时**什么都不做**：
  // 不再每次换歌都去 call 原生 FLAC 模块 —— 那条 reset 路径会动全 App 的遥控事件状态
  // （endReceivingRemoteControlEvents，见 AppDelegate 的原生注释），属于跨引擎越界。
  if (mode == 'none' && !trackId) return

  if (isStreamingFlacSupported) await resetStreamingFlac().catch(() => {})

  if (currentMode == mode && currentTrackId == trackId) clearCurrentContext('idle')
}

const wait = async(ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const seekNativeFlacPlayback = async(position: number) => {
  if (!currentTrackId) return position
  const trackAtRequest = currentTrackId
  if (currentMode == 'stream') {
    const targetTime = Math.max(0, position)
    await seekStreamingFlac(targetTime).catch(() => {})

    // FLAC streaming decoder resets and re-buffers from the beginning after seek.
    // The native side resolves immediately with the requested position, but actual
    // playback may still be at/before the old position. Wait briefly for the decoder
    // to apply the seek and report a position near the target.
    let lastPosition = targetTime
    let stableCount = 0
    for (const [delay, tolerance] of [
      [80, 2.0],
      [160, 1.2],
      [260, 0.7],
      [420, 0.4],
      [650, 0.22],
      [950, 0.12],
    ] as const) {
      await wait(delay)
      // 【切歌守卫】轮询存续期间用户切歌 = 本次 seek 已作废：立即终止。否则「位置没
      // 收敛且非缓冲」的旧轮询会把旧目标 seek 到新歌上 → 新歌不从头上播放（真机实锤）。
      if (currentTrackId != trackAtRequest) return lastPosition
      const currentPosition = await getStreamingFlacPosition().catch(() => lastPosition)
      const nextPosition = currentPosition > 0 ? currentPosition : lastPosition
      lastPosition = nextPosition

      if (Math.abs(lastPosition - targetTime) <= tolerance) {
        stableCount++
        if (stableCount > 1 || tolerance <= 0.4) break
        continue
      }

      // 【重试重发已移除】未收敛就重发 seekStreamingFlac 会取消在途 seek、重启 range
      // 请求（高码率 FLAC 上反复搅动缓冲），切歌竞态下更是把旧目标打到新歌。未收敛
      // 交由 playing 事件重锚 / 4Hz 位置探针 / 缓冲看门狗自愈，与其它引擎路径一致。
      stableCount = 0
    }

    if (currentTrackId != trackAtRequest) return lastPosition
    const finalPosition = await getStreamingFlacPosition().catch(() => lastPosition)
    lastPosition = finalPosition > 0 ? finalPosition : lastPosition
    return lastPosition
  }
  return position
}

export const getNativeFlacPosition = async() => {
  if (!currentTrackId) return 0
  if (currentMode == 'stream') return getStreamingFlacPosition().catch(() => 0)
  return 0
}

// 带原生时钟戳的位置快照（歌词时钟锚点回放用，修灵动岛/控制中心歌词恒定滞后）：
// null = 拿不到快照/戳（未播放、非流式、桥失败），调用方应退回无戳路径（旧行为）
export const getNativeFlacPositionStamped = async(): Promise<StampedPosition | null> => {
  if (!currentTrackId) return null
  if (currentMode == 'stream') {
    const stamped = await getStreamingFlacPositionStamped().catch(() => null)
    if (!stamped) return null
    return { position: stamped.position, snapshotAt: stamped.snapshotAt, ageMs: 0 }
  }
  return null
}

export const getNativeFlacBufferedPosition = async() => {
  if (!currentTrackId) return 0
  if (currentMode == 'stream') {
    const [buffered, duration] = await Promise.all([
      getStreamingFlacBufferedPosition().catch(() => 0),
      getStreamingFlacDuration().catch(() => 0),
    ])
    if (!duration) return buffered
    return Math.min(buffered, duration)
  }
  return getNativeFlacDuration()
}

export const getNativeFlacDuration = async() => {
  if (!currentTrackId) return 0
  if (currentMode == 'stream') return getStreamingFlacDuration().catch(() => 0)
  return 0
}

export const getNativeFlacState = async() => {
  if (!currentTrackId) return currentState
  if (currentMode == 'stream') {
    currentState = await getStreamingFlacState().catch(() => currentState)
    return currentState
  }
  return currentState
}

export const setNativeFlacVolume = async(volume: number) => {
  if (!currentTrackId) return
  if (currentMode == 'stream') {
    await setStreamingFlacVolume(volume).catch(() => {})
  }
}

export const setNativeFlacRate = async(rate: number) => {
  if (!currentTrackId) return
  if (currentMode == 'stream') {
    await setStreamingFlacRate(rate).catch(() => {})
  }
}

export const isNativeFlacActive = () => !!currentTrackId

export const getNativeFlacTrackId = () => currentTrackId

export const snapshotNativeFlacPlayback = async(): Promise<NativeFlacPlaybackSnapshot | null> => {
  if (!currentTrackId || !currentPlaybackContext) return null
  const [position, state] = await Promise.all([
    getNativeFlacPosition().catch(() => 0),
    getNativeFlacState().catch(() => currentState),
  ])
  return {
    ...currentPlaybackContext,
    position,
    state,
  }
}

export const restoreNativeFlacPlayback = async(snapshot: NativeFlacPlaybackSnapshot) => {
  const shouldAutoplay = !['idle', 'paused', 'stopped'].includes(snapshot.state)
  return startNativeFlacPlayback(snapshot.musicInfo, snapshot.url, snapshot.position, shouldAutoplay, snapshot.quality)
}

export const onNativeFlacPlayerEvent = (listener: (event: NativeFlacEvent) => void) => {
  const subscriptions: Array<() => void> = []

  const removeStreaming = onStreamingFlacEvent((event: StreamingFlacEvent) => {
    if (currentMode != 'stream') return
    switch (event.type) {
      case 'state':
        currentState = event.state
        listener({
          type: 'state',
          state: currentState,
          position: event.position,
          duration: event.duration,
        })
        break
      case 'ended':
        currentState = 'stopped'
        currentTrackId = ''
        currentMode = 'none'
        listener({
          type: 'ended',
          state: 'stopped',
          position: event.position,
          duration: event.duration,
          success: true,
        })
        break
      case 'error':
        currentState = 'paused'
        listener({
          type: 'error',
          message: event.message,
          state: 'paused',
          position: event.position,
          duration: event.duration,
        })
        break
      case 'warning':
        listener({
          type: 'warning',
          message: event.message,
          state: event.state,
          position: event.position,
          duration: event.duration,
          code: event.code,
          statusName: event.statusName,
        })
        break
    }
  })
  subscriptions.push(removeStreaming)

  return () => {
    for (const remove of subscriptions) remove()
  }
}
