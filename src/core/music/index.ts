import {
  getMusicUrl as getOnlineMusicUrl,
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import {
  getMusicUrl as getLocalMusicUrl,
  getPicUrl as getLocalPicUrl,
  getLyricInfo as getLocalLyricInfo,
} from './local'
import {
  getMusicUrl as getOneDriveMusicUrl,
  getPicUrl as getOneDrivePicUrl,
  getLyricInfo as getOneDriveLyricInfo,
} from '@/core/oneDrive/music'
import {
  getMusicUrl as getBaiduPanMusicUrl,
  getPicUrl as getBaiduPanPicUrl,
  getLyricInfo as getBaiduPanLyricInfo,
} from '@/core/baiduPan/music'
import * as localPlay from './localPlay'
import { handleGetOnlinePicUrl } from './utils'
import { webDAVLog } from '@/core/webdavMusic/logger'

export { handleGetOnlinePicUrl }

// 「本地与下载」专用链路：不走自定义源管理，本地文件优先 + 内置平台直连回退
const getTaskTarget = (musicInfo: LX.Download.ListItem): localPlay.LocalPlayTarget => {
  const task = musicInfo as any
  const inner = task.musicInfo ?? task.metadata?.musicInfo
  return {
    name: inner?.name ?? '',
    singer: inner?.singer ?? '',
    filePath: task.filePath ?? task.metadata?.filePath ?? '',
    picUrl: inner?.meta?.picUrl ?? null,
    quality: 'quality' in musicInfo ? (musicInfo as any).quality : undefined,
  }
}

export const getMusicUrl = async ({
  musicInfo,
  quality,
  isRefresh = false,
  onToggleSource,
  allowToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  quality?: LX.Quality
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  allowToggleSource?: boolean
}): Promise<string> => {
  webDAVLog.info('index.ts: getMusicUrl called', {
    isDownload: 'progress' in musicInfo,
    source: 'source' in musicInfo ? musicInfo.source : 'N/A',
    musicId: 'id' in musicInfo ? musicInfo.id : 'N/A',
  })
  if ('progress' in musicInfo) {
    return localPlay.getMusicUrl({ target: getTaskTarget(musicInfo), isRefresh })
  } else if (musicInfo.source == 'local') {
    if ('oneDrive' in musicInfo.meta) {
      return getOneDriveMusicUrl({ musicInfo: musicInfo as LX.OneDrive.MusicInfo, isRefresh })
    }
    if ('baidupan' in musicInfo.meta) {
      return getBaiduPanMusicUrl({ musicInfo: musicInfo as LX.BaiduPan.MusicInfo, isRefresh })
    }
    if ('webdav' in musicInfo.meta && (musicInfo.meta as any).webdav) {
      webDAVLog.info('index.ts: Detected WebDAV music', { source: musicInfo.source, meta: JSON.stringify(musicInfo.meta) })
      return getLocalMusicUrl({ musicInfo, isRefresh, onToggleSource, allowToggleSource })
    }
    // 普通本地音乐：走本地播放接口（本地文件优先 + 内置平台回退）
    return localPlay.getMusicUrl({
      target: {
        name: musicInfo.name,
        singer: musicInfo.singer,
        filePath: (musicInfo.meta as any).filePath,
        picUrl: (musicInfo.meta as any).picUrl ?? null,
      },
      isRefresh,
    })
  } else if (musicInfo.source == 'qs') {
    // 汽水音乐：本地无文件，走「其他源匹配」播放（用歌名+歌手在线搜索其他平台）
    return localPlay.getMusicUrl({
      target: {
        name: musicInfo.name,
        singer: musicInfo.singer,
        filePath: '',
        picUrl: (musicInfo as any).img ?? null,
      },
      isRefresh,
    })
  } else {
    return getOnlineMusicUrl({ musicInfo, isRefresh, quality, onToggleSource, allowToggleSource })
  }
}

export const getPicPath = async ({
  musicInfo,
  isRefresh = false,
  listId,
  onToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  listId?: string | null
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  if ('progress' in musicInfo) {
    return localPlay.getPicUrl({ target: getTaskTarget(musicInfo), isRefresh })
  } else if (musicInfo.source == 'local') {
    if ('oneDrive' in musicInfo.meta) {
      return getOneDrivePicUrl({ musicInfo: musicInfo as LX.OneDrive.MusicInfo, isRefresh, listId })
    }
    if ('baidupan' in musicInfo.meta) {
      return getBaiduPanPicUrl({ musicInfo: musicInfo as LX.BaiduPan.MusicInfo, isRefresh, listId })
    }
    if ('webdav' in musicInfo.meta && (musicInfo.meta as any).webdav) {
      return getLocalPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
    }
    return localPlay.getPicUrl({
      target: {
        name: musicInfo.name,
        singer: musicInfo.singer,
        filePath: (musicInfo.meta as any).filePath,
        picUrl: (musicInfo.meta as any).picUrl ?? null,
      },
      isRefresh,
    })
  } else if (musicInfo.source == 'qs') {
    // 汽水音乐封面：优先用歌单里带出的封面，否则走「其他源匹配」在线获取
    return localPlay.getPicUrl({
      target: {
        name: musicInfo.name,
        singer: musicInfo.singer,
        filePath: '',
        picUrl: (musicInfo as any).img ?? null,
      },
      isRefresh,
    })
  } else {
    return getOnlinePicUrl({ musicInfo, isRefresh, listId, onToggleSource })
  }
}

export const getLyricInfo = async ({
  musicInfo,
  isRefresh = false,
  onToggleSource,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  if ('progress' in musicInfo) {
    return localPlay.getLyricInfo({ target: getTaskTarget(musicInfo), isRefresh })
  } else if (musicInfo.source == 'local') {
    if ('oneDrive' in musicInfo.meta) {
      return getOneDriveLyricInfo({ musicInfo: musicInfo as LX.OneDrive.MusicInfo, isRefresh })
    }
    if ('baidupan' in musicInfo.meta) {
      return getBaiduPanLyricInfo({ musicInfo: musicInfo as LX.BaiduPan.MusicInfo, isRefresh })
    }
    if ('webdav' in musicInfo.meta && (musicInfo.meta as any).webdav) {
      return getLocalLyricInfo({ musicInfo, isRefresh, onToggleSource })
    }
    return localPlay.getLyricInfo({
      target: {
        name: musicInfo.name,
        singer: musicInfo.singer,
        filePath: (musicInfo.meta as any).filePath,
        picUrl: (musicInfo.meta as any).picUrl ?? null,
      },
      isRefresh,
    })
  } else if (musicInfo.source == 'qs') {
    // 汽水音乐歌词：走「其他源匹配」在线获取
    return localPlay.getLyricInfo({
      target: {
        name: musicInfo.name,
        singer: musicInfo.singer,
        filePath: '',
        picUrl: (musicInfo as any).img ?? null,
      },
      isRefresh,
    })
  } else {
    return getOnlineLyricInfo({ musicInfo, isRefresh, onToggleSource })
  }
}
