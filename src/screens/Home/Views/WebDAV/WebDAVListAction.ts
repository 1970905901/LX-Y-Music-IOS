import { findMusic } from '@/utils/musicSdk'
import { getWebDAVConfig, updateWebDAVMusicMeta, getWebDAVDownloadUrl, saveWebDAVConfig } from '@/core/webdavMusic/drive'
import { downloadFile, existsFile, mkdir, getWebDAVPrivateDirectory } from '@/utils/fs'
import { toast, clipboardWriteText, requestStoragePermission } from '@/utils/tools'
import settingState from '@/store/setting/state'
import playerState from '@/store/player/state'
import { btoa } from 'react-native-quick-base64'
import { updateListMusics, addListMusics } from '@/core/list'
import { webDAVLog } from '@/core/webdavMusic/logger'
import { readPic, readMetadata } from '@/utils/localMediaMetadata'
import { getPicPath, handleGetOnlinePicUrl } from '@/core/music'
import { LIST_IDS } from '@/config/constant'
import { toOldMusicInfo } from '@/utils'
import musicSdk from '@/utils/musicSdk'

const getAuthHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36',
  }
  const username = settingState.setting['sync.webdav.username']
  const password = settingState.setting['sync.webdav.password']
  if (username && password) {
    headers['Authorization'] = 'Basic ' + btoa(`${username}:${password}`)
  }
  return headers
}

const parsePathForName = (filePath: string) => ({
  ext: filePath.split('.').pop()?.toLowerCase() || '',
  nameWithoutExt: filePath.substring(0, filePath.lastIndexOf('.')),
  fileName: filePath.split('/').pop() || '',
})

const chunk = <T>(arr: T[], size: number): T[][] => {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

export const handleWebDAVBatchDownload = async (
  songs: LX.WebDAV.MusicInfo[],
  onProgress?: (current: number, total: number, currentSong: string) => void
): Promise<string[]> => {
  const hasPermission = await requestStoragePermission()
  if (!hasPermission) {
    toast('请授予存储权限后重试', 'long')
    return []
  }

  const downloadDir = getDefaultDownloadDir()
  const downloadedPaths: string[] = []
  
  webDAVLog.info('handleWebDAVBatchDownload: starting batch download', { songCount: songs.length })
  
  try {
    await mkdir(downloadDir)
    
    const headers = getAuthHeaders()
    
    let currentIndex = 0
    for (const musicInfo of songs) {
      currentIndex++
      const fileName = musicInfo.meta.fileName
      const filePath = `${downloadDir}/${fileName}`
      
      if (onProgress) {
        onProgress(currentIndex, songs.length, fileName)
      }

      const fileExists = await existsFile(filePath)

      if (musicInfo.meta.filePath && !fileExists) {
        webDAVLog.info('handleWebDAVBatchDownload: file was deleted, clearing old filePath', { oldPath: musicInfo.meta.filePath })
        await updateWebDAVMusicMeta(musicInfo.id, { filePath: undefined })
      }

      if (fileExists) {
        webDAVLog.info('handleWebDAVBatchDownload: file already exists, skipping', { filePath })
        downloadedPaths.push(filePath)

        await updateWebDAVMusicMeta(musicInfo.id, { filePath })
        continue
      }
      
      try {
        const downloadUrl = getWebDAVDownloadUrl(musicInfo)
        webDAVLog.info('handleWebDAVBatchDownload: downloading', { currentIndex, fileName, downloadUrl })
        
        await downloadFile(downloadUrl, filePath, { headers }).promise

        const fileMetadata = await readMetadata(filePath).catch(() => null)
        
        const updates: Record<string, any> = { filePath }
        
        if (fileMetadata) {
          if (fileMetadata.albumName) updates.albumName = fileMetadata.albumName
          if (fileMetadata.name && !musicInfo.name) updates.name = fileMetadata.name
          if (fileMetadata.singer && !musicInfo.singer) updates.singer = fileMetadata.singer
        }

        await updateWebDAVMusicMeta(musicInfo.id, updates)

        const picPath = await readPic(filePath).catch(() => null)
        if (picPath) {
          const newPicUrl = picPath.startsWith('/') ? `file://${picPath}` : picPath
          await updateWebDAVMusicMeta(musicInfo.id, { picUrl: newPicUrl })
        }
        
        downloadedPaths.push(filePath)
        webDAVLog.info('handleWebDAVBatchDownload: download completed', { currentIndex, fileName, filePath })
      } catch (error: any) {
        webDAVLog.error('handleWebDAVBatchDownload: download failed', { fileName, error: error.message })
      }
    }
    
    webDAVLog.info('handleWebDAVBatchDownload: batch download completed', { downloadedCount: downloadedPaths.length })
    return downloadedPaths
  } catch (error: any) {
    webDAVLog.error('handleWebDAVBatchDownload: batch download failed', { error: error.message })
    throw error
  }
}

export const handleWebDAVDownloadAndImport = async (
  songs: LX.WebDAV.MusicInfo[],
  setLoadingText: (text: string) => void
): Promise<void> => {
  if (songs.length === 0) {
    toast('没有可下载的歌曲')
    return
  }
  
  setLoadingText(`正在下载 0/${songs.length}...`)
  webDAVLog.info('handleWebDAVDownloadAndImport: starting process', { songCount: songs.length })

  try {
    const downloadedPaths = await handleWebDAVBatchDownload(songs, (current, total, fileName) => {
      setLoadingText(`正在下载 ${current}/${total}...\n${fileName}`)
    })
    
    if (downloadedPaths.length === 0) {
      toast('没有成功下载任何歌曲')
      return
    }
    
    webDAVLog.info('handleWebDAVDownloadAndImport: download completed', { downloadedCount: downloadedPaths.length })

    const files = downloadedPaths.map(path => {
      const name = path.split('/').pop() || ''
      return { path, name } as any
    })
    
    setLoadingText('正在添加到列表...')
    await addListMusics(
      LIST_IDS.DOWNLOAD,
      files.map(buildLocalMusicInfoByFilePath),
      settingState.setting['list.addMusicLocationType']
    )

    toast(global.i18n.t('list_select_local_file_temp_add_tip', { total: files.length }), 'long')

    setLoadingText('正在读取音乐标签...')

    const createLocalMusicInfos = async (
      filePaths: string[],
      errorPath: string[]
    ): Promise<LX.Music.MusicInfoLocal[]> => {
      const list: LX.Music.MusicInfoLocal[] = []
      for (const batch of chunk(filePaths, 5)) {
        const results = await Promise.all(
          batch.map(async (path) => {
            const info = await readMetadata(path)
            const picPath = await readPic(path).catch(() => null)
            return { path, info, picPath }
          }),
        )
        for (const { path, info, picPath } of results) {
          if (!info) {
            errorPath.push(path)
            continue
          }
          list.push(buildLocalMusicInfo(path, info, picPath))
        }
      }
      return list
    }
    
    const createThrottleAddMusics = (
      add: (listId: string, musicInfos: LX.Music.MusicInfoLocal[]) => Promise<void>,
      remove: (listId: string, errorPath: string[]) => Promise<void>,
      listId: string
    ) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      let _musicInfos: LX.Music.MusicInfoLocal[] = []
      let _errorPath: string[] = []
      return (musicInfos: LX.Music.MusicInfoLocal[], errorPath?: string[]) => {
        if (musicInfos.length) _musicInfos.push(...musicInfos)
        if (errorPath) _errorPath.push(...errorPath)
        if (timer) return
        timer = setTimeout(async () => {
          timer = null
          const musicInfos = _musicInfos
          const errorPath = _errorPath
          _musicInfos = []
          _errorPath = []
          if (musicInfos.length) await add(listId, musicInfos)
          if (errorPath.length) await remove(listId, errorPath)
        }, 100)
      }
    }
    
    const handleUpdateMusics = async (
      filePaths: string[],
      throttleUpdateMusics: (musicInfos: LX.Music.MusicInfoLocal[], errorPath?: string[]) => void,
      index: number = -1,
      total: number = 0,
      errorPath: string[] = []
    ) => {
      if (!total) total = filePaths.length
      const paths = filePaths.slice(index + 1, index + 11)
      const musicInfos = await createLocalMusicInfos(paths, errorPath)
      if (musicInfos.length) {
        throttleUpdateMusics(musicInfos)
        await updateListMusics(musicInfos.map((info) => ({ id: LIST_IDS.DOWNLOAD, musicInfo: info })))
      }
      setLoadingText(`正在读取标签 ${Math.min(index + 11, total)}/${total}...`)
      index += 10
      if (filePaths.length - 1 > index)
        await handleUpdateMusics(filePaths, throttleUpdateMusics, index, total, errorPath)
      else {
        if (errorPath.length) {
          toast(
            global.i18n.t('list_select_local_file_result_failed_tip', {
              total,
              success: total - errorPath.length,
              failed: errorPath.length,
            }),
            'long'
          )
        } else {
          toast(global.i18n.t('list_select_local_file_result_tip', { total }), 'long')
        }
        throttleUpdateMusics([], errorPath)
        setLoadingText('')
      }
    }
    
    const throttleUpdateMusics = createThrottleAddMusics(
      async (listId, musicInfos) => {
        return updateListMusics(musicInfos.map((info) => ({ id: listId, musicInfo: info })))
      },
      async (listId, errorPath) => {
        return Promise.resolve()
      },
      LIST_IDS.DOWNLOAD
    )
    
    await handleUpdateMusics(downloadedPaths, throttleUpdateMusics)
    
    webDAVLog.info('handleWebDAVDownloadAndImport: all processes completed')
    
  } catch (error: any) {
    webDAVLog.error('handleWebDAVDownloadAndImport: process failed', { error: error.message })
    toast(`导入失败：${error.message}`, 'long')
    setLoadingText('')
  }
}

const getDefaultDownloadDir = () => {
  const settings = settingState.setting
  const webdavPath = settings['sync.webdav.downloadPath']
  if (webdavPath && typeof webdavPath === 'string' && webdavPath.trim()) {
    return webdavPath.trim()
  }
  return getWebDAVPrivateDirectory()
}

const buildLocalMusicInfo = (
  filePath: string,
  metadata: Awaited<ReturnType<typeof readMetadata>>,
  picPath: string | null
): LX.Music.MusicInfoLocal => {
  const { nameWithoutExt, fileName } = parsePathForName(filePath)
  return {
    id: `local_${filePath}`,
    name: metadata.name || nameWithoutExt,
    singer: metadata.singer || '',
    albumName: metadata.albumName || '',
    interval: metadata.duration ? `${metadata.duration}s` : '',
    source: 'local' as const,
    meta: {
      picUrl: picPath ? (picPath.startsWith('/') ? `file://${picPath}` : picPath) : '',
      filePath,
      fileName,
    },
  } as LX.Music.MusicInfoLocal
}

const buildLocalMusicInfoByFilePath = (filePath: string): LX.Music.MusicInfoLocal => {
  const { nameWithoutExt, fileName } = parsePathForName(filePath)
  return {
    id: `local_${filePath}`,
    name: nameWithoutExt,
    singer: '',
    albumName: '',
    interval: '',
    source: 'local' as const,
    meta: {
      picUrl: '',
      fileName,
    },
  } as LX.Music.MusicInfoLocal
}

/**
 * 下载单首 WebDAV 歌曲，返回封面 URL
 */
export const handleWebDAVDownload = async (
  musicInfo: LX.WebDAV.MusicInfo
): Promise<string | undefined> => {
  const downloadDir = getDefaultDownloadDir()
  const fileName = musicInfo.meta.fileName
  
  if (!fileName) {
    toast('无法获取文件名')
    return undefined
  }

  const filePath = `${downloadDir}/${fileName}`
  const exists = await existsFile(filePath).catch(() => false)
  
  if (!exists) {
    try {
      const headers = getAuthHeaders()
      
      const downloadUrl = getWebDAVDownloadUrl(musicInfo)
      await mkdir(downloadDir)
      await downloadFile(downloadUrl, filePath, { headers }).promise
      
      const fileMetadata = await readMetadata(filePath).catch(() => null)
      const updates: Record<string, any> = { filePath }
      if (fileMetadata) {
        if (fileMetadata.albumName) updates.albumName = fileMetadata.albumName
        if (fileMetadata.name && !musicInfo.name) updates.name = fileMetadata.name
        if (fileMetadata.singer && !musicInfo.singer) updates.singer = fileMetadata.singer
      }
      await updateWebDAVMusicMeta(musicInfo.id, updates)
    } catch (error: any) {
      webDAVLog.error('handleWebDAVDownload: download failed', { fileName, error: error.message })
      toast(`下载失败：${error.message}`, 'long')
      return undefined
    }
  }

  try {
    const picPath = await readPic(filePath).catch(() => null)
    if (picPath) {
      const newPicUrl = picPath.startsWith('/') ? `file://${picPath}` : picPath
      await updateWebDAVMusicMeta(musicInfo.id, { picUrl: newPicUrl })
      return newPicUrl
    }
  } catch {
    // ignore
  }

  return undefined
}

/**
 * 从在线音乐源获取封面
 */
export const handleFetchWebDAVPicFromOnline = async (
  musicInfo: LX.WebDAV.MusicInfo
): Promise<string | undefined> => {
  try {
    const searchResult = await findMusic({
      name: musicInfo.name || '',
      singer: musicInfo.singer || '',
      albumName: musicInfo.meta.albumName || '',
      interval: musicInfo.interval || '',
      source: 'kw',
    })

    if (searchResult.length === 0) {
      toast('未找到匹配的在线歌曲')
      return undefined
    }

    const matched = searchResult[0] as LX.Music.MusicInfoOnline
    const result = await handleGetOnlinePicUrl({
      musicInfo: matched,
      isRefresh: true,
      onToggleSource: () => {},
      allowToggleSource: false,
    })

    if (result.url) {
      await updateWebDAVMusicMeta(musicInfo.id, { picUrl: result.url })
      return result.url
    }
  } catch (error: any) {
    webDAVLog.error('handleFetchWebDAVPicFromOnline: failed', { error: error.message })
    toast(`获取封面失败：${error.message}`, 'long')
  }

  return undefined
}

/**
 * 从 WebDAV 列表中移除歌曲
 */
export const handleWebDAVRemove = async (
  musicInfo: LX.WebDAV.MusicInfo
): Promise<void> => {
  try {
    const config = await getWebDAVConfig()
    const songs = (config.songs || []).filter(s => s.id !== musicInfo.id)
    await saveWebDAVConfig({ ...config, songs })
    toast('已移除')
  } catch (error: any) {
    webDAVLog.error('handleWebDAVRemove: failed', { error: error.message })
    toast(`移除失败：${error.message}`, 'long')
  }
}

/**
 * 复制歌曲名称到剪贴板
 */
export const handleWebDAVCopyName = (
  musicInfo: LX.WebDAV.MusicInfo
): void => {
  const text = musicInfo.name || musicInfo.meta.fileName || ''
  if (!text) {
    toast('没有可复制的内容')
    return
  }
  clipboardWriteText(text)
  toast('已复制到剪贴板')
}
