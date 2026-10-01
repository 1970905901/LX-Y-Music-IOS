import { getAllKeys, getData, removeDataMultiple, saveData } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'

/**
 * 「我的歌单」索引缓存（各平台 cookie 登录后的自建/收藏歌单列表）。
 *
 * 与歌单详情缓存（songlistDetail.ts，存歌单内的歌曲）区分：
 * 这里存的是**歌单列表本身**（每个平台一份），解决两个问题：
 *  - 启动/进入「我的歌单」页要联网拉一次列表，没网时页面空着；
 *  - 每次都要等接口返回才看得到列表。
 *
 * 结构按平台分键保存，lists 保留平台自己的分组（如 tx/kg 的 created / collected），
 * 由 core/playlistIndex.ts 负责拉取、格式化与回填。loginKey 记录登录态（uid/cookie 摘要），
 * 换了账号自动视为未命中，避免展示上一个账号的歌单。
 */
export interface PlaylistIndexCache {
  source: LX.OnlineSource
  loginKey: string
  updatedAt: number
  /** 分组名 → 歌单数组；wy 只有 all，tx/kg 有 created / collected */
  lists: Record<string, any[]>
}

export interface PlaylistIndexCacheSummaryItem {
  key: string
  source: LX.OnlineSource
  count: number
  updatedAt: number
}

const keyOf = (source: LX.OnlineSource) => `${storageDataPrefix.playlistIndexCache}${source}`

export const getPlaylistIndexCache = async(
  source: LX.OnlineSource,
  loginKey: string,
): Promise<PlaylistIndexCache | null> => {
  const data = await getData<PlaylistIndexCache>(keyOf(source)).catch(() => null)
  if (!data?.lists) return null
  // 登录态不一致（换账号/清 cookie）视为未命中
  if (loginKey && data.loginKey !== loginKey) return null
  return data
}

export const savePlaylistIndexCache = async(
  source: LX.OnlineSource,
  loginKey: string,
  lists: Record<string, any[]>,
) => {
  await saveData(keyOf(source), { source, loginKey, updatedAt: Date.now(), lists } as PlaylistIndexCache)
}

export const getPlaylistIndexCacheSummary = async() => {
  const keys = await getAllKeys()
  const items: PlaylistIndexCacheSummaryItem[] = []
  for (const key of keys) {
    if (!key.startsWith(storageDataPrefix.playlistIndexCache)) continue
    const data = await getData<PlaylistIndexCache>(key).catch(() => null)
    if (!data?.lists) continue
    items.push({
      key,
      source: data.source,
      count: Object.values(data.lists).reduce((sum, list) => sum + (list?.length ?? 0), 0),
      updatedAt: data.updatedAt || 0,
    })
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt)
  return {
    items,
    count: items.length,
    playlistCount: items.reduce((sum, item) => sum + item.count, 0),
  }
}

export const clearPlaylistIndexCache = async(sources?: LX.OnlineSource[]) => {
  const keys = (await getAllKeys()).filter(key => key.startsWith(storageDataPrefix.playlistIndexCache))
  const targets = sources?.length
    ? keys.filter(key => sources.some(source => key === keyOf(source)))
    : keys
  if (!targets.length) return
  await removeDataMultiple(targets)
}
