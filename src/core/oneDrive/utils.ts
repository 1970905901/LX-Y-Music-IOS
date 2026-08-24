export const isOneDriveMusicInfo = (
  musicInfo?: LX.Music.MusicInfo | LX.Download.ListItem | null
) => {
  if (!musicInfo) return false
  const info = 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
  return info.source === 'local' && !!(info.meta as Partial<LX.OneDrive.MusicInfo['meta']>).oneDrive
}
