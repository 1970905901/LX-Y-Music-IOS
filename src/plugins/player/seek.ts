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

// 防止用户连续操作进度条时并发 seek 导致播放器状态混乱
let isSeeking = false
let pendingSeek: { time: number, verify: boolean } | null = null

// 参考 Q-1515/lx-music-mobile ios-adaptation 分支的 seekToTime 实现：
// iOS 下多轮次逐步收紧容差，反复校验并补 seek，直到位置稳定落在目标附近，
// 最后返回实际落点。调用方（playProgress.ts）用该真实位置同步歌词/进度条，
// 避免在线音频 segment/keyframe 对齐导致的“歌词差一行”。
export const seekToTime = async(targetTime: number, verify = true) => {
  if (isSeeking) {
    pendingSeek = { time: targetTime, verify: pendingSeek?.verify || verify }
    return targetTime
  }
  isSeeking = true

  let result = targetTime
  try {
    await TrackPlayer.seekTo(targetTime)
    if (!verify || Platform.OS != 'ios') {
      result = targetTime
    } else {
      let position = targetTime
      let stableCount = 0
      const checks: Array<[number, number]> = [
        [140, 1.2],
        [200, 0.75],
        [280, 0.4],
        [360, 0.22],
        [520, 0.12],
      ]
      for (const [delay, tolerance] of checks) {
        await wait(delay)
        const currentPosition = await getAccuratePosition().catch(() => position)
        const nextPosition = currentPosition > 0 ? currentPosition : position
        position = nextPosition
        if (Math.abs(position - targetTime) <= tolerance) {
          stableCount++
          if (stableCount > 1 || tolerance <= 0.22) break
          continue
        }
        stableCount = 0
        await TrackPlayer.seekTo(targetTime)
      }
      const finalPosition = await getAccuratePosition().catch(() => position)
      position = finalPosition > 0 ? finalPosition : position
      result = position
    }
  } finally {
    isSeeking = false
    if (pendingSeek) {
      const next = pendingSeek
      pendingSeek = null
      void seekToTime(next.time, next.verify)
    }
  }

  return result
}
