import {
  getMusicUrl as getOnlineMusicUrl,
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import { buildLyricInfo, getCachedLyricInfo } from './utils'
import { existsFile, readFile } from '@/utils/fs'

// 读取音频文件同目录的同名 .lrc 歌词（离线可用）
const readSidecarLyric = async (filePath: string): Promise<string | null> => {
  if (!filePath) return null
  const base = filePath.substring(0, filePath.lastIndexOf('.'))
  if (!base) return null
  for (const ext of ['.lrc', '.LRC']) {
    try {
      if (await existsFile(`${base}${ext}`)) {
        const content = await readFile(`${base}${ext}`)
        if (content) return content
      }
    } catch {}
  }
  return null
}

// 兼容 DownloadTask（musicInfo/filePath 在顶层）与旧 ListItem（在 metadata 里）
const getTaskFilePath = (musicInfo: LX.Download.ListItem): string => {
  return (musicInfo as any).filePath ?? (musicInfo as any).metadata?.filePath ?? ''
}

const getTaskMusicInfo = (musicInfo: LX.Download.ListItem): LX.Music.MusicInfoOnline => {
  return (musicInfo as any).musicInfo ?? (musicInfo as any).metadata?.musicInfo
}

export const getMusicUrl = async ({
  musicInfo,
  isRefresh,
  allowToggleSource = true,
  onToggleSource = () => {},
}: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  allowToggleSource?: boolean
}): Promise<string> => {
  // 已下载完成：优先直接播放本地文件（离线可用），失败再走在线
  const filePath = getTaskFilePath(musicInfo)
  if (!isRefresh && musicInfo.status === 'completed' && filePath) {
    try {
      if (await existsFile(filePath)) return filePath
    } catch {}
  }

  return getOnlineMusicUrl({
    musicInfo: getTaskMusicInfo(musicInfo),
    isRefresh,
    onToggleSource,
    allowToggleSource,
  })
}

export const getPicUrl = async ({
  musicInfo,
  isRefresh,
  listId,
  onToggleSource = () => {},
}: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  listId?: string | null
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if (!isRefresh) {
    const onlineMusicInfo = getTaskMusicInfo(musicInfo)
    if (onlineMusicInfo?.meta?.picUrl) return onlineMusicInfo.meta.picUrl
  }

  return getOnlinePicUrl({
    musicInfo: getTaskMusicInfo(musicInfo),
    isRefresh,
    onToggleSource,
  }).then((url) => {
    return url
  })
}

export const getLyricInfo = async ({
  musicInfo,
  isRefresh,
  onToggleSource = () => {},
}: {
  musicInfo: LX.Download.ListItem
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if (!isRefresh) {
    const onlineMusicInfo = getTaskMusicInfo(musicInfo)
    if (onlineMusicInfo) {
      const lyricInfo = await getCachedLyricInfo(onlineMusicInfo)
      if (lyricInfo) return buildLyricInfo(lyricInfo)
    }

    // 下载时写入的同名 .lrc 文件（离线可用）
    const sidecarLyric = await readSidecarLyric(getTaskFilePath(musicInfo))
    if (sidecarLyric) return buildLyricInfo({ lyric: sidecarLyric })
  }

  return getOnlineLyricInfo({
    musicInfo: getTaskMusicInfo(musicInfo),
    isRefresh,
    onToggleSource,
  }).catch(async () => {
    throw new Error('failed')
  })
}
