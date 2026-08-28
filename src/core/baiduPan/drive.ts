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

// Cookie 清洗：容忍用户粘贴时带上的 "Cookie:" 前缀、引号、换行与多余空格，
// 这些脏字符会让 pan.baidu.com 判定未登录（errno -6），表现为"有时登录不上去"。
const getCookie = () => {
  let raw = (settingState.setting['baidupan.cookie'] ?? '').trim()
  if (raw.toLowerCase().startsWith('cookie:')) raw = raw.slice(7)
  raw = raw.replace(/["'`]/g, '').replace(/[\r\n\t]+/g, ' ')
  // 分号后补空格归一化，同时去掉多余空白
  raw = raw
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .join('; ')
  return raw
}

const getRootPath = () => {
  const raw = (settingState.setting['baidupan.rootPath'] ?? '').trim()
  if (!raw) return '/'
  return raw.startsWith('/') ? raw : `/${raw}`
}

const getUserAgent = () =>
  // 桌面端 Chrome UA：百度网盘 API 对移动端 UA 有额外风控，容易返回 errno -6
  // （判定未登录）。桌面端 UA 配合 Referer 更稳定。
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// 从 Cookie 中提取 BDSTOKEN：百度网盘 API 的 CSRF 令牌，部分接口需要作为 URL 参数显式传递。
const getBdstoken = (): string => {
  const cookie = getCookie()
  const match = cookie.match(/BDSTOKEN\s*=\s*([^;\s]+)/i)
  return match?.[1] ?? ''
}

const getHeaders = (): Record<string, string> => {
  const cookie = getCookie()
  return {
    'User-Agent': getUserAgent(),
    Referer: `${API_BASE}/disk/main`,
    Accept: 'application/json, text/plain, */*',
    // X-Requested-With 标识 AJAX 请求，百度网盘 API 依赖此头避免风控拦截
    'X-Requested-With': 'XMLHttpRequest',
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
      return '百度网盘 Cookie 无效或未登录（需包含 BDUSS 和 STOKEN 字段，请在浏览器 F12 → Network → Cookie 中复制完整字符串）'
    case -7:
      return '百度网盘登录已过期，请重新获取 Cookie（BDUSS 和 STOKEN 均需更新）'
    case -9:
      return '百度网盘请求过于频繁，请稍后再试'
    case -12:
      return '百度网盘接口需要验证，请重新获取 Cookie'
    case 112:
      return '百度网盘会话已失效，请在设置中更新 Cookie'
    case -20:
      return '百度网盘请求过于频繁触发风控，请稍后再试'
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

// 同目录同名 .lrc 歌词索引：key 为 `目录|小写文件名(不带扩展名)`
const lyricFileIndex = new Map<string, string>()

const getLyricIndexKey = (filePath: string) => {
  const slashIndex = filePath.lastIndexOf('/')
  const dir = slashIndex >= 0 ? filePath.slice(0, slashIndex) : ''
  const fileName = filePath.slice(slashIndex + 1)
  const dotIndex = fileName.lastIndexOf('.')
  const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  return `${dir}|${base.toLowerCase()}`
}

// 查找音频文件同目录的同名 .lrc 文件路径（需先 list 过所在目录建立索引）
export const findBaiduPanLrcPath = (audioPath: string): string | null => {
  return lyricFileIndex.get(getLyricIndexKey(audioPath)) ?? null
}

const getTarget = (path: string) => encodeURIComponent(path)

export const listBaiduPanDir = async (dir?: string): Promise<BaiduPanDirContent> => {
  const cookie = getCookie()
  if (!cookie) throw new BaiduPanError('请先在设置中填写百度网盘 Cookie', -6)

  const targetDir = dir && dir.length ? dir : getRootPath()
  const folders: LX.BaiduPan.DriveFile[] = []
  const files: LX.BaiduPan.DriveFile[] = []

  const num = 1000
  let page = 1
  const dirLyricKeys: string[] = []
  const bdstoken = getBdstoken()
  // 最多翻 50 页，避免极端情况下死循环
  while (page <= 50) {
    const url =
      `${API_BASE}/api/list?dir=${encodeURIComponent(targetDir)}` +
      `&num=${num}&page=${page}&order=name&desc=0&clienttype=0&web=1&channel=chunmi&app_id=250528` +
      (bdstoken ? `&bdstoken=${encodeURIComponent(bdstoken)}` : '')
    const response = await fetch(url, { headers: getHeaders() })
    const body = await response.json()
    if (typeof body.errno === 'number' && body.errno !== 0) {
      throw new BaiduPanError(mapErrno(body.errno), body.errno)
    }
    const list: LX.BaiduPan.DriveFile[] = body.list ?? []
    // 逐条目容错：个别异常条目（如缺失 server_filename/path 的占位文件、
    // 转码失败文件）不能让整个目录加载失败，跳过并继续处理其余条目。
    for (const item of list) {
      try {
        if (!item || typeof item.server_filename !== 'string') continue
        if (item.isdir === 1) {
          folders.push(item)
        } else if (audioExts.has(getExt(item.server_filename))) {
          files.push(item)
        } else if (getExt(item.server_filename) === 'lrc' && typeof item.path === 'string') {
          // 记录歌词文件，供播放时按同名匹配
          const key = getLyricIndexKey(item.path)
          lyricFileIndex.set(key, item.path)
          dirLyricKeys.push(key)
        }
      } catch (e) {
        console.error('Error processing BaiduPan item:', e)
      }
    }
    if (list.length < num) break
    page++
  }
  // 清理其他目录遗留的歌词索引，避免无限增长
  for (const key of Array.from(lyricFileIndex.keys())) {
    if (!dirLyricKeys.includes(key) && key.split('|')[0] === targetDir) lyricFileIndex.delete(key)
  }

  folders.sort((a, b) => (a.server_filename ?? '').localeCompare(b.server_filename ?? ''))
  files.sort((a, b) => (a.server_filename ?? '').localeCompare(b.server_filename ?? ''))

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

// 已下载文件在本地私有目录中的路径（用于读取内嵌封面）
export const getBaiduPanLocalFilePath = (musicInfo: LX.BaiduPan.MusicInfo): string => {
  const fileName = `${musicInfo.meta.fsId}_${musicInfo.meta.fileName}`
  return `${getBaiduPanPrivateDirectory()}/${fileName}`
}

// dlink 直链缓存：dlink 有效期约 8 小时，取 6 小时保险
const DLINK_TTL_MS = 6 * 60 * 60 * 1000
const dlinkCache = new Map<string, { url: string; expire: number }>()

const buildDlink = async (targetPath: string): Promise<string> => {
  const cookie = getCookie()
  if (!cookie) throw new BaiduPanError('请先在设置中填写百度网盘 Cookie', -6)

  const bdstoken = getBdstoken()
  const url =
    `${API_BASE}/api/filemetas?target=${getTarget(targetPath)}` +
    `&dlink=1&clienttype=0&web=1&channel=chunmi&app_id=250528` +
    (bdstoken ? `&bdstoken=${encodeURIComponent(bdstoken)}` : '')
  const response = await fetch(url, { headers: getHeaders() })
  const body = await response.json()
  if (typeof body.errno === 'number' && body.errno !== 0) {
    throw new BaiduPanError(mapErrno(body.errno), body.errno)
  }
  const info = body.list?.[0]
  const dlink: string | undefined = info?.dlink ?? info?.dlinks?.[0]
  if (!dlink) throw new BaiduPanError('获取文件直链失败，请稍后重试', -1)
  // origin=dlna 可去掉 dlink 与 UA 的绑定，播放器可用自身默认 UA 直接边下边播，
  // 无需把整个文件先下载完，也无需向播放器注入 Cookie。
  return dlink.includes('?') ? `${dlink}&origin=dlna` : `${dlink}?origin=dlna`
}

// 获取音频播放直链（流式直连，不再整文件预下载）
export const getBaiduPanPlayUrl = async (
  musicInfo: LX.BaiduPan.MusicInfo,
  isRefresh = false
): Promise<string> => {
  const key = String(musicInfo.meta.fsId)
  if (!isRefresh) {
    const cached = dlinkCache.get(key)
    if (cached && cached.expire > Date.now()) return cached.url
  }
  const playUrl = await buildDlink(musicInfo.meta.filePath)
  dlinkCache.set(key, { url: playUrl, expire: Date.now() + DLINK_TTL_MS })
  return playUrl
}

// 拉取音频同目录同名 .lrc 歌词文本（通过 dlink 直链）
export const fetchBaiduPanLrc = async (audioPath: string): Promise<string | null> => {
  const lrcPath = findBaiduPanLrcPath(audioPath)
  if (!lrcPath) return null
  const key = `lrc:${lrcPath}`
  const cached = dlinkCache.get(key)
  const url =
    cached && cached.expire > Date.now()
      ? cached.url
      : await buildDlink(lrcPath).then(u => {
          dlinkCache.set(key, { url: u, expire: Date.now() + DLINK_TTL_MS })
          return u
        })
  const response = await fetch(url)
  if (!response.ok) return null
  const text = await response.text()
  return text?.trim() ? text : null
}
