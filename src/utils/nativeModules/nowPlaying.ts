import { NativeModules, Platform } from 'react-native'

interface NowPlayingInfoMetadata {
  title?: string
  artist?: string
  album?: string
  artwork?: string
  duration?: number
  elapsedTime?: number
  playbackRate?: number
  /** elapsedTime 快照的原生时钟戳（CACurrentMediaTime 毫秒）：歌词时钟重锚回放用，不进系统 info */
  elapsedTimeSnapshotAt?: number
  /** elapsedTime 快照的墙钟年龄（毫秒，无原生戳时的回放补偿），不进系统 info */
  elapsedTimeAgeMs?: number
}

interface NowPlayingStateOptions {
  elapsedTime?: number
  playbackRate?: number
}

export interface NowPlayingLyricLine {
  /** 行起始时间（ms） */
  time: number
  text: string
}

interface NativeNowPlayingModule {
  updateNowPlayingInfo?: (metadata: NowPlayingInfoMetadata) => Promise<void>
  playNowPlaying?: (options?: NowPlayingStateOptions) => Promise<void>
  pauseNowPlaying?: (options?: NowPlayingStateOptions) => Promise<void>
  stopNowPlaying?: (options?: NowPlayingStateOptions) => Promise<void>
  clearNowPlayingInfo?: () => Promise<void>
  setNowPlayingLyrics?: (lines: NowPlayingLyricLine[]) => Promise<void>
  /** 引擎真实位置回传，重锚原生歌词/位置时钟（AppDelegate.mm 的 RCT_REMAP_METHOD 同名导出）。
   * snapshotAtMs：快照的原生时钟戳（CACurrentMediaTime 毫秒，精确回放锚点时刻）；
   * ageMs：快照墙钟年龄（无原生戳时原生以「now − 年龄」回放）。两者都缺省 = 旧行为。 */
  reanchorNowPlayingLyric?: (positionMs: number, snapshotAtMs?: number, ageMs?: number) => Promise<void>
}

const NowPlayingModule = NativeModules.NowPlayingModule as NativeNowPlayingModule | undefined

const hasMethod = <K extends keyof NativeNowPlayingModule>(method: K) => {
  return Platform.OS == 'ios' && typeof NowPlayingModule?.[method] == 'function'
}

export const updateNowPlayingInfo = async(metadata: NowPlayingInfoMetadata) => {
  if (!hasMethod('updateNowPlayingInfo')) return
  return NowPlayingModule?.updateNowPlayingInfo?.(metadata)
}

export const playNowPlaying = async(options: NowPlayingStateOptions = {}) => {
  if (!hasMethod('playNowPlaying')) return
  return NowPlayingModule?.playNowPlaying?.(options)
}

export const pauseNowPlaying = async(options: NowPlayingStateOptions = {}) => {
  if (!hasMethod('pauseNowPlaying')) return
  return NowPlayingModule?.pauseNowPlaying?.(options)
}

export const stopNowPlaying = async(options: NowPlayingStateOptions = {}) => {
  if (!hasMethod('stopNowPlaying')) return
  return NowPlayingModule?.stopNowPlaying?.(options)
}

export const clearNowPlayingInfo = async() => {
  if (!hasMethod('clearNowPlayingInfo')) return
  return NowPlayingModule?.clearNowPlayingInfo?.()
}

/** 歌词时间轴交给原生：原生 NSTimer 直接驱动控制中心歌词（不依赖 JS 定时器） */
export const setNowPlayingLyrics = async(lines: NowPlayingLyricLine[]) => {
  if (!hasMethod('setNowPlayingLyrics')) return
  return NowPlayingModule?.setNowPlayingLyrics?.(lines)
}

/** 引擎真实位置回传：重锚原生歌词/位置时钟（慢速校准 tick 调用）。
 * 时间补偿参数见接口注释——缺失时原生按旧行为把锚点钉在「现在」 */
export const reanchorNowPlayingLyric = async(positionMs: number, snapshotAtMs?: number, ageMs?: number) => {
  if (!hasMethod('reanchorNowPlayingLyric')) return
  return NowPlayingModule?.reanchorNowPlayingLyric?.(positionMs, snapshotAtMs, ageMs)
}
