import { saveLyric, saveMusicUrl, getPlayerLyric } from '@/utils/data'
import {
  buildLyricInfo,
  getCachedLyricInfo,
  getOnlineOtherSourceLyricByLocal,
  getOnlineOtherSourceLyricInfo,
  getOnlineOtherSourceMusicUrl,
  getOnlineOtherSourceMusicUrlByLocal,
  getOnlineOtherSourcePicByLocal,
  getOnlineOtherSourcePicUrl,
  getOtherSource,
} from './utils'
import { getLocalFilePath } from '@/utils/music'
import { readLyric, readPic } from '@/utils/localMediaMetadata'
import { stat, existsFile, readDir, readFile } from '@/utils/fs'
import { searchMusic } from '@/utils/musicSdk'
import { toNewMusicInfo } from '@/utils'
import settingState from '@/store/setting/state'
const appEvent = global.app_event

let webDAVModule: typeof import('@/core/webdavMusic/drive') | null = null
let webDAVLog: {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
} | null = null

const loadWebDAVModule = async () => {
  if (!webDAVModule) {
    webDAVModule = await import('@/core/webdavMusic/drive')
    const logger = await import('@/core/webdavMusic/logger')
    webDAVLog = logger.webDAVLog
  }
  return webDAVModule
}

const getOtherSourceByLocal = async <T>(
  musicInfo: LX.Music.MusicInfoLocal,
  handler: (infos: LX.Music.MusicInfoOnline[]) => Promise<T>
) => {
  let result: LX.Music.MusicInfoOnline[] = []
  
  const tryHandler = async (sources: LX.Music.MusicInfoOnline[]) => {
    if (sources.length) {
      try {
        return await handler(sources)
      } catch {}
    }
    return null
  }

  result = await getOtherSource(musicInfo)
  const handlerResult = await tryHandler(result)
  if (handlerResult !== null) return handlerResult

  if (musicInfo.name.includes('-')) {
    const [name, singer] = musicInfo.name.split('-').map((val) => val.trim())
    result = await getOtherSource(
      {
        ...musicInfo,
        name,
        singer,
      },
      true
    )
    const handlerResult1 = await tryHandler(result)
    if (handlerResult1 !== null) return handlerResult1
    
    result = await getOtherSource(
      {
        ...musicInfo,
        name: singer,
        singer: name,
      },
      true
    )
    const handlerResult2 = await tryHandler(result)
    if (handlerResult2 !== null) return handlerResult2
  }

  let fileName =
    (await stat(musicInfo.meta.filePath).catch(() => ({ name: null }))).name ??
    musicInfo.meta.filePath.split(/\/|\\/).at(-1)
  if (fileName) {
    fileName = fileName.substring(0, fileName.lastIndexOf('.'))
    if (fileName != musicInfo.name) {
      if (fileName.includes('-')) {
        const [name, singer] = fileName.split('-').map((val) => val.trim())
        result = await getOtherSource(
          {
            ...musicInfo,
            name,
            singer,
          },
          true
        )
        const handlerResult3 = await tryHandler(result)
        if (handlerResult3 !== null) return handlerResult3
        
        result = await getOtherSource(
          {
            ...musicInfo,
            name: singer,
            singer: name,
          },
          true
        )
        const handlerResult4 = await tryHandler(result)
        if (handlerResult4 !== null) return handlerResult4
      } else {
        result = await getOtherSource(
          {
            ...musicInfo,
            name: fileName,
            singer: '',
          },
          true
        )
        const handlerResult5 = await tryHandler(result)
        if (handlerResult5 !== null) return handlerResult5
      }
    }
  }

  const fuzzyResults = await searchMusic({ 
    name: musicInfo.name, 
    singer: '', 
    source: '' 
  })
  
  if (fuzzyResults.length > 0) {
    const allOnlineResults: LX.Music.MusicInfoOnline[] = []
    for (const source of fuzzyResults) {
      allOnlineResults.push(...source.list.map((s: any) => toNewMusicInfo(s) as LX.Music.MusicInfoOnline))
    }
    
    const sortedResults = allOnlineResults.sort((a, b) => {
      const name = musicInfo.name.toLowerCase()
      const aMatch = a.name.toLowerCase().includes(name) || name.includes(a.name.toLowerCase())
      const bMatch = b.name.toLowerCase().includes(name) || name.includes(b.name.toLowerCase())
      if (aMatch && !bMatch) return -1
      if (!aMatch && bMatch) return 1
      return 0
    })
    
    const handlerResult6 = await tryHandler(sortedResults)
    if (handlerResult6 !== null) return handlerResult6
  }

  throw new Error('source not found')
}

export const getMusicUrl = async ({
  musicInfo,
  isRefresh,
  allowToggleSource = true,
  onToggleSource = () => {},
}: {
  musicInfo: LX.Music.MusicInfoLocal
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  allowToggleSource?: boolean
}): Promise<string> => {
  const isWebDAV = 'webdav' in musicInfo.meta && (musicInfo.meta as any).webdav === true
  if (isWebDAV) {
    const webDAVMusicInfo = musicInfo as LX.WebDAV.MusicInfo
    // 用户手动下载的文件优先（离线可播）
    if (webDAVMusicInfo.meta.filePath) {
      const localExists = await existsFile(webDAVMusicInfo.meta.filePath).catch(() => false)
      if (localExists) return webDAVMusicInfo.meta.filePath
    }
    // 未下载：整文件预下载到本地缓存后播放（与百度网盘一致）。
    // iOS 的 AVPlayer 无法可靠注入 Authorization/User-Agent，直链流式不稳定，
    // 改用 downloadFile 先下载再播放本地文件；失败即抛错，不走自定义源换源。
    const module = await loadWebDAVModule()
    const localPath = await module.downloadWebDAVMusic(webDAVMusicInfo)
    webDAVLog?.info('getMusicUrl: WebDAV downloaded to local for playback', { musicId: musicInfo.id })
    return localPath
  }

  if (!isRefresh) {
    const path = await getLocalFilePath(musicInfo)
    if (path) return path
  }

  try {
    return await getOnlineOtherSourceMusicUrlByLocal(musicInfo, isRefresh).then(
      ({ url, quality, isFromCache }) => {
        if (!isFromCache) void saveMusicUrl(musicInfo, quality, url)
        return url
      }
    )
  } catch {}

  if (!allowToggleSource) throw new Error('failed')

  onToggleSource()
  return getOtherSourceByLocal(musicInfo, async (otherSource) => {
    return getOnlineOtherSourceMusicUrl({
      musicInfos: [...otherSource],
      onToggleSource,
      isRefresh,
    }).then(({ url, quality: targetQuality, musicInfo: targetMusicInfo, isFromCache }) => {
      // saveLyric(musicInfo, data.lyricInfo)
      if (!isFromCache) void saveMusicUrl(targetMusicInfo, targetQuality, url)

      // TODO: save url ?
      return url
    })
  })
}

export const getPicUrl = async ({
  musicInfo,
  listId,
  isRefresh,
  skipFilePic,
  onToggleSource = () => {},
}: {
  musicInfo: LX.Music.MusicInfoLocal
  listId?: string | null
  isRefresh: boolean
  skipFilePic?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  const isWebDAVMusic = 'webdav' in musicInfo.meta && (musicInfo.meta as any).webdav === true
  
  if (!isRefresh && !skipFilePic) {
    if (isWebDAVMusic) {
      // 网盘内封面文件优先（同目录同名 / 目录通用封面），下载到本地缓存
      try {
        const module = await loadWebDAVModule()
        const picUrl = await module.fetchWebDAVPic(musicInfo as LX.WebDAV.MusicInfo)
        if (picUrl) return picUrl
      } catch (err) {
        webDAVLog?.warn('getPicUrl: fetchWebDAVPic failed', { err })
      }

      const { picCachePath, readPic: extractPic } = await import('@/utils/localMediaMetadata')
      
      const audioFileName = (musicInfo.meta as any).fileName?.replace(/\.[^/.]+$/, '') || musicInfo.name
      const coverExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
      let foundPicUrl = ''
      
      try {
        const coverFiles = await readDir(picCachePath).catch(() => [])
        for (const file of coverFiles) {
          const fileName = file.name || ''
          const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
          const baseName = fileName.substring(0, fileName.lastIndexOf('.'))
          
          if (coverExtensions.includes(ext) && baseName.includes(audioFileName)) {
            foundPicUrl = `file://${picCachePath}/${fileName}`
            break
          }
        }
      } catch (err) {
        webDAVLog?.warn('getPicUrl: failed to read cover cache dir', { err })
      }
      
      if (foundPicUrl) {
        return foundPicUrl
      }
      
      const webdavPath = settingState.setting['webdav.downloadPath']
      let downloadDir = ''
      if (webdavPath && typeof webdavPath === 'string' && webdavPath.trim()) {
        downloadDir = webdavPath.trim()
      } else {
        const { getWebDAVPrivateDirectory } = await import('@/utils/fs')
        downloadDir = getWebDAVPrivateDirectory()
      }
      const audioFilePath = musicInfo.meta.filePath
      let targetFilePath = audioFilePath
      
      if (audioFilePath) {
        const audioExists = await existsFile(audioFilePath).catch(() => false)
        if (!audioExists) {
          targetFilePath = `${downloadDir}/${(musicInfo.meta as any).fileName}`
        }
      } else {
        targetFilePath = `${downloadDir}/${(musicInfo.meta as any).fileName}`
      }
      
      const targetExists = await existsFile(targetFilePath).catch(() => false)
      if (targetExists) {
        try {
          const pic = await extractPic(targetFilePath)
          if (pic) {
            const picUrl = pic.startsWith('/') ? `file://${pic}` : pic
            webDAVLog?.info('getPicUrl: extracted cover from audio', { picUrl })
            
            const module = await loadWebDAVModule()
            void module.updateWebDAVMusicMeta(musicInfo.id, { picUrl })
            
            appEvent.webdavPicUpdated(musicInfo.id, picUrl)
            
            return picUrl
          }
        } catch (err) {
          webDAVLog?.warn('getPicUrl: failed to extract cover', { err })
        }
      } else {
        webDAVLog?.warn('getPicUrl: audio file not found in download dir', { targetFilePath })
      }

      if (musicInfo.meta.picUrl) {
        if (musicInfo.meta.picUrl.startsWith('file://')) {
          const picFilePath = musicInfo.meta.picUrl.replace('file://', '')
          const picExists = await existsFile(picFilePath).catch(() => false)
          if (picExists) {
            webDAVLog?.info('getPicUrl: using cached picUrl', { picUrl: musicInfo.meta.picUrl })
            return musicInfo.meta.picUrl
          }
        } else {
          webDAVLog?.info('getPicUrl: using online picUrl', { picUrl: musicInfo.meta.picUrl })
          return musicInfo.meta.picUrl
        }
      }
      webDAVLog?.info('getPicUrl: no cover found, return empty')
      return ''
    }

    let pic = await readPic(musicInfo.meta.filePath).catch(() => null)        
    if (pic) {
      if (pic.startsWith('/')) pic = `file://${pic}`
      return pic
    }

    if (musicInfo.meta.picUrl) return musicInfo.meta.picUrl
  }

  try {
    const result = await getOnlineOtherSourcePicByLocal(musicInfo)
    webDAVLog?.info('getPicUrl: fetched online cover', { url: result.url })
    return result.url
  } catch (err) {
    webDAVLog?.warn('getPicUrl: getOnlineOtherSourcePicByLocal failed', { err })
  }

  // 云盘（WebDAV）不走自定义源换源，返回空；普通本地音乐走自定义源换源回退
  if (isWebDAVMusic) return ''

  onToggleSource()
  return getOtherSourceByLocal(musicInfo, async (otherSource) => {
    return getOnlineOtherSourcePicUrl({
      musicInfos: [...otherSource],
      onToggleSource,
      isRefresh,
    }).then(async ({ url, musicInfo: targetMusicInfo, isFromCache }) => {
      return url
    })
  })
}

const getMusicFileLyric = async (filePath: string) => {
  const lyric = await readLyric(filePath).catch(() => null)
  if (!lyric) return null
  return {
    lyric,
  }
}

// 读取音频文件同目录的同名 .lrc 歌词（离线可用）
const getSidecarLyric = async (filePath: string): Promise<string | null> => {
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
export const getLyricInfo = async ({
  musicInfo,
  isRefresh,
  skipFileLyric,
  onToggleSource = () => {},
}: {
  musicInfo: LX.Music.MusicInfoLocal
  skipFileLyric?: boolean
  isRefresh: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  const isWebDAVMusic = 'webdav' in musicInfo.meta && (musicInfo.meta as any).webdav === true

  if (!isRefresh && !skipFileLyric) {
    if (isWebDAVMusic) {
      const playerLyricInfo = await getPlayerLyric(musicInfo)
      if (playerLyricInfo?.lyric && playerLyricInfo.rawlrcInfo?.lyric !== playerLyricInfo.lyric) {
      webDAVLog?.info('getLyricInfo: WebDAV music using edited lyric', { musicId: musicInfo.id })
        return buildLyricInfo(playerLyricInfo)
      }

      // 网盘内同名 .lrc 歌词优先（同目录同名匹配）
      try {
        const module = await loadWebDAVModule()
        const lrcText = await module.fetchWebDAVLrc(musicInfo as LX.WebDAV.MusicInfo)
        if (lrcText) {
          webDAVLog?.info('getLyricInfo: WebDAV music using pan lrc', { musicId: musicInfo.id })
          void saveLyric(musicInfo, { lyric: lrcText })
          return buildLyricInfo({ lyric: lrcText })
        }
      } catch (err) {
        webDAVLog?.warn('getLyricInfo: fetchWebDAVLrc failed', { err })
      }

      const lyricInfo = await getCachedLyricInfo(musicInfo)
      if (lyricInfo?.lyric) {
        webDAVLog?.info('getLyricInfo: WebDAV music using cached lyric', { musicId: musicInfo.id })
        return buildLyricInfo(lyricInfo)
      }

      const webdavPath = settingState.setting['webdav.downloadPath']
      let downloadDir = ''
      if (webdavPath && typeof webdavPath === 'string' && webdavPath.trim()) {
        downloadDir = webdavPath.trim()
      } else {
        const { getWebDAVPrivateDirectory } = await import('@/utils/fs')
        downloadDir = getWebDAVPrivateDirectory()
      }
      const audioFilePath = musicInfo.meta.filePath
      let targetFilePath = audioFilePath

      if (audioFilePath) {
        const audioExists = await existsFile(audioFilePath).catch(() => false)
        if (!audioExists) {
          targetFilePath = `${downloadDir}/${(musicInfo.meta as any).fileName}`
        }
      } else {
        targetFilePath = `${downloadDir}/${(musicInfo.meta as any).fileName}`
      }

      const targetExists = await existsFile(targetFilePath).catch(() => false)
      if (targetExists) {
        webDAVLog?.info('getLyricInfo: WebDAV music reading lyric from local file', { targetFilePath })
        const rawlrcInfo = await getMusicFileLyric(targetFilePath)
        if (rawlrcInfo) {
          webDAVLog?.info('getLyricInfo: WebDAV music found embedded lyric', { musicId: musicInfo.id })
          return buildLyricInfo(rawlrcInfo)
        }
      }
      webDAVLog?.info('getLyricInfo: WebDAV music fetching lyric from online source', { musicId: musicInfo.id })
      try {
        return await getOnlineOtherSourceLyricByLocal(musicInfo, isRefresh).then(
          ({ lyricInfo, isFromCache }) => {
            if (!isFromCache) void saveLyric(musicInfo, lyricInfo)
            webDAVLog?.info('getLyricInfo: WebDAV music fetched lyric successfully', { musicId: musicInfo.id })
            return buildLyricInfo(lyricInfo)
          }
        )
      } catch (err) {
        webDAVLog?.warn('getLyricInfo: WebDAV music online lyric fetch failed', { err })
      }

      // 云盘（WebDAV）不走自定义源换源，返回空歌词
      return buildLyricInfo({ lyric: '' })
    }

    const playerLyricInfo = await getPlayerLyric(musicInfo)
    if (playerLyricInfo?.lyric && playerLyricInfo.rawlrcInfo?.lyric !== playerLyricInfo.lyric) {
    return buildLyricInfo(playerLyricInfo)
    }
    
    const rawlrcInfo = await getMusicFileLyric(musicInfo.meta.filePath)
    if (rawlrcInfo) return buildLyricInfo(rawlrcInfo)

    const sidecarLyric = await getSidecarLyric(musicInfo.meta.filePath)
    if (sidecarLyric) return buildLyricInfo({ lyric: sidecarLyric })

    const lyricInfo = await getCachedLyricInfo(musicInfo)
    if (lyricInfo?.lyric) return buildLyricInfo(lyricInfo)
  }

  try {
    return await getOnlineOtherSourceLyricByLocal(musicInfo, isRefresh).then(
      ({ lyricInfo, isFromCache }) => {
        if (!isFromCache) void saveLyric(musicInfo, lyricInfo)
        return buildLyricInfo(lyricInfo)
      }
    )
  } catch {}

  onToggleSource()
  return getOtherSourceByLocal(musicInfo, async (otherSource) => {
    return getOnlineOtherSourceLyricInfo({
      musicInfos: [...otherSource],
      onToggleSource,
      isRefresh,
    }).then(async ({ lyricInfo, musicInfo: targetMusicInfo, isFromCache }) => {
      void saveLyric(musicInfo, lyricInfo)

      if (isFromCache) return buildLyricInfo(lyricInfo)
      void saveLyric(targetMusicInfo, lyricInfo)

      return buildLyricInfo(lyricInfo)
    })
  })
}
