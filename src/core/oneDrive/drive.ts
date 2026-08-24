import { getData, saveData } from '@/plugins/storage'
import { getValidOneDriveAuth } from './auth'

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0/me/drive'
const CONFIG_KEY = '@onedrive_config'
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

const requestGraph = async <T>(url: string): Promise<T> => {
  const auth = await getValidOneDriveAuth()
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
    },
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body.error?.message ?? body.error_description ?? 'OneDrive request failed')
  }
  return body as T
}

const readAllPages = async <T>(url: string): Promise<T[]> => {
  const result: T[] = []
  let nextUrl: string | undefined = url
  while (nextUrl) {
    const body: { value: T[]; '@odata.nextLink'?: string } = await requestGraph(nextUrl)
    result.push(...(body.value ?? []))
    nextUrl = body['@odata.nextLink']
  }
  return result
}

const getChildrenUrl = (folderId?: string) => {
  const expand = '$expand=thumbnails($select=small,medium,large)'
  return folderId
    ? `${GRAPH_ROOT}/items/${encodeURIComponent(folderId)}/children?${expand}&$top=200`
    : `${GRAPH_ROOT}/root/children?${expand}&$top=200`
}

const normalizePath = (path: string | undefined, name: string) => {
  return path ? `${path}/${name}` : name
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

const getThumbUrl = (item: LX.OneDrive.DriveFile) => {
  const thumb = item.thumbnails?.[0]
  return thumb?.large?.url ?? thumb?.medium?.url ?? thumb?.small?.url ?? ''
}

const getDownloadUrl = (item: LX.OneDrive.DriveFile) => {
  return item.downloadUrl ?? item['@microsoft.graph.downloadUrl']
}

export const getOneDriveConfig = async (): Promise<LX.OneDrive.Config> => {
  const config = (await getData<LX.OneDrive.Config>(CONFIG_KEY)) ?? {
    selectedFolder: null,
    songs: [],
  }
  config.songs = (config.songs ?? []).map(normalizeOneDriveMusicInfo)
  return config
}

export const saveOneDriveConfig = async (config: LX.OneDrive.Config) => {
  await saveData(CONFIG_KEY, config)
}

export const listOneDriveFolders = async (folder?: LX.OneDrive.DriveFolder | null) => {
  const items = await readAllPages<LX.OneDrive.DriveFile & { folder?: unknown }>(
    getChildrenUrl(folder?.id)
  )
  return items
    .filter(item => item.folder)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map<LX.OneDrive.DriveFolder>(item => ({
      id: item.id,
      name: item.name,
      parentId: folder?.id,
      path: normalizePath(folder?.path, item.name),
    }))
}

export const saveOneDriveSelectedFolder = async (folder: LX.OneDrive.DriveFolder | null) => {
  const config = await getOneDriveConfig()
  config.selectedFolder = folder
  await saveOneDriveConfig(config)
  return config
}

const toMusicInfo = (item: LX.OneDrive.DriveFile, path: string): LX.OneDrive.MusicInfo => {
  const ext = getExt(item.name)
  const title = parseFileName(item.name)
  const modifiedTime = item.lastModifiedDateTime
    ? new Date(item.lastModifiedDateTime).getTime()
    : 0
  return {
    id: `onedrive_${item.id}`,
    name: title.name,
    singer: title.singer,
    source: 'local',
    interval: null,
    meta: {
      songId: item.id,
      albumName: '',
      oneDrive: true,
      itemId: item.id,
      fileName: item.name,
      filePath: path,
      ext,
      size: item.size,
      webUrl: item.webUrl,
      downloadUrl: getDownloadUrl(item),
      picUrl: getThumbUrl(item),
      lastModifiedTime: modifiedTime,
    },
  }
}

export const normalizeOneDriveMusicInfo = (musicInfo: LX.OneDrive.MusicInfo) => {
  const title = parseFileName(musicInfo.meta.fileName || musicInfo.name)
  return {
    ...musicInfo,
    name: title.name,
    singer: title.singer,
  }
}

const scanFolder = async (
  folder: LX.OneDrive.DriveFolder | null,
  onProgress?: (count: number, folderPath: string) => void
) => {
  const result: LX.OneDrive.MusicInfo[] = []
  const items = await readAllPages<LX.OneDrive.DriveFile & { folder?: unknown; file?: unknown }>(
    getChildrenUrl(folder?.id)
  )
  for (const item of items) {
    const path = normalizePath(folder?.path, item.name)
    if (item.folder) {
      result.push(
        ...(await scanFolder(
          { id: item.id, name: item.name, parentId: folder?.id, path },
          onProgress
        ))
      )
      onProgress?.(result.length, path)
      continue
    }
    if (!item.file) continue
    const ext = getExt(item.name)
    if (!audioExts.has(ext)) continue
    result.push(toMusicInfo(item, path))
  }
  return result
}

export const scanOneDriveSongs = async (
  folder: LX.OneDrive.DriveFolder | null,
  onProgress?: (count: number, folderPath: string) => void
) => {
  const songs = await scanFolder(folder, onProgress)
  songs.sort((a, b) => b.meta.lastModifiedTime - a.meta.lastModifiedTime)

  const config = await getOneDriveConfig()
  config.selectedFolder = folder
  config.songs = songs
  config.scannedAt = Date.now()
  await saveOneDriveConfig(config)
  return config
}

export const getOneDriveDownloadUrl = async (musicInfo: LX.OneDrive.MusicInfo) => {
  const body = await requestGraph<LX.OneDrive.DriveFile>(
    `${GRAPH_ROOT}/items/${encodeURIComponent(musicInfo.meta.itemId)}`
  )
  const url = getDownloadUrl(body) ?? musicInfo.meta.downloadUrl
  if (!url) throw new Error('OneDrive 文件没有可播放地址')
  musicInfo.meta.downloadUrl = url
  return url
}
