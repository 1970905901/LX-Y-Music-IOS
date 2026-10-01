import { getAllKeys, getData, removeData, removeDataMultiple, saveData } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'

/**
 * 歌单详情本地缓存。
 *
 * 背景：cookie 登录后的歌单（网易云 / QQ / 酷狗收藏歌单等）动辄上千首，
 * 而歌单详情页是「按页拉取」的——进歌单只拉第一页，往下滚动才继续拉，于是：
 *  - 每次进歌单都要重新请求，退出再进又回到第一页；
 *  - 拉取不完时后面的歌既看不到也搜不到（搜索只覆盖已加载部分）。
 *
 * 这里把「整张歌单（全量歌曲 + 歌单信息 + 更新时间）」落到 AsyncStorage：
 * 进歌单优先整表读缓存（不请求网络），只有缓存不存在或用户主动「更新同步」
 * 时才逐页拉全量。缓存可在「设置 - 资源缓存管理」查看与清理。
 */

export interface SonglistDetailCacheInfo {
  name?: string
  img?: string
  desc?: string
  author?: string
  play_count?: string
  userId?: string | number
}

export interface SonglistDetailCache {
  source: LX.OnlineSource
  id: string
  /** 歌单名（缓存列表 / 同步按钮展示用） */
  name: string
  /** 平台侧歌单总曲目数（拉全后应等于 list.length） */
  total: number
  /** 是否已把整张歌单拉全；false = 只有部分页，下次进入会继续补全 */
  complete: boolean
  /** 最近一次写入时间戳（毫秒） */
  updatedAt: number
  info: SonglistDetailCacheInfo
  list: LX.Music.MusicInfoOnline[]
}

export interface SonglistDetailCacheSummaryItem {
  key: string
  source: LX.OnlineSource
  id: string
  name: string
  songCount: number
  total: number
  complete: boolean
  updatedAt: number
}

const keyOf = (source: LX.OnlineSource, id: string) =>
  `${storageDataPrefix.songlistDetailCache}${source}__${id}`

export const getSonglistDetailCache = async(
  source: LX.OnlineSource,
  id: string,
): Promise<SonglistDetailCache | null> => {
  if (!source || !id) return null
  const data = await getData<SonglistDetailCache>(keyOf(source, id)).catch(() => null)
  if (!data?.list?.length) return null
  return data
}

export const saveSonglistDetailCache = async(data: SonglistDetailCache) => {
  if (!data.source || !data.id || !data.list.length) return
  await saveData(keyOf(data.source, data.id), data)
}

export const removeSonglistDetailCache = async(source: LX.OnlineSource, id: string) => {
  await removeData(keyOf(source, id))
}

export const getSonglistDetailCacheKeys = async(): Promise<string[]> => {
  const keys = await getAllKeys()
  return keys.filter(key => key.startsWith(storageDataPrefix.songlistDetailCache))
}

/**
 * 缓存概览：条数 / 歌曲总数 / 占用体积估算（JSON 字符数，仅用于展示与清理判断）。
 * 同时把「还没拉全」的条目数报出来，便于提示用户去平台设置里同步。
 */
export const getSonglistDetailCacheSummary = async({ withSize = false }: { withSize?: boolean } = {}) => {
  const keys = await getSonglistDetailCacheKeys()
  const items: SonglistDetailCacheSummaryItem[] = []
  let size = 0
  for (const key of keys) {
    const data = await getData<SonglistDetailCache>(key).catch(() => null)
    if (!data?.list?.length) continue
    // 省电/省 CPU：size 需要把每条缓存（可达 MB 级）整串序列化，只有「资源管理器」
    // 真正要显示占用时才计算；平台设置里的统计走 withSize=false，避免每次刷新都做大字符串拼接。
    if (withSize) {
      try {
        size += JSON.stringify(data).length
      } catch {}
    }
    items.push({
      key,
      source: data.source,
      id: data.id,
      name: data.name || `${data.source}__${data.id}`,
      songCount: data.list.length,
      total: data.total || data.list.length,
      complete: Boolean(data.complete),
      updatedAt: data.updatedAt || 0,
    })
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt)
  return {
    count: items.length,
    songCount: items.reduce((sum, item) => sum + item.songCount, 0),
    incompleteCount: items.filter(item => !item.complete).length,
    size,
    items,
  }
}

export const clearSonglistDetailCache = async(keys?: string[]) => {
  const targetKeys = keys ?? await getSonglistDetailCacheKeys()
  if (!targetKeys.length) return
  await removeDataMultiple(targetKeys)
}
