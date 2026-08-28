import { getPlayerLyric, saveLyric } from '@/utils/data'
import { buildLyricInfo } from '@/core/music/utils'
import * as localPlay from '@/core/music/localPlay'
import { readPic } from '@/utils/localMediaMetadata'
import { existsFile } from '@/utils/fs'
import {
  fetchBaiduPanLrc,
  getBaiduPanLocalFilePath,
  getBaiduPanPicUrl,
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

// 封面：meta 缓存 → 网盘内封面文件（同名/通用）→ 已下载文件的内嵌封面 → 内置全平台接口回退
export const getPicUrl = async ({
  musicInfo,
  isRefresh,
}: {
  musicInfo: LX.BaiduPan.MusicInfo
  isRefresh: boolean
  listId?: string | null
}): Promise<string> => {
  if (musicInfo.meta.picUrl && !isRefresh) return musicInfo.meta.picUrl

  // 1. 网盘内封面文件（同目录同名 / 目录通用封面）直链
  try {
    const picUrl = await getBaiduPanPicUrl(musicInfo, isRefresh)
    if (picUrl) {
      musicInfo.meta.picUrl = picUrl
      return picUrl
    }
  } catch {}

  // 2. 已下载文件的内嵌封面
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

  // 3. 内置全平台接口回退
  return localPlay.getPicUrl({
    target: {
      name: musicInfo.name,
      singer: musicInfo.singer,
      picUrl: musicInfo.meta.picUrl ?? null,
    },
    isRefresh,
  })
}

// 歌词：网盘同名 .lrc → 本地内嵌 → 内置全平台接口逐平台回退
export const getLyricInfo = async ({
  musicInfo,
  isRefresh,
}: {
  musicInfo: LX.BaiduPan.MusicInfo
  isRefresh: boolean
}): Promise<LX.Player.LyricInfo> => {
  const cachedLyric = await getPlayerLyric(musicInfo)
  if (cachedLyric.lyric && !isRefresh) return cachedLyric

  // 1. 网盘内同目录同名 .lrc 歌词
  try {
    const lrcText = await fetchBaiduPanLrc(musicInfo.meta.filePath)
    if (lrcText) {
      const lyricInfo = { lyric: lrcText }
      void saveLyric(musicInfo, lyricInfo)
      return buildLyricInfo(lyricInfo)
    }
  } catch {}

  // 2. 已下载到本地的文件的内嵌歌词 + 3. 内置全平台回退
  try {
    const lyricInfo = await localPlay.getLyricInfo({
      target: { name: musicInfo.name, singer: musicInfo.singer },
      isRefresh,
    })
    if (lyricInfo?.lyric) {
      void saveLyric(musicInfo, { lyric: lyricInfo.lyric })
      return lyricInfo
    }
  } catch {}

  return cachedLyric
}

