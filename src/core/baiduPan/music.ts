import { getPlayerLyric, saveLyric } from '@/utils/data'
import {
  buildLyricInfo,
  getOnlineOtherSourceLyricByLocal,
  getOnlineOtherSourceLyricInfo,
  getOtherSource,
} from '@/core/music/utils'
import { readPic } from '@/utils/localMediaMetadata'
import { existsFile } from '@/utils/fs'
import {
  fetchBaiduPanLrc,
  getBaiduPanLocalFilePath,
  getBaiduPanPlayUrl,
} from './drive'

// 播放：走 dlink 直链流式播放（origin=dlna 免 UA 校验），不再整文件预下载后才播
export const getMusicUrl = async ({
  musicInfo,
  isRefresh,
}: {
  musicInfo: LX.BaiduPan.MusicInfo
  isRefresh: boolean
}): Promise<string> => {
  return getBaiduPanPlayUrl(musicInfo, isRefresh)
}

// 封面：优先取已缓存的 picUrl，其次尝试读取本地已下载文件的内嵌封面
export const getPicUrl = async ({
  musicInfo,
}: {
  musicInfo: LX.BaiduPan.MusicInfo
  isRefresh: boolean
  listId?: string | null
}): Promise<string> => {
  if (musicInfo.meta.picUrl) return musicInfo.meta.picUrl

  try {
    const filePath = getBaiduPanLocalFilePath(musicInfo)
    if (await existsFile(filePath)) {
      const picPath = await readPic(filePath).catch(() => null)
      if (picPath) {
        const picUrl = picPath.startsWith('/') ? `file://${picPath}` : picPath
        // 写回 meta，避免每次播放都重复解析
        musicInfo.meta.picUrl = picUrl
        return picUrl
      }
    }
  } catch {}

  return ''
}

export const getLyricInfo = async ({
  musicInfo,
  isRefresh,
}: {
  musicInfo: LX.BaiduPan.MusicInfo
  isRefresh: boolean
}): Promise<LX.Player.LyricInfo> => {
  const cachedLyric = await getPlayerLyric(musicInfo)
  if (cachedLyric.lyric && !isRefresh) return cachedLyric

  // 1. 网盘内同目录同名 .lrc 歌词（离线场景最可靠）
  try {
    const lrcText = await fetchBaiduPanLrc(musicInfo.meta.filePath)
    if (lrcText) {
      const lyricInfo = { lyric: lrcText }
      void saveLyric(musicInfo, lyricInfo)
      return buildLyricInfo(lyricInfo)
    }
  } catch {}

  // 2. 已下载到本地的文件的内嵌歌词
  try {
    const { readLyric } = await import('@/utils/localMediaMetadata')
    const filePath = getBaiduPanLocalFilePath(musicInfo)
    if (await existsFile(filePath)) {
      const lyric = await readLyric(filePath).catch(() => null)
      if (lyric) {
        const lyricInfo = { lyric }
        void saveLyric(musicInfo, lyricInfo)
        return buildLyricInfo(lyricInfo)
      }
    }
  } catch {}

  // 3. 在线匹配歌词
  try {
    return await getOnlineOtherSourceLyricByLocal(musicInfo, isRefresh).then(
      ({ lyricInfo, isFromCache }) => {
        if (!isFromCache) void saveLyric(musicInfo, lyricInfo)
        return buildLyricInfo(lyricInfo)
      }
    )
  } catch {}

  const otherSource = await getOtherSource(musicInfo, isRefresh)
  if (otherSource.length) {
    const { lyricInfo, musicInfo: targetMusicInfo, isFromCache } =
      await getOnlineOtherSourceLyricInfo({
        musicInfos: [...otherSource],
        onToggleSource() {},
        isRefresh,
      })
    void saveLyric(musicInfo, lyricInfo)
    if (!isFromCache) void saveLyric(targetMusicInfo, lyricInfo)
    return buildLyricInfo(lyricInfo)
  }

  return cachedLyric
}
