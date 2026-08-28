import settingState from '@/store/setting/state'
import { existsFile, mkdir, writeFile, temporaryDirectoryPath } from '@/utils/fs'
import { requestStoragePermission } from '@/utils/tools'
import { enforceCloudCacheLimit } from '@/utils/nativeModules/cache'

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

// 网盘内可作为封面的图片扩展名
const picExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])
// 目录级通用封面文件名（不含扩展名），匹配不到同名封面时回退使用
const genericPicNames = new Set(['cover', 'folder', 'front', 'album', 'back', 'poster', 'thumb'])

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

// 同目录同名 .lrc 歌词索引：key 为 `目录|小写文件名(不带扩展名)`，值为文件 fsId + 路径
const lyricFileIndex = new Map<string, { fsId: number, path: string }>()

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
  return lyricFileIndex.get(getLyricIndexKey(audioPath))?.path ?? null
}

// 同目录同名封面图片索引：key 为 `目录|小写文件名(不带扩展名)`，值为文件 fsId + 路径
const picFileIndex = new Map<string, { fsId: number, path: string }>()
// 目录级通用封面（cover/folder 等）：key 为目录路径，值为封面文件
const genericPicIndex = new Map<string, { fsId: number, path: string }>()

const getPicIndexKey = (filePath: string) => {
  const slashIndex = filePath.lastIndexOf('/')
  const dir = slashIndex >= 0 ? filePath.slice(0, slashIndex) : ''
  const fileName = filePath.slice(slashIndex + 1)
  const dotIndex = fileName.lastIndexOf('.')
  const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  return `${dir}|${base.toLowerCase()}`
}

const getDirKey = (filePath: string) => {
  const slashIndex = filePath.lastIndexOf('/')
  return slashIndex >= 0 ? filePath.slice(0, slashIndex) : ''
}

// 查找音频文件对应的网盘内封面：优先同目录同名，其次同目录通用封面
export const findBaiduPanPicPath = (audioPath: string): { fsId: number, path: string } | null => {
  return (
    picFileIndex.get(getPicIndexKey(audioPath)) ??
    genericPicIndex.get(getDirKey(audioPath)) ??
    null
  )
}

// Cookie 形状校验：BDUSS 是网盘 API 的必备凭证（STOKEN 主要用于写操作）。
// 缺失时直接给出明确提示，而不是放行后让接口返回晦涩的 errno。
const assertCookieUsable = () => {
  const cookie = getCookie()
  if (!cookie) throw new BaiduPanError('请先在设置中填写百度网盘 Cookie', -6)
  if (!/BDUSS\s*=/i.test(cookie)) {
    throw new BaiduPanError(
      'Cookie 缺少 BDUSS 字段：请在浏览器登录 pan.baidu.com 后，F12 → Network → 任意请求 → 复制完整 Cookie（需包含 BDUSS，建议同时带上 STOKEN）',
      -6
    )
  }
  return cookie
}

// 网盘专用 XHR 请求：
// - withCredentials=false —— 禁止 iOS NSURLSession 用共享 Cookie 存储覆盖/合并我们
//   显式设置的 Cookie 头。之前响应 Set-Cookie 写入的会话残留（PANWEB 等）会让
//   BDUSS 丢失，这是"同样的 Cookie 时好时坏"的根源之一。用原生 XHR 而不是 fetch，
//   是为了显式控制该开关（fetch polyfill 对 credentials:'omit' 的透传不确定）。
// - Cookie 等头通过 setRequestHeader 显式下发，open 之后设置（XHR 规范要求）。
const xhrGet = (url: string, headers: Record<string, string>): Promise<{ status: number, text: string }> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.withCredentials = false
    xhr.open('GET', url)
    for (const key of Object.keys(headers)) {
      try {
        xhr.setRequestHeader(key, headers[key])
      } catch {}
    }
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText ?? '' })
    xhr.onerror = () => reject(new BaiduPanError('网络请求失败，请检查网络连接', -1))
    xhr.ontimeout = () => reject(new BaiduPanError('网络请求超时，请稍后重试', -1))
    xhr.send()
  })

// 网盘专用 XHR 下载（arraybuffer）：
// RNFS.downloadFile 底层 NSURLSession 会忽略手动设置的 Cookie/User-Agent 头
// （Cookie 只能由 NSHTTPCookieStorage 管理），导致 dlink 直链下载被防盗链 403/401，
// 表现为"点击后无法播放"。这里改用与 xhrGet 相同的 XHR（withCredentials=false +
// 显式 setRequestHeader，Cookie/Referer/UA 均能正确下发，list 接口已验证可用），
// 下载为 arraybuffer 后再落盘。
const xhrDownload = (url: string, headers: Record<string, string>): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.withCredentials = false
    xhr.open('GET', url)
    xhr.responseType = 'arraybuffer'
    for (const key of Object.keys(headers)) {
      try {
        xhr.setRequestHeader(key, headers[key])
      } catch {}
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as ArrayBuffer)
      } else {
        reject(new BaiduPanError(`下载失败（HTTP ${xhr.status}）`, xhr.status))
      }
    }
    xhr.onerror = () => reject(new BaiduPanError('网络请求失败，请检查网络连接', -1))
    xhr.ontimeout = () => reject(new BaiduPanError('网络请求超时，请稍后重试', -1))
    xhr.send()
  })

// 统一网盘 API 请求，容忍各种拦截形态：
// 1. withCredentials=false（见 xhrGet）—— 只发送我们显式设置的 Cookie 头。
// 2. 以文本读取响应 —— Cookie 失效或触发风控时会被 302 到登录页返回 HTML，
//    response.json() 会抛出晦涩的 SyntaxError；这里识别 HTML 给出明确提示。
// 3. 参数降级重试 —— 附加参数（channel/app_id）被部分账号风控拒绝时，
//    回退到最小参数集重试一次。
const requestPanApi = async (urls: string[]): Promise<any> => {
  assertCookieUsable()

  let lastError: unknown = null
  for (const url of urls) {
    try {
      const { status, text } = await xhrGet(url, getHeaders())
      if (/^\s*</.test(text)) {
        throw new BaiduPanError(
          '百度网盘返回了登录页：Cookie 已失效或被风控拦截，请重新获取（需包含 BDUSS）',
          -6
        )
      }
      let body: any
      try {
        body = JSON.parse(text)
      } catch {
        throw new BaiduPanError(
          `百度网盘返回了无法解析的内容（HTTP ${status}），Cookie 可能已失效`,
          -6
        )
      }
      if (typeof body.errno === 'number' && body.errno !== 0) {
        throw new BaiduPanError(mapErrno(body.errno), body.errno)
      }
      return body
    } catch (err) {
      lastError = err
      // 限流类错误立即抛出，不重试
      if (err instanceof BaiduPanError && (err.code === -9 || err.code === -20)) throw err
    }
  }
  throw lastError ?? new BaiduPanError('百度网盘请求失败，请稍后重试', -1)
}

export const listBaiduPanDir = async (dir?: string): Promise<BaiduPanDirContent> => {
  assertCookieUsable()

  const targetDir = dir && dir.length ? dir : getRootPath()
  const folders: LX.BaiduPan.DriveFile[] = []
  const files: LX.BaiduPan.DriveFile[] = []

  const num = 1000
  let page = 1
  const dirLyricKeys: string[] = []
  const dirPicKeys: string[] = []
  const bdstoken = getBdstoken()
  const bdstokenQ = bdstoken ? `&bdstoken=${encodeURIComponent(bdstoken)}` : ''
  // 最多翻 50 页，避免极端情况下死循环
  while (page <= 50) {
    const dirQ = encodeURIComponent(targetDir)
    // 参数降级：完整参数（channel=chunmi&app_id=250528）被风控拒绝时回退最小参数集
    const body = await requestPanApi([
      `${API_BASE}/api/list?dir=${dirQ}&num=${num}&page=${page}&order=name&desc=0&clienttype=0&web=1&channel=chunmi&app_id=250528${bdstokenQ}`,
      `${API_BASE}/api/list?dir=${dirQ}&num=${num}&page=${page}&order=name&desc=0&clienttype=0&web=1&channel=web${bdstokenQ}`,
    ])
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
          // 记录歌词文件（含 fsId），供播放时按同名匹配
          const key = getLyricIndexKey(item.path)
          lyricFileIndex.set(key, { fsId: item.fs_id, path: item.path })
          dirLyricKeys.push(key)
        } else if (picExts.has(getExt(item.server_filename)) && typeof item.path === 'string') {
          // 记录封面图片（含 fsId），供播放时按同名/通用名匹配
          const key = getPicIndexKey(item.path)
          picFileIndex.set(key, { fsId: item.fs_id, path: item.path })
          dirPicKeys.push(key)
          const base = item.path.slice(item.path.lastIndexOf('/') + 1, item.path.lastIndexOf('.'))
          if (genericPicNames.has(base.toLowerCase())) {
            genericPicIndex.set(getDirKey(item.path), { fsId: item.fs_id, path: item.path })
          }
        }
      } catch (e) {
        console.error('Error processing BaiduPan item:', e)
      }
    }
    if (list.length < num) break
    page++
  }
  // 清理其他目录遗留的歌词/封面索引，避免无限增长
  for (const key of Array.from(lyricFileIndex.keys())) {
    if (!dirLyricKeys.includes(key) && key.split('|')[0] === targetDir) lyricFileIndex.delete(key)
  }
  for (const key of Array.from(picFileIndex.keys())) {
    if (!dirPicKeys.includes(key) && key.split('|')[0] === targetDir) picFileIndex.delete(key)
  }
  for (const dir of Array.from(genericPicIndex.keys())) {
    if (dir === targetDir) genericPicIndex.delete(dir)
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
  // 播放缓存（整文件预下载）放 Caches 目录（temporaryDirectoryPath）：
  // - 系统在磁盘空间不足时可自动清理，不会无限累积；
  // - 不参与 iCloud 备份（Documents 会被备份，放音频缓存会浪费云空间并触发审核警告）。
  return `${temporaryDirectoryPath}/BaiduPan`
}

export const downloadBaiduPanMusic = async (
  musicInfo: LX.BaiduPan.MusicInfo,
  isRefresh = false
): Promise<string> => {
  assertCookieUsable()

  const hasPermission = await requestStoragePermission()
  if (!hasPermission) {
    throw new Error('没有存储权限，无法下载音乐')
  }

  const cacheDir = getBaiduPanPrivateDirectory()
  const fileName = `${musicInfo.meta.fsId}_${musicInfo.meta.fileName}`
  const filePath = `${cacheDir}/${fileName}`

  if (!isRefresh && (await existsFile(filePath))) return filePath

  await mkdir(cacheDir)

  // 改用 dlink 直链下载：/api/download?dir=&filename= 不是标准网页端接口，
  // 大概率拿不到文件。dlink + origin=dlna 免 Cookie/UA 绑定，可直接下载。
  const downloadUrl = await buildDlink({
    fsId: musicInfo.meta.fsId,
    path: musicInfo.meta.filePath,
  })

  // 用 XHR 下载（而非 RNFS.downloadFile）：RNFS 的 NSURLSession 会忽略手动设置的
  // Cookie/UA 头，导致 dlink 下载被防盗链拒绝；XHR 的 withCredentials=false +
  // setRequestHeader 能正确下发 Cookie/Referer/UA（与 list 接口一致的已验证链路）。
  const arrayBuffer = await xhrDownload(downloadUrl, getHeaders())
  await writeFile(filePath, Buffer.from(arrayBuffer).toString('base64'), 'base64')

  // 下载完成后按上限自动清理云盘缓存（LRU），避免缓存无限累积
  void enforceCloudCacheLimit((settingState.setting['player.cacheLimit'] || 0) * 1024 * 1024)

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

const buildDlink = async (file: { fsId: number | string, path: string }): Promise<string> => {
  assertCookieUsable()

  const bdstoken = getBdstoken()
  const bdstokenQ = bdstoken ? `&bdstoken=${encodeURIComponent(bdstoken)}` : ''
  // fsids 形式是网页端/官方客户端的标准用法，比裸路径 target 更可靠；
  // 失败时降级用 JSON 数组形式的 target 重试。
  const body = await requestPanApi([
    `${API_BASE}/api/filemetas?fsids=${encodeURIComponent(`[${file.fsId}]`)}&dlink=1&web=1&clienttype=0&app_id=250528${bdstokenQ}`,
    `${API_BASE}/api/filemetas?target=${encodeURIComponent(JSON.stringify([file.path]))}&dlink=1&web=1&clienttype=0${bdstokenQ}`,
  ])
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
  const playUrl = await buildDlink({
    fsId: musicInfo.meta.fsId,
    path: musicInfo.meta.filePath,
  })
  dlinkCache.set(key, { url: playUrl, expire: Date.now() + DLINK_TTL_MS })
  return playUrl
}

// 拉取音频同目录同名 .lrc 歌词文本（通过 dlink 直链）
export const fetchBaiduPanLrc = async (audioPath: string): Promise<string | null> => {
  const lrc = lyricFileIndex.get(getLyricIndexKey(audioPath))
  if (!lrc) return null
  const key = `lrc:${lrc.path}`
  const cached = dlinkCache.get(key)
  const url =
    cached && cached.expire > Date.now()
      ? cached.url
      : await buildDlink(lrc).then(u => {
          dlinkCache.set(key, { url: u, expire: Date.now() + DLINK_TTL_MS })
          return u
        })
  const response = await fetch(url)
  if (!response.ok) return null
  const text = await response.text()
  return text?.trim() ? text : null
}

// 获取网盘内封面图片的 dlink 直链（可直接作为图片 URL 使用，无需下载到本地）
export const getBaiduPanPicUrl = async (
  musicInfo: LX.BaiduPan.MusicInfo,
  isRefresh = false
): Promise<string | null> => {
  const pic = findBaiduPanPicPath(musicInfo.meta.filePath)
  if (!pic) return null
  const key = `pic:${pic.path}`
  const cached = dlinkCache.get(key)
  if (!isRefresh && cached && cached.expire > Date.now()) return cached.url
  try {
    const url = await buildDlink({ fsId: pic.fsId, path: pic.path })
    dlinkCache.set(key, { url, expire: Date.now() + DLINK_TTL_MS })
    return url
  } catch {
    return null
  }
}

// 播放器 track 使用的请求头：dlink 直链（origin=dlna）虽免 UA 绑定，
// 但部分 CDN 节点仍校验 Referer/UA，这里带上桌面 UA + Referer 更稳妥。
export const getBaiduPanTrackHeaders = (): Record<string, string> => ({
  'User-Agent': getUserAgent(),
  Referer: `${API_BASE}/disk/main`,
})
