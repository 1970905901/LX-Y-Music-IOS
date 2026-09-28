import TrackPlayer from 'react-native-track-player'
import { NativeModules, Platform } from 'react-native'

const NativeTrackPlayerModule = NativeModules.TrackPlayerModule as {
  getPosition?: () => Promise<number>
}

const wait = async(ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// 带快照时间信息的位置：歌词时钟锚点回放（修灵动岛/控制中心歌词恒定滞后）用。
// - snapshotAt：快照的原生时钟戳（CACurrentMediaTime 毫秒），0 = 无原生戳；
// - ageMs：发起 getPosition 到「快照产生」的墙钟偏移估计（往返半程）。调用方在
//   发起重锚前用它推算快照的当前年龄：age = 已流逝总时长 − ageMs。
// AVPlayer 路径的原生桥（TrackPlayerModule，RNTP 定制）在 node_modules 内无法
// 打原生戳，用年龄补偿：快照产生于桥接往返中点附近（对称假设），原生侧以
// 「now − 年龄」回放锚点（残余 ≈ reanchor 单程，远小于旧行为的整段往返滞后）。
export interface StampedPosition {
  position: number
  snapshotAt: number
  ageMs: number
}

export const getAccuratePosition = async() => {
  if (Platform.OS == 'ios' && typeof NativeTrackPlayerModule?.getPosition == 'function') {
    return NativeTrackPlayerModule.getPosition()
  }
  return TrackPlayer.getPosition()
}

export const getAccuratePositionStamped = async(): Promise<StampedPosition> => {
  const startedAt = Date.now()
  const position = await getAccuratePosition()
  return { position, snapshotAt: 0, ageMs: (Date.now() - startedAt) / 2 }
}

export const seekToTime = async(targetTime: number) => {
  await TrackPlayer.seekTo(targetTime)
  if (Platform.OS != 'ios') return targetTime

  let position = targetTime
  let stableCount = 0
  for (const [delay, tolerance] of [
    [140, 1.2],
    [200, 0.75],
    [280, 0.4],
    [360, 0.22],
    [520, 0.12],
  ] as const) {
    await wait(delay)
    const currentPosition = await getAccuratePosition().catch(() => position)
    const nextPosition = currentPosition > 0 ? currentPosition : position
    // eslint-disable-next-line require-atomic-updates
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
  // eslint-disable-next-line require-atomic-updates
  position = finalPosition > 0 ? finalPosition : position
  return position
}
