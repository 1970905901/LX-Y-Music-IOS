import { getData, saveData } from '@/plugins/storage'
import { createClient, FileStat } from 'webdav'
import settingState from '@/store/setting/state'
import { webDAVLog } from './logger'
import { btoa } from 'react-native-quick-base64'
import { downloadFile, existsFile, mkdir, temporaryDirectoryPath } from '@/utils/fs'
import { enforceCacheLimit } from '@/utils/nativeModules/cache'
import { stringMd5 } from 'react-native-quick-md5'

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

// 网盘内可作为封面的图片扩展名 + 目录级通用封面文件名
const picExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])
const genericPicNames = new Set(['cover', 'folder', 'front', 'album', 'back', 'poster', 'thumb'])

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

const getBaseName = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
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
  
  // 第一遍：收集当前目录的图片与歌词文件，供同名/通用封面匹配
  const picMap = new Map<string, string>()
  const lrcMap = new Map<string, string>()
  let genericPic = ''
  for (const item of contents) {
    if (item.type !== 'file') continue
    const ext = getExt(item.basename)
    const path = normalizePath(folder?.path, item.basename)
    const base = getBaseName(item.basename).toLowerCase()
    if (ext === 'lrc') {
      lrcMap.set(base, path)
    } else if (picExts.has(ext)) {
      picMap.set(base, path)
      if (genericPicNames.has(base)) genericPic = path
    }
  }

  // 第二遍：处理子目录与音频
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
    const musicInfo = toMusicInfo(item, path)
    // 网盘内封面/歌词：优先同目录同名，其次目录通用封面
    const audioBase = getBaseName(item.basename).toLowerCase()
    const picPath = picMap.get(audioBase) ?? genericPic
    const lrcPath = lrcMap.get(audioBase)
    if (picPath) musicInfo.meta.picPath = picPath
    if (lrcPath) musicInfo.meta.lrcPath = lrcPath
    result.push(musicInfo)
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

// WebDAV 直链播放/下载的认证 headers：服务器通常需 Basic 认证
export const getWebDAVAuthHeaders = (): Record<string, string> => {
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

// 播放/封面缓存目录（Caches，可被系统清理，不参与 iCloud 备份）。
// 注意与 getWebDAVPrivateDirectory（用户手动下载目录，位于 Documents）区分：
// 这里是流式播放自动预下载的临时缓存，可被系统回收；用户手动下载的文件要保留。
const getWebDAVCacheDirectory = () => `${temporaryDirectoryPath}/WebDAV`

// 由远程路径构造 WebDAV 直链 URL（保留 / 分隔，仅对每段编码）
const getWebDAVRemoteUrl = (remoteFilePath: string): string => {
  const url = settingState.setting['sync.webdav.url']
  if (!url) {
    webDAVLog.error('getWebDAVRemoteUrl: WebDAV 未配置')
    throw new Error('WebDAV 未配置')
  }

  let remote = String(remoteFilePath || '')
  if (!remote.startsWith('/')) remote = '/' + remote

  if (
    remote.includes('/storage/emulated/') ||
    remote.includes('/sdcard/') ||
    remote.includes('/storage/self/')
  ) {
    webDAVLog.warn('getWebDAVRemoteUrl: detected local path in remoteFilePath', { remoteFilePath: remote })
  }

  const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url
  // 逐段编码：encodeURIComponent 会把路径分隔符 / 编成 %2F，
  // 整体编码后 URL 变成 "音乐%2F歌曲.mp3"，大多数 WebDAV 服务器
  // （坚果云/Alist/Nextcloud）会 404。正确做法是保留 / 分隔，
  // 只对每一段中的空格、中文、# 等特殊字符编码。
  const encodedFilePath = remote
    .substring(1)
    .split('/')
    .map(encodeURIComponent)
    .join('/')
  return `${baseUrl}/${encodedFilePath}`
}

export const getWebDAVDownloadUrl = (musicInfo: LX.WebDAV.MusicInfo) => {
  let remoteFilePath = String(musicInfo.meta.remotePath || musicInfo.meta.songId || musicInfo.meta.filePath)

  if (remoteFilePath.includes('/storage/emulated/') || remoteFilePath.includes('/sdcard/') || remoteFilePath.includes('/storage/self/')) {
    webDAVLog.warn('getWebDAVDownloadUrl: detected local path in remoteFilePath, using songId instead', { remoteFilePath, songId: musicInfo.meta.songId })
    remoteFilePath = String(musicInfo.meta.songId || musicInfo.meta.filePath)
  }

  return getWebDAVRemoteUrl(remoteFilePath)
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

// 拉取网盘内封面图片：下载到本地缓存目录，返回 file:// 本地路径
// （FastImage 固定 defaultHeaders，无法注入 Basic Auth，需先下载到本地）
export const fetchWebDAVPic = async (musicInfo: LX.WebDAV.MusicInfo): Promise<string | null> => {
  const picPath = musicInfo.meta.picPath
  if (!picPath) return null
  try {
    const url = getWebDAVRemoteUrl(picPath)
    const coversDir = `${getWebDAVCacheDirectory()}/covers`
    const ext = picPath.split('.').pop()?.toLowerCase() || 'jpg'
    // 同音频缓存：用 md5 避免 encodeURIComponent 与 downloadFile 内部 decodeURIComponent 冲突
    const localPath = `${coversDir}/${stringMd5(picPath)}.${ext}`
    if (await existsFile(localPath)) return `file://${localPath}`
    await mkdir(coversDir)
    await downloadFile(url, localPath, { headers: getWebDAVAuthHeaders() }).promise
    return `file://${localPath}`
  } catch (err) {
    webDAVLog.warn('fetchWebDAVPic: failed', { err })
    return null
  }
}

// 拉取网盘内同名 .lrc 歌词文本（通过直链 + Basic Auth）
export const fetchWebDAVLrc = async (musicInfo: LX.WebDAV.MusicInfo): Promise<string | null> => {
  const lrcPath = musicInfo.meta.lrcPath
  if (!lrcPath) return null
  try {
    const url = getWebDAVRemoteUrl(lrcPath)
    const response = await fetch(url, { headers: getWebDAVAuthHeaders() })
    if (!response.ok) return null
    const text = await response.text()
    return text?.trim() ? text : null
  } catch (err) {
    webDAVLog.warn('fetchWebDAVLrc: failed', { err })
    return null
  }
}

// 整文件预下载 WebDAV 音频到本地私有缓存目录，返回本地绝对路径。
// iOS 的 AVPlayer 无法可靠注入 Authorization/User-Agent 头，
// 直链流式播放不稳定，改为用 downloadFile（NSURLSession，能正确携带 Basic Auth）
// 先下载到私有缓存，再播放本地文件。
export const downloadWebDAVMusic = async (musicInfo: LX.WebDAV.MusicInfo): Promise<string> => {
  const remotePath = String(musicInfo.meta.remotePath || musicInfo.meta.songId || musicInfo.meta.filePath)
  const cacheDir = `${getWebDAVCacheDirectory()}/music`
  const ext = musicInfo.meta.ext || getExt(musicInfo.meta.fileName || remotePath)
  // 缓存文件名用 remotePath 的 md5：downloadFile 内部 normalizePath 会 decodeURIComponent，
  // 若用 encodeURIComponent(remotePath) 生成文件名，下载实际写入的是“解码后”路径，而返回给
  // 播放器的是“编码后”路径，两者不一致导致播放器找不到文件、无法播放。
  const filePath = `${cacheDir}/${stringMd5(remotePath)}.${ext}`

  if (await existsFile(filePath)) return filePath

  await mkdir(cacheDir)
  const downloadUrl = getWebDAVDownloadUrl(musicInfo)
  await downloadFile(downloadUrl, filePath, { headers: getWebDAVAuthHeaders() }).promise

  // 下载完成后按上限对全部应用缓存做 LRU 清理，避免缓存无限累积
  // （不仅清 WebDAV 子目录，让 getAppCacheSize 显示的总大小也收敛到上限内）
  void enforceCacheLimit((settingState.setting['player.cacheLimit'] || 0) * 1024 * 1024)

  return filePath
}
