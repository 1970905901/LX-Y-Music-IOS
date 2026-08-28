import { getData, saveData } from '@/plugins/storage'
import { createClient, FileStat } from 'webdav'
import settingState from '@/store/setting/state'
import { webDAVLog } from './logger'

const CONFIG_KEY = '@webdav_music_config'
const audioExts = new Set([
  'mp3',
  'flac',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'wma',
  'ape',
])

async function getClient() {
  const settings = settingState.setting
  const url = settings['sync.webdav.url']
  const username = settings['sync.webdav.username']
  const password = settings['sync.webdav.password']

  if (!url || !username) {
    webDAVLog.error('WebDAV 未配置')
    throw new Error('WebDAV 未配置')
  }

  // createClient imported at top
  return createClient(url, { username, password })
}

const normalizePath = (path: string | undefined, name: string) => {
  return path ? `${path}/${name}` : `/${name}`
}

const getExt = (name: string) => {
  const ext = name.split('.').pop()
  return ext && ext != name ? ext.toLowerCase() : ''
}

const parseFileName = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf('.')
  const rawName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  if (!rawName.includes('-')) return { name: rawName.trim(), singer: '' }
  const [left, ...rest] = rawName.split('-')
  return {
    name: left.trim(),
    singer: rest.join('-').trim(),
  }
}

export const getWebDAVConfig = async (): Promise<LX.WebDAV.Config> => {
  const config = (await getData<LX.WebDAV.Config>(CONFIG_KEY)) ?? {
    selectedFolder: null,
    songs: [],
    filterPath: null,
  }
  config.songs = (config.songs ?? []).map(normalizeWebDAVMusicInfo)
  return config
}

export const saveWebDAVFilterPath = async (filterPath: string | null) => {
  const config = await getWebDAVConfig()
  config.filterPath = filterPath
  await saveWebDAVConfig(config)
  return config
}

export const saveWebDAVConfig = async (config: LX.WebDAV.Config) => {
  await saveData(CONFIG_KEY, config)
}

export const listWebDAVFolders = async (folder?: LX.WebDAV.DriveFolder | null) => {
  const client = await getClient()
  const basePath = folder?.path ?? '/'
  
  let contents: Array<any & { type: string }>
  try {
    contents = await client.getDirectoryContents(basePath) as Array<any & { type: string }>
  } catch (error: any) {
    webDAVLog.error('listWebDAVFolders error', { error, status: error.status })
    if (error.status === 404 || error.status === 409) {
      return []
    }
    throw error
  }
  
  return contents
    .filter(item => item.type === 'directory')
    .sort((a, b) => a.basename.localeCompare(b.basename))
    .map<LX.WebDAV.DriveFolder>(item => ({
      id: item.filename,
      name: item.basename,
      parentId: folder?.id,
      path: normalizePath(folder?.path, item.basename),
    }))
}

export const saveWebDAVSelectedFolder = async (folder: LX.WebDAV.DriveFolder | null) => {
  const config = await getWebDAVConfig()
  config.selectedFolder = folder
  await saveWebDAVConfig(config)
  return config
}

const toMusicInfo = (item: FileStat, path: string): LX.WebDAV.MusicInfo => {
  const ext = getExt(item.basename)
  const title = parseFileName(item.basename)
  const modifiedTime = item.lastmod ? new Date(item.lastmod).getTime() : 0
  return {
    id: `webdav_${item.filename}`,
    name: title.name,
    singer: title.singer,
    source: 'local',
    interval: null,
    meta: {
      webdav: true,
      fileName: item.basename,
      filePath: path,
      remotePath: path,
      ext,
      size: item.size,
      lastModifiedTime: modifiedTime,
      songId: path,
      albumName: '',
    },
  }
}

export const normalizeWebDAVMusicInfo = (musicInfo: LX.WebDAV.MusicInfo) => {
  const title = parseFileName(musicInfo.meta.fileName || musicInfo.name)
  musicInfo.name = title.name
  musicInfo.singer = title.singer
  return musicInfo
}

const scanFolder = async (
  folder: LX.WebDAV.DriveFolder | null,
  onProgress?: (count: number, folderPath: string) => void
) => {
  const client = await getClient()
  const result: LX.WebDAV.MusicInfo[] = []
  const basePath = folder?.path ?? '/'
  
  let contents: Array<any & { type: string }>
  try {
    contents = await client.getDirectoryContents(basePath) as Array<any & { type: string }>
  } catch (error: any) {
    webDAVLog.error('scanFolder error', { error, status: error.status })
    if (error.status === 404 || error.status === 409) {
      return result
    }
    throw error
  }
  
  for (const item of contents) {
    const path = normalizePath(folder?.path, item.basename)
    if (item.type === 'directory') {
      try {
        result.push(
          ...(await scanFolder(
            { id: item.filename, name: item.basename, parentId: folder?.id, path },
            onProgress
          ))
        )
      } catch (error: any) {
        webDAVLog.error('scanFolder recursive error', { path, error, status: error.status })
        // Skip folders that return 403 or other errors
      }
      onProgress?.(result.length, path)
      continue
    }
    if (item.type !== 'file') continue
    const ext = getExt(item.basename)
    if (!audioExts.has(ext)) continue
    result.push(toMusicInfo(item, path))
  }
  return result
}

export const scanWebDAVSongs = async (
  folder: LX.WebDAV.DriveFolder | null,
  onProgress?: (count: number, folderPath: string) => void
) => {
  const songs = await scanFolder(folder, onProgress)
  songs.sort((a, b) => b.meta.lastModifiedTime - a.meta.lastModifiedTime)

  const config = await getWebDAVConfig()
  const existingSongsMap = new Map<string, LX.WebDAV.MusicInfo>()
  for (const song of config.songs ?? []) {
    existingSongsMap.set(song.id, song)
  }
  
  const mergedSongs = songs.map(newSong => {
    const existing = existingSongsMap.get(newSong.id)
    if (existing) Object.assign(newSong.meta, existing.meta)
    return newSong
  })
  
  config.selectedFolder = folder
  config.songs = mergedSongs
  config.scannedAt = Date.now()
  await saveWebDAVConfig(config)
  return config
}

export const getWebDAVDownloadUrl = (musicInfo: LX.WebDAV.MusicInfo) => {
  const settings = settingState.setting
  const url = settings['sync.webdav.url']
  
  let remoteFilePath = String(musicInfo.meta.remotePath || musicInfo.meta.songId || musicInfo.meta.filePath)
  
  if (!remoteFilePath.startsWith('/')) {
    remoteFilePath = '/' + remoteFilePath
  }
  
  if (remoteFilePath.includes('/storage/emulated/') || remoteFilePath.includes('/sdcard/') || remoteFilePath.includes('/storage/self/')) {
    webDAVLog.warn('getWebDAVDownloadUrl: detected local path in remoteFilePath, using songId instead', { remoteFilePath, songId: musicInfo.meta.songId })
    remoteFilePath = String(musicInfo.meta.songId || musicInfo.meta.filePath)
    if (!remoteFilePath.startsWith('/')) {
      remoteFilePath = '/' + remoteFilePath
    }
  }
  
  if (!url) {
    webDAVLog.error('getWebDAVDownloadUrl: WebDAV 未配置')
    throw new Error('WebDAV 未配置')
  }
  const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url
  // 逐段编码：encodeURIComponent 会把路径分隔符 / 编成 %2F，
  // 整体编码后 URL 变成 "音乐%2F歌曲.mp3"，大多数 WebDAV 服务器
  // （坚果云/Alist/Nextcloud）会 404。正确做法是保留 / 分隔，
  // 只对每一段中的空格、中文、# 等特殊字符编码。
  const encodedFilePath = remoteFilePath
    .substring(1)
    .split('/')
    .map(encodeURIComponent)
    .join('/')
  const downloadUrl = `${baseUrl}/${encodedFilePath}`
  return downloadUrl
}

export interface WebDAVMusicMetaUpdate {
  picUrl?: string
  filePath?: string | null
}

export const updateWebDAVMusicMeta = async (musicId: string, update: WebDAVMusicMetaUpdate): Promise<void> => {
  const config = await getWebDAVConfig()
  const songIndex = config.songs.findIndex(song => song.id === musicId)
  if (songIndex === -1) {
    return
  }

  const song = config.songs[songIndex]
  if (update.picUrl !== undefined) {
    song.meta.picUrl = update.picUrl
  }
  // filePath 允许显式清空（传 null 或 ''）：文件被本地删除后需要清掉旧路径，
  // 否则播放链路会一直误判"已下载"而尝试读取不存在的文件。
  if (update.filePath !== undefined) {
    song.meta.filePath = update.filePath || ''
  }

  config.songs[songIndex] = song
  await saveWebDAVConfig(config)
}
