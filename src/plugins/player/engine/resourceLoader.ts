import TrackPlayer from 'react-native-track-player'
import { Platform } from 'react-native'
import { toast } from '@/utils/tools'
import {
  getNativeFlacTrackId,
  resetNativeFlacPlayback,
  shouldUseNativeFlacPlayer,
  startNativeFlacPlayback,
} from '../nativeFlac'
import {
  clearTracks,
  ensureCurrentTrackMetadata,
  loadTrackPlayerResource,
} from '../trackPlayerCore'

const resolveShouldAutoStart = (currentTrackIndex: number | null) => {
  if (currentTrackIndex != null) return true
  if (!global.lx.restorePlayInfo) return true
  global.lx.restorePlayInfo = null
  return false
}

export const loadPlaybackResource = async({
  musicInfo,
  url,
  time,
  quality,
}: {
  musicInfo: LX.Player.PlayMusic
  url: string
  time: number
  quality?: LX.Quality | null
}) => {
  const currentTrackIndex = await TrackPlayer.getCurrentTrack()
  const shouldAutoStart = resolveShouldAutoStart(currentTrackIndex)

  // FLAC 调试：仅对 FLAC 相关播放上下文提示，避免打扰普通音质。
  const qualityStr = String(quality ?? '')
  const isFlacContext = qualityStr === 'flac' || qualityStr === 'flac24bit' || /flac/i.test(url)
  const useNativeFlac = Platform.OS == 'ios' && await shouldUseNativeFlacPlayer(musicInfo, url, quality)
  if (isFlacContext) {
    toast(`FLAC调试: 原生路径=${useNativeFlac} quality=${qualityStr} url=${url.slice(0, 100)}`, 'long')
  }

  if (useNativeFlac) {
    global.lx.playerStatus.ignoreTrackPlayerLifecycle = true
    try {
      await TrackPlayer.reset().catch(async() => {
        await TrackPlayer.stop().catch(() => {})
      })
      clearTracks()
      const playbackInfo = await startNativeFlacPlayback(musicInfo, url, time, shouldAutoStart, quality ?? null)
      global.lx.playerTrackId = getNativeFlacTrackId()
      ensureCurrentTrackMetadata({
        title: ('progress' in musicInfo ? musicInfo.metadata.musicInfo.name : musicInfo.name) ?? 'Unknow',
        artist: ('progress' in musicInfo ? musicInfo.metadata.musicInfo.singer : musicInfo.singer) ?? 'Unknow',
        album: ('progress' in musicInfo ? musicInfo.metadata.musicInfo.meta.albumName : musicInfo.meta.albumName) ?? undefined,
        artwork: 'progress' in musicInfo
          ? (typeof musicInfo.metadata.musicInfo.meta.picUrl == 'string' ? musicInfo.metadata.musicInfo.meta.picUrl : undefined)
          : (typeof musicInfo.meta.picUrl == 'string' ? musicInfo.meta.picUrl : undefined),
        duration: playbackInfo.duration,
        elapsedTime: playbackInfo.position,
      })
      return
    } catch (err) {
      // 原生 FLAC 播放器不可用或启动失败（例如非远程/加密格式、原生模块异常）：
      // 不抛出，回退到下方标准 TrackPlayer 路径，避免"播放但无声音/卡死"。
      const errMsg = String((err as any)?.message ?? err)
      toast(`FLAC调试: 原生启动失败→回退TrackPlayer：${errMsg}`, 'long')
      console.warn('[FLAC] 原生 FLAC 播放失败，回退到 TrackPlayer:', err)
      await resetNativeFlacPlayback().catch(() => {})
    } finally {
      global.lx.playerStatus.ignoreTrackPlayerLifecycle = false
    }
  }

  if (Platform.OS == 'ios') {
    await resetNativeFlacPlayback().catch(() => {})
  }

  const track = await loadTrackPlayerResource(musicInfo, url, time, shouldAutoStart)
  ensureCurrentTrackMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: typeof track.artwork == 'string' ? track.artwork : undefined,
    duration: track.duration,
    elapsedTime: time,
  })
}

