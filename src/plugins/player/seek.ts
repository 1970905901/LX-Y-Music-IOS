import TrackPlayer, { State } from 'react-native-track-player'
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
let pendingSeek: { time: number, verify: boolean } | null = null

// verify=false 用于拖动预览的高频轻量 seek：只下发指令，不等待、不校验，
// 避免拖动中每次 seek 都等待+校验重试而打断缓冲，导致音频追不上手指。
// 松手时 setProgress 会发起 verify=true 的权威 seek 兜底到精确位置。
export const seekToTime = async(targetTime: number, verify = true) => {
  if (isSeeking) {
    // 权威 seek（verify=true）不被 pending 中的预览 seek 降级
    pendingSeek = { time: targetTime, verify: pendingSeek?.verify || verify }
    return targetTime
  }
  isSeeking = true

  const runSeek = async() => {
    await TrackPlayer.seekTo(targetTime)
    if (!verify || Platform.OS != 'ios') return targetTime

    // iOS 校验：仅当 seek 完全未生效时才补发一次。若引擎已进入缓冲/连接状态
    // （seek 到未缓存区域时已被接受，正在等待网络数据），绝不能重试——重试会
    // 打断进行中的缓冲并重新发起 Range 请求，音频生效时间翻倍，与已跳转到
    // 目标位置的进度条/歌词脱节（快进快退后不同步的主因）。
    await wait(350)
    const state = await TrackPlayer.getState().catch(() => null)
    if (state == State.Buffering || state == State.Connecting) return targetTime
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
    if (pendingSeek) {
      const next = pendingSeek
      pendingSeek = null
      void seekToTime(next.time, next.verify)
    }
  }

  return targetTime
}
