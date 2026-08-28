/**
 * 本地与下载 · 专用播放接口
 *
 * 供「本地与下载」页面的本地音乐与下载音乐使用，不走自定义源管理
 * （apis('local') / getOtherSource 换源链路）。
 *
 * 链路设计：
 * - 播放：优先本地文件（离线可用）；本地缺失且有网络时，走软件内置平台
 *   直连接口（网易 cookie 直连、B 站直连）自动回退获取播放链接。
 * - 歌词：离线读内嵌歌词 / 同名 .lrc；有网络时通过内置平台接口
 *   （kw/kg/tx/wy/mg）逐平台回退匹配。
 * - 封面：meta 缓存 → 本地内嵌封面 → 内置平台接口逐平台回退。
 */
import musicSdk from '@/utils/musicSdk'
import wySdk from '@/utils/musicSdk/wy'
import bilibiliSdk from '@/utils/musicSdk/bilibili'
import { existsFile, readFile } from '@/utils/fs'
import { readPic, readLyric } from '@/utils/localMediaMetadata'
import { buildLyricInfo } from './utils'

export interface LocalPlayTarget {
  name: string
  singer: string
  // 本地文件路径（下载文件或本地音频），离线播放与本地歌词/封面来源
  filePath?: string
  // 已缓存的封面
  picUrl?: string | null
  // 期望音质（下载任务自带，本地音乐可空）
  quality?: LX.Quality
}

// 内置直连 URL 平台回退顺序：网易（cookie 直连）→ B 站（直连）
const URL_SOURCES = ['wy', 'bilibili'] as const
// 歌词/封面可用的内置平台回退顺序
const META_SOURCES = ['kw', 'wy', 'kg', 'tx', 'mg'] as const
const URL_QUALITYS: LX.Quality[] = ['320k', '128k']

const cleanName = (name: string): string => {
  const cleaned = (name || '')
    .replace(/\s*[\[【(（].*?[\]】)）]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || name
}

interface SongCandidate {
  source: string
  songmid: string
  name: string
  singer: string
  interval?: string | number
  img?: string
  [key: string]: any
}

// 按歌名+歌手在内置平台搜索候选（跨平台），歌名完全匹配优先
const searchCandidates = async (name: string, singer: string): Promise<SongCandidate[]> => {
  const keyword = `${cleanName(name)} ${singer || ''}`.trim()
  const result: SongCandidate[] = []

  const lists = (await musicSdk.searchMusic({
    name: cleanName(name),
    singer: singer || '',
    limit: 10,
  }).catch(() => [])) as any[]

  for (const list of lists) {
    const source = list.source as string
    if (!source || !META_SOURCES.includes(source as any)) continue
    for (const item of list.list ?? []) {
      result.push({ ...item, source })
    }
  }

  const target = cleanName(name).toLowerCase()
  result.sort((a, b) => {
    const aMatch = (a.name || '').toLowerCase() === target ? 0 : 1
    const bMatch = (b.name || '').toLowerCase() === target ? 0 : 1
    return aMatch - bMatch
  })
  return result
}

const searchBilibili = async (name: string, singer: string): Promise<SongCandidate | null> => {
  const keyword = `${cleanName(name)} ${singer || ''}`.trim()
  try {
    const result = (await bilibiliSdk.musicSearch.search(keyword, 1, 10).catch(() => null)) as any
    const first = result?.list?.[0]
    if (!first?.songmid) return null
    return { ...first, source: 'bilibili' }
  } catch {
    return null
  }
}

// 内置平台直连获取播放 URL（wy cookie 直连 / bilibili 直连）
const getOnlineUrl = async (
  target: LocalPlayTarget,
  candidates: SongCandidate[]
): Promise<string> => {
  const qualitys = target.quality && URL_QUALITYS.includes(target.quality)
    ? [target.quality, ...URL_QUALITYS.filter(q => q !== target.quality)]
    : URL_QUALITYS

  for (const source of URL_SOURCES) {
    if (source === 'wy') {
      const wyCandidate = candidates.find(c => c.source === 'wy' && c.songmid)
      if (!wyCandidate) continue
      for (const quality of qualitys) {
        try {
          const result: any = await (wySdk.cookie.getMusicUrl(wyCandidate as any, quality) as any).promise
          if (result?.url) return result.url
        } catch {}
      }
    } else {
      const bilibiliCandidate =
        candidates.find(c => c.source === 'bilibili' && c.songmid) ??
        (await searchBilibili(target.name, target.singer))
      if (!bilibiliCandidate) continue
      try {
        const result: any = await (bilibiliSdk.getMusicUrl(bilibiliCandidate as any, '128k') as any).promise
        if (result?.url) return result.url
      } catch {}
    }
  }
  throw new Error('无法从内置平台获取播放链接')
}

export const getMusicUrl = async ({
  target,
  isRefresh = false,
}: {
  target: LocalPlayTarget
  isRefresh?: boolean
}): Promise<string> => {
  // 1. 本地文件（离线可用）
  if (!isRefresh && target.filePath) {
    try {
      if (await existsFile(target.filePath)) return target.filePath
    } catch {}
  }

  // 2. 内置平台直连回退
  const candidates = await searchCandidates(target.name, target.singer)
  return getOnlineUrl(target, candidates)
}

const readSidecarLyric = async (filePath: string): Promise<string | null> => {
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
  target,
  isRefresh = false,
}: {
  target: LocalPlayTarget
  isRefresh?: boolean
}): Promise<LX.Player.LyricInfo> => {
  // 1. 离线来源：内嵌歌词 → 同名 .lrc
  if (target.filePath) {
    const embedded = await readLyric(target.filePath).catch(() => null)
    if (embedded) return buildLyricInfo({ lyric: embedded })
    const sidecar = await readSidecarLyric(target.filePath)
    if (sidecar) return buildLyricInfo({ lyric: sidecar })
  }

  // 2. 内置平台逐平台回退
  const candidates = await searchCandidates(target.name, target.singer)
  for (const candidate of candidates) {
    const sdk = (musicSdk as any)[candidate.source]
    if (!sdk?.getLyric || !candidate.songmid) continue
    try {
      const lyricInfo = await sdk.getLyric(candidate)
      if (lyricInfo?.lyric) return buildLyricInfo(lyricInfo)
    } catch {}
  }

  return buildLyricInfo({ lyric: '' })
}

export const getPicUrl = async ({
  target,
  isRefresh = false,
}: {
  target: LocalPlayTarget
  isRefresh?: boolean
}): Promise<string> => {
  // 1. 本地内嵌/sidecar 封面（优先本地文件，离线可用）
  if (target.filePath) {
    try {
      if (await existsFile(target.filePath)) {
        const picPath = await readPic(target.filePath).catch(() => null)
        if (picPath) return picPath.startsWith('/') ? `file://${picPath}` : picPath
      }
    } catch {}
  }

  // 2. meta 缓存
  if (!isRefresh && target.picUrl) return target.picUrl

  // 3. 内置平台逐平台回退（搜索结果自带 img 兜底）
  const candidates = await searchCandidates(target.name, target.singer)
  for (const candidate of candidates) {
    const sdk = (musicSdk as any)[candidate.source]
    if (!candidate.songmid) continue
    try {
      if (sdk?.getPic) {
        const pic = await sdk.getPic(candidate)
        if (pic) return pic
      }
    } catch {}
    if (candidate.img) return candidate.img
  }
  return ''
}
