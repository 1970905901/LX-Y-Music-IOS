import TrackPlayer from 'react-native-track-player'
import { Platform } from 'react-native'
import settingState from '@/store/setting/state'
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

  if (Platform.OS == 'ios' && await shouldUseNativeFlacPlayer(musicInfo, url, quality)) {
    global.lx.playerStatus.ignoreTrackPlayerLifecycle = true
    try {
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
          playbackRate: settingState.setting['player.playbackRate'],
        })
        return
      } catch (err) {
        // nativeFlac 打开失败（本地文件被禁用 / 远程流打开失败 / 原生桥不可用）：
        // 回退 AVPlayer 播放同一资源——AVPlayer 承载所有音质，是全音质兜底路径，
        // 不让高音质 + 开关开时的 native 故障演变成整次播放失败。此时 TrackPlayer
        // 已被 reset、tracks 已清空，正好是 loadTrackPlayerResource 的标准前置
        // （正常 AVPlayer 换歌同样先 reset/clearTracks 再装载），从干净状态重建即可。
        await resetNativeFlacPlayback().catch(() => {})
        console.warn('nativeFlac open failed, fallback to AVPlayer:', err instanceof Error ? err.message : err)
      }
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

