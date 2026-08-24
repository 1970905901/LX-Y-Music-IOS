import TrackPlayer from 'react-native-track-player'
import { NativeModules, Platform } from 'react-native'

const NativeTrackPlayerModule = NativeModules.TrackPlayerModule as {
  getPosition?: () => Promise<number>
}

const wait = async(ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const getAccuratePosition = async() => {
  if (Platform.OS == 'ios' && typeof NativeTrackPlayerModule?.getPosition == 'function') {
    return NativeTrackPlayerModule.getPosition()
  }
  return TrackPlayer.getPosition()
}

// 防止用户连续拖动进度条时并发 seek 导致播放器状态混乱
let isSeeking = false
let pendingSeekTime: number | null = null

export const seekToTime = async(targetTime: number) => {
  if (isSeeking) {
    pendingSeekTime = targetTime
    return targetTime
  }
  isSeeking = true

  const runSeek = async() => {
    await TrackPlayer.seekTo(targetTime)
    if (Platform.OS != 'ios') return targetTime

    // iOS 上做少量校验即可，避免原 5 轮循环长时间阻塞/反复 seek 导致拖动无响应。
    await wait(180)
    const currentPosition = await getAccuratePosition().catch(() => targetTime)
    if (currentPosition > 0 && Math.abs(currentPosition - targetTime) > 0.5) {
      await TrackPlayer.seekTo(targetTime)
    }
    return targetTime
  }

  try {
    await runSeek()
  } finally {
    isSeeking = false
    if (pendingSeekTime != null) {
      const next = pendingSeekTime
      pendingSeekTime = null
      void seekToTime(next)
    }
  }

  return targetTime
}
