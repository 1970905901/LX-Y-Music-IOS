import settingState from '@/store/setting/state'
import { existsFile, mkdir, downloadFile, privateStorageDirectoryPath } from '@/utils/fs'
import { requestStoragePermission } from '@/utils/tools'

const API_BASE = 'https://pan.baidu.com'

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

export class BaiduPanError extends Error {
  public readonly code: number
  constructor(message: string, code: number) {
    super(message)
    this.name = 'BaiduPanError'
    this.code = code
  }
}

const getCookie = () => (settingState.setting['baidupan.cookie'] ?? '').trim()

const getRootPath = () => {
  const raw = (settingState.setting['baidupan.rootPath'] ?? '').trim()
  if (!raw) return '/'
  return raw.startsWith('/') ? raw : `/${raw}`
}

const getUserAgent = () =>
  'Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36'

const getHeaders = (): Record<string, string> => {
  const cookie = getCookie()
  return {
    'User-Agent': getUserAgent(),
    ...(cookie ? { Cookie: cookie } : {}),
  }
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

const mapErrno = (errno: number): string => {
  switch (errno) {
    case -6:
      return '百度网盘 Cookie 无效或未登录，请在设置中更新 Cookie'
    case -7:
      return '百度网盘登录已过期，请更新 Cookie'
    case -9:
      return '百度网盘请求过于频繁，请稍后再试'
    case -12:
      return '百度网盘接口需要验证，请重新获取 Cookie'
    default:
      return `百度网盘请求失败（错误码 ${errno}）`
  }
}

const toMusicInfo = (item: LX.BaiduPan.DriveFile, dir: string): LX.BaiduPan.MusicInfo => {
  const ext = getExt(item.server_filename)
  const title = parseFileName(item.server_filename)
  const modifiedTime = item.server_mtime ? item.server_mtime * 1000 : 0
  return {
    id: `baidupan_${item.fs_id}`,
    name: title.name,
    singer: title.singer,
    source: 'local',
    interval: null,
    meta: {
      songId: String(item.fs_id),
      albumName: '',
      baidupan: true,
      fsId: item.fs_id,
      fileName: item.server_filename,
      filePath: item.path,
      ext,
      size: item.size,
      lastModifiedTime: modifiedTime,
    },
  }
}

export interface BaiduPanDirContent {
  dir: string
  folders: LX.BaiduPan.DriveFolder[]
  musics: LX.BaiduPan.MusicInfo[]
}

export const listBaiduPanDir = async (dir?: string): Promise<BaiduPanDirContent> => {
  const cookie = getCookie()
  if (!cookie) throw new BaiduPanError('请先在设置中填写百度网盘 Cookie', -6)

  const targetDir = dir && dir.length ? dir : getRootPath()
  const folders: LX.BaiduPan.DriveFile[] = []
  const files: LX.BaiduPan.DriveFile[] = []

  const num = 1000
  let page = 1
  // 最多翻 50 页，避免极端情况下死循环
  while (page <= 50) {
    const url =
      `${API_BASE}/api/list?dir=${encodeURIComponent(targetDir)}` +
      `&num=${num}&page=${page}&order=name&desc=0&clienttype=0&web=1&channel=web`
    const response = await fetch(url, { headers: getHeaders() })
    const body = await response.json()
    if (typeof body.errno === 'number' && body.errno !== 0) {
      throw new BaiduPanError(mapErrno(body.errno), body.errno)
    }
    const list: LX.BaiduPan.DriveFile[] = body.list ?? []
    for (const item of list) {
      if (item.isdir === 1) folders.push(item)
      else if (audioExts.has(getExt(item.server_filename))) files.push(item)
    }
    if (list.length < num) break
    page++
  }

  folders.sort((a, b) => a.server_filename.localeCompare(b.server_filename))
  files.sort((a, b) => a.server_filename.localeCompare(b.server_filename))

  return {
    dir: targetDir,
    folders: folders.map(f => ({ name: f.server_filename, path: f.path })),
    musics: files.map(f => toMusicInfo(f, targetDir)),
  }
}

const getBaiduPanPrivateDirectory = () => {
  const docDir = privateStorageDirectoryPath
  if (!docDir || typeof docDir !== 'string') return '/storage/emulated/0/Music/LX-Y Music/BaiduPan'
  return `${docDir}/BaiduPan`
}

export const downloadBaiduPanMusic = async (
  musicInfo: LX.BaiduPan.MusicInfo,
  isRefresh = false
): Promise<string> => {
  const cookie = getCookie()
  if (!cookie) throw new BaiduPanError('请先在设置中填写百度网盘 Cookie', -6)

  const hasPermission = await requestStoragePermission()
  if (!hasPermission) {
    throw new Error('没有存储权限，无法下载音乐')
  }

  const cacheDir = getBaiduPanPrivateDirectory()
  const fileName = `${musicInfo.meta.fsId}_${musicInfo.meta.fileName}`
  const filePath = `${cacheDir}/${fileName}`

  if (!isRefresh && (await existsFile(filePath))) return filePath

  await mkdir(cacheDir)

  const netDir = musicInfo.meta.filePath.split('/').slice(0, -1).join('/') || '/'
  const downloadUrl =
    `${API_BASE}/api/download?dir=${encodeURIComponent(netDir)}` +
    `&filename=${encodeURIComponent(musicInfo.meta.fileName)}&clienttype=0&web=1&channel=web`

  await downloadFile(downloadUrl, filePath, { headers: getHeaders() }).promise

  return filePath
}
