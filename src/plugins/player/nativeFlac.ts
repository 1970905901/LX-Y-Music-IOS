import { Platform } from 'react-native'
import settingState from '@/store/setting/state'
import { toast } from '@/utils/tools'
import {
  getStreamingFlacBufferedPosition,
  getStreamingFlacDuration,
  getStreamingFlacPosition,
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

const preferredPreciseQualities = new Set<LX.Quality>(['flac', 'flac24bit'])
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

// 这些扩展名是各音源加密格式，原生 StreamingFlac 播放器无法解码，必须走带解密的 TrackPlayer 路径。
// 若把它们交给原生玩家，会出现"界面播放但无声音"的现象。
const ENCRYPTED_AUDIO_EXTENSIONS = new Set([
  'mflac', 'mflac0', 'mgg', 'mgg0', 'mgg1', 'ncm',
  'kgm', 'kgma', 'kgg', 'vpr', 'kwm', 'kwl', 'kwb',
  'kwmv', 'kwac', 'kwring', 'kwshort',
])

const isEncryptedAudioUrl = (url: string): boolean => {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    const ext = pathname.split('.').pop() || ''
    return ENCRYPTED_AUDIO_EXTENSIONS.has(ext)
  } catch {
    return false
  }
}

export const isNativeFlacPlayerAvailable = () => Platform.OS == 'ios' && isStreamingFlacSupported

export const shouldUseNativeFlacPlayer = async(musicInfo: LX.Player.PlayMusic, _url: string, quality?: LX.Quality | null) => {
  if (!isNativeFlacPlayerAvailable()) return false

  // 仅对可直接解码的远程普通 FLAC 使用原生播放器：
  // - 本地文件走 TrackPlayer；
  // - 加密格式（mflac/mgg/ncm/kgm 等）原生播放器无法解码，必须回退到带解密的 TrackPlayer 路径。
  if (!isRemoteUrl(_url) || isEncryptedAudioUrl(_url)) return false

  // 网易云音乐（wy）的无损链接实际为 NCM 加密格式：
  // URL 常以 music.126.net/.../jdymusic/obj/<objKey> 结尾，没有 .flac/.ncm 等扩展名，
  // isEncryptedAudioUrl 按后缀判断会漏掉，交给原生 libFLAC 解码必然失败（无声/失真）。
  // 必须走带解密的 TrackPlayer 路径。
  if (getMusicInfo(musicInfo).source == 'wy') return false

  if (quality != null) return preferredPreciseQualities.has(quality)
  return getMusicInfo(musicInfo).source != 'local' && preferredPreciseQualities.has(settingState.setting['player.playQuality'])
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
      toast(`FLAC调试: openStreamingFlac 抛错：${String((err as any)?.message ?? err)}`, 'long')
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

  if (isStreamingFlacSupported) await resetStreamingFlac().catch(() => {})

  if (currentMode == mode && currentTrackId == trackId) clearCurrentContext('idle')
}

export const seekNativeFlacPlayback = async(position: number) => {
  if (!currentTrackId) return position
  if (currentMode == 'stream') {
    return seekStreamingFlac(position)
  }
  return position
}

export const getNativeFlacPosition = async() => {
  if (!currentTrackId) return 0
  if (currentMode == 'stream') return getStreamingFlacPosition().catch(() => 0)
  return 0
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
        toast(`FLAC调试: 播放结束`, 'long')
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
        toast(`FLAC 播放失败：${event.message ?? '(无错误文案)'}`, 'long')
        listener({
          type: 'error',
          message: event.message,
          state: 'paused',
          position: event.position,
          duration: event.duration,
        })
        break
      case 'warning':
        // 解码告警（如 lost-sync）往往就是"有进度但失真/没声"的直接信号，必须暴露给用户。
        toast(`FLAC 警告：${event.message ?? '(无告警文案)'}`, 'long')
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
