import { getPlayerLyric, saveLyric } from '@/utils/data'
import {
  buildLyricInfo,
  getOnlineOtherSourceLyricByLocal,
  getOnlineOtherSourceLyricInfo,
  getOtherSource,
} from '@/core/music/utils'
import { downloadBaiduPanMusic } from './drive'

export const getMusicUrl = async ({
  musicInfo,
  isRefresh,
}: {
  musicInfo: LX.BaiduPan.MusicInfo
  isRefresh: boolean
}): Promise<string> => {
  return downloadBaiduPanMusic(musicInfo, isRefresh)
}

export const getPicUrl = async ({
  musicInfo,
}: {
  musicInfo: LX.BaiduPan.MusicInfo
  isRefresh: boolean
  listId?: string | null
}): Promise<string> => {
  return musicInfo.meta.picUrl ?? ''
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
