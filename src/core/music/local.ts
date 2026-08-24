import { saveLyric, saveMusicUrl, getPlayerLyric } from '@/utils/data'
import { updateListMusics } from '@/core/list'
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
import { stat, existsFile, mkdir, writeFile, readDir } from '@/utils/fs'
import { requestStoragePermission } from '@/utils/tools'
import { searchMusic } from '@/utils/musicSdk'
import { toNewMusicInfo } from '@/utils'
import settingState from '@/store/setting/state'
import { btoa } from 'react-native-quick-base64'
import playerState from '@/store/player/state'
import appEvent from '@/event/appEvent'

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
      allOnlineResults.push(...source.list.map(s => toNewMusicInfo(s) as LX.Music.MusicInfoOnline))
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

const downloadWebDAVMusic = async (musicInfo: LX.WebDAV.MusicInfo): Promise<string> => {
  const module = await loadWebDAVModule()
  const { getWebDAVDownloadUrl, updateWebDAVMusicMeta } = module
  const { downloadFile } = await import('@/utils/fs')
  const { readMetadata } = await import('@/utils/localMediaMetadata')
  
  const hasPermission = await requestStoragePermission()
  if (!hasPermission) {
    throw new Error('没有存储权限，无法下载音乐')
  }
  
  const downloadUrl = getWebDAVDownloadUrl(musicInfo)
  
  const webdavPath = settingState.setting['webdav.downloadPath']
  let downloadDir = ''
  if (webdavPath && typeof webdavPath === 'string' && webdavPath.trim()) {
    downloadDir = webdavPath.trim()
  } else {
    const { getWebDAVPrivateDirectory } = await import('@/utils/fs')
    downloadDir = getWebDAVPrivateDirectory()
  }
  
  const fileName = musicInfo.meta.fileName
  
  let filePath = `${downloadDir}/${fileName}`

  if (downloadPromises.has(filePath)) {
    return downloadPromises.get(filePath)!
  }

  if (await existsFile(filePath)) {
    return filePath
  }

  webDAVLog?.info('downloadWebDAVMusic: starting new download', { musicId: musicInfo.id, fileName })
  const downloadPromise = (async () => {
    try {
      await mkdir(downloadDir)

      const username = settingState.setting['sync.webdav.username']
      const password = settingState.setting['sync.webdav.password']
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36',
      }
      if (username && password) {
        headers['Authorization'] = 'Basic ' + btoa(`${username}:${password}`)
      }

      await downloadFile(downloadUrl, filePath, { headers }).promise

      webDAVLog?.info('downloadWebDAVMusic: download completed successfully', { musicId: musicInfo.id, fileName })

      const fileMetadata = await readMetadata(filePath).catch(() => null)
      
      const updates: Record<string, any> = { filePath }
      
      if (fileMetadata) {
        if (fileMetadata.albumName) {
          updates.albumName = fileMetadata.albumName
        }
        if (fileMetadata.name && !musicInfo.name) {
          updates.name = fileMetadata.name
        }
        if (fileMetadata.singer && !musicInfo.singer) {
          updates.singer = fileMetadata.singer
        }
      }
      
      await updateWebDAVMusicMeta(musicInfo.id, updates)

      await readEmbeddedCoverAndSave(musicInfo, filePath, updateWebDAVMusicMeta)

      if (playerState.playMusicInfo.musicInfo?.id === musicInfo.id) {
        const playerAction = await import('@/store/player/action')
        const updatedMusicInfo = { ...playerState.playMusicInfo.musicInfo }
        if (updatedMusicInfo && updatedMusicInfo.meta) {
          updatedMusicInfo.meta.filePath = filePath
        }
        playerAction.default.setPlayMusicInfo(playerState.playMusicInfo.listId, updatedMusicInfo, playerState.playMusicInfo.isTempPlay)
      }

      return filePath
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : ''
      webDAVLog?.error('downloadWebDAVMusic: error occurred', {
        message: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
        errorString: String(error)
      })
      throw error
    } finally {
      downloadPromises.delete(filePath)
    }
  })()

  downloadPromises.set(filePath, downloadPromise)
  return downloadPromise
}

const downloadPromises = new Map<string, Promise<string>>()

const readEmbeddedCoverAndSave = async (
  musicInfo: LX.WebDAV.MusicInfo,
  filePath: string,
  updateWebDAVMetaFn: typeof import('@/core/webdavMusic/drive').updateWebDAVMusicMeta
) => {
  try {
    const picPath = await readPic(filePath)
    if (picPath) {
      const updatedPicUrl = picPath.startsWith('/') ? `file://${picPath}` : picPath
      await updateWebDAVMetaFn(musicInfo.id, { picUrl: updatedPicUrl })

      if (playerState.playMusicInfo.musicInfo?.id === musicInfo.id) {
        global.app_event.picUpdated()
      }
    }
  } catch (error) {
    webDAVLog?.warn('readEmbeddedCoverAndSave: failed to read embedded cover', { error })
  }
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
  if (!isRefresh) {
    const isWebDAV = 'webdav' in musicInfo.meta && (musicInfo.meta as any).webdav === true
    if (isWebDAV) {
      return downloadWebDAVMusic(musicInfo as LX.WebDAV.MusicInfo)
    }

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
      const { picCachePath, readPic: extractPic } = await import('@/utils/localMediaMetadata')
      
      const audioFileName = musicInfo.meta.fileName?.replace(/\.[^/.]+$/, '') || musicInfo.name
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
          targetFilePath = `${downloadDir}/${musicInfo.meta.fileName}`
        }
      } else {
        targetFilePath = `${downloadDir}/${musicInfo.meta.fileName}`
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

  if (isWebDAVMusic) {
    webDAVLog?.info('getPicUrl: WebDAV music has no local cover, return empty (use manual fetch)')
    return ''
  }

  try {
    const result = await getOnlineOtherSourcePicByLocal(musicInfo)
    webDAVLog?.info('getPicUrl: fetched online cover', { url: result.url })
    return result.url
  } catch (err) {
    webDAVLog?.warn('getPicUrl: getOnlineOtherSourcePicByLocal failed', { err })
  }

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
          targetFilePath = `${downloadDir}/${musicInfo.meta.fileName}`
        }
      } else {
        targetFilePath = `${downloadDir}/${musicInfo.meta.fileName}`
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

      onToggleSource()
      return getOtherSourceByLocal(musicInfo, async (otherSource) => {
        return getOnlineOtherSourceLyricInfo({
          musicInfos: [...otherSource],
          onToggleSource,
          isRefresh,
        }).then(async ({ lyricInfo, musicInfo: targetMusicInfo, isFromCache }) => {
          void saveLyric(musicInfo, lyricInfo)
          if (!isFromCache) void saveLyric(targetMusicInfo, lyricInfo)
          return buildLyricInfo(lyricInfo)
        })
      })
    }

    const playerLyricInfo = await getPlayerLyric(musicInfo)
    if (playerLyricInfo?.lyric && playerLyricInfo.rawlrcInfo?.lyric !== playerLyricInfo.lyric) {
    return buildLyricInfo(playerLyricInfo)
    }
    
    const rawlrcInfo = await getMusicFileLyric(musicInfo.meta.filePath)
    if (rawlrcInfo) return buildLyricInfo(rawlrcInfo)

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
