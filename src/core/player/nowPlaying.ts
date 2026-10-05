import { getPositionStamped, elapsedSnapshotFields } from '@/plugins/player/utils'
import { updateMetaData } from '@/plugins/player'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { pauseNowPlaying, playNowPlaying, reportNowPlayingBridgeFailure, stopNowPlaying } from '@/utils/nativeModules/nowPlaying'

// 带快照时间信息的位置：elapsedTimeSnapshotAt/elapsedTimeAgeMs 随发布透传，
// 原生歌词时钟重锚时据此把锚点回放到快照时刻（修灵动岛/控制中心歌词恒定滞后）
const getElapsedTime = async() => {
  const stamped = await getPositionStamped().catch(() => null)
  if (!stamped) return { elapsedTime: playerState.progress.nowPlayTime }
  return { elapsedTime: stamped.position, ...elapsedSnapshotFields(stamped) }
}

export const syncNowPlayingState = async(type: 'play' | 'pause' | 'stop') => {
  const elapsed = type == 'stop'
    ? { elapsedTime: 0 }
    : await getElapsedTime()

  if (type == 'play') {
    await playNowPlaying({
      ...elapsed,
      playbackRate: settingState.setting['player.playbackRate'],
    }).catch((error) => { reportNowPlayingBridgeFailure('playNowPlaying', error) })
    return
  }

  if (type == 'pause') {
    await pauseNowPlaying({
      ...elapsed,
      playbackRate: 0,
    }).catch((error) => { reportNowPlayingBridgeFailure('pauseNowPlaying', error) })
    return
  }

  await stopNowPlaying({
    ...elapsed,
    playbackRate: 0,
  }).catch((error) => { reportNowPlayingBridgeFailure('stopNowPlaying', error) })
}

export const syncNowPlayingMetadata = (force = false) => {
  if (!playerState.playMusicInfo.musicInfo) return
  void updateMetaData(playerState.musicInfo, playerState.isPlay, playerState.lastLyric, force)
}
