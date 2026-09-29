import { parsePlayTime } from '@/utils/common'

const getMusicInterval = (musicInfo: LX.Player.PlayMusic | null | undefined) => {
  if (!musicInfo) return null
  return 'progress' in musicInfo ? musicInfo.metadata.musicInfo.interval : musicInfo.interval
}

export const getMusicIntervalDuration = (musicInfo: LX.Player.PlayMusic | null | undefined) => {
  return parsePlayTime(getMusicInterval(musicInfo))
}

export const getTimelineDuration = (musicInfo: LX.Player.PlayMusic | null | undefined, playerDuration: number) => {
  const intervalDuration = getMusicIntervalDuration(musicInfo)
  // 引擎真实时长优先（有效 > 0 即用）：元数据 interval 可能与实际文件不符——真机实锤
  // （泪海 Hi-Res FLAC）：interval 03:30、文件真实 03:48，旧逻辑对 iOS 在线歌强制用
  // interval → 进度条先走完、播完左侧时间(03:48)大于右侧(03:30)。引擎值无效（≤0，
  // 加载/seek 瞬间可能拿到）才回退元数据时长。
  if (playerDuration && Number.isFinite(playerDuration) && playerDuration > 0) return playerDuration
  return intervalDuration || playerDuration || 0
}
