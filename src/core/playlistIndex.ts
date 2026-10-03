import wyUserApi from '@/utils/musicSdk/wy/user'
import txUserApi from '@/utils/musicSdk/tx/user'
import { getUserPlaylists as getKgUserPlaylists } from '@/utils/musicSdk/kg/utils/api'
import settingState from '@/store/setting/state'
import userState from '@/store/user/state'
import {
  setWySubscribedPlaylists,
  setTxSubscribedPlaylists,
  setKgSubscribedPlaylists,
} from '@/store/user/action'
import {
  getPlaylistIndexCache,
  savePlaylistIndexCache,
  type PlaylistIndexCache,
} from '@/utils/data/playlistIndex'

/**
 * 「我的歌单」索引（各平台 cookie 登录后的自建 / 收藏歌单列表）统一入口。
 *
 * - getPlaylistIndex(source)：缓存优先；没有缓存（或 force）才联网拉取，拉完写缓存并回填 store。
 * - 启动时（core/init/dataInit）调用一次即可让「我的歌单」立刻有数据（离线也有）。
 * - 平台设置的「刷新同步」用 force = true 强制重拉本平台索引 + 已缓存歌单内容。
 */

export interface PlaylistIndexResult {
  source: LX.OnlineSource
  /** 分组名 → 歌单数组：wy = all，tx/kg = created / collected */
  lists: Record<string, any[]>
  fromCache: boolean
  updatedAt: number
}

const cookieTail = (cookie?: string) => (cookie ? cookie.slice(-16) : '')

const getCookies = () => ({
  wy: settingState.setting['common.wy_cookie'] ?? '',
  tx: settingState.setting['common.tx_cookie'] ?? '',
  kg: settingState.setting['common.kg_cookie'] ?? '',
})

/** 登录取值：wy 依赖 uid，tx/kg 只看 cookie；返回 null 表示未登录 */
const getLoginKey = async(source: LX.OnlineSource): Promise<string | null> => {
  const cookies = getCookies()
  switch (source) {
    case 'wy': {
      const cookie = cookies.wy
      if (!cookie) return null
      let uid = userState.wy_uid
      if (!uid) {
        try {
          uid = await wyUserApi.getUid(cookie)
        } catch {
          return null
        }
      }
      return `${uid}:${cookieTail(cookie)}`
    }
    case 'tx':
      return cookies.tx ? cookieTail(cookies.tx) : null
    case 'kg':
      return cookies.kg ? cookieTail(cookies.kg) : null
    default:
      return null
  }
}

/** 联网拉取并格式化（结构与 store / 页面一致） */
const fetchPlaylistIndex = async(source: LX.OnlineSource): Promise<Record<string, any[]>> => {
  const cookies = getCookies()
  switch (source) {
    case 'wy': {
      const uid = userState.wy_uid ?? await wyUserApi.getUid(cookies.wy)
      const list = await wyUserApi.getUserPlaylists(uid, cookies.wy)
      return { all: (list as any[]) ?? [] }
    }
    case 'tx': {
      const [createdRaw, collected] = await Promise.all([
        txUserApi.getCreatedPlaylists(),
        txUserApi.getFavPlaylists(1, 50).then((result: any) => result?.list ?? []).catch(() => []),
      ])
      const created = (createdRaw as any[]) ?? []
      // 「我喜欢」歌单没有封面，用收藏歌曲第一首的专辑图兜底（与页面原逻辑一致）
      const favoritesPlaylist = created.find((p: any) => p.isFavorites)
      if (favoritesPlaylist && favoritesPlaylist.songCount > 0) {
        try {
          const favSongs = await txUserApi.getFavSongs(1, 1)
          const firstSong = favSongs?.list?.[0]
          if (firstSong) {
            favoritesPlaylist.cover = firstSong.albumMid
              ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${firstSong.albumMid}.jpg`
              : favoritesPlaylist.cover
          }
        } catch {}
      }
      return { created, collected: (collected as any[]) ?? [] }
    }
    case 'kg': {
      const result = await getKgUserPlaylists(cookies.kg)
      if (!result?.success || !result.data) throw new Error(result?.message || '获取酷狗歌单失败')
      return {
        created: result.data.createdList ?? [],
        collected: result.data.collectedList ?? [],
      }
    }
    default:
      throw new Error(`平台 ${source} 不支持歌单索引同步`)
  }
}

/** 回填全局 store（收藏/自建歌单的共享状态） */
const applyToStore = (source: LX.OnlineSource, lists: Record<string, any[]>) => {
  switch (source) {
    case 'wy':
      setWySubscribedPlaylists((lists.all ?? []) as any)
      break
    case 'tx':
      setTxSubscribedPlaylists(
        [...(lists.created ?? []), ...(lists.collected ?? [])].map((p: any) => ({
          ...p,
          // store 侧历史上用 tx__ 前缀做 id，保持格式一致避免下游匹配失效
          id: String(p.id ?? '').startsWith('tx__') ? p.id : `tx__${p.id}`,
        })) as any,
      )
      break
    case 'kg':
      setKgSubscribedPlaylists(
        [...(lists.created ?? []), ...(lists.collected ?? [])].map((p: any) => ({
          ...p,
          id: p.id ?? `kg_${p.listid}`,
        })) as any,
      )
      break
  }
}

const readCache = async(source: LX.OnlineSource): Promise<PlaylistIndexCache | null> => {
  const loginKey = await getLoginKey(source)
  if (!loginKey) return null
  return getPlaylistIndexCache(source, loginKey)
}

export const getPlaylistIndex = async(
  source: LX.OnlineSource,
  { force = false }: { force?: boolean } = {},
): Promise<PlaylistIndexResult> => {
  if (!force) {
    const cached = await readCache(source)
    if (cached) {
      applyToStore(source, cached.lists)
      return { source, lists: cached.lists, fromCache: true, updatedAt: cached.updatedAt }
    }
  }
  const loginKey = await getLoginKey(source)
  if (!loginKey) throw new Error('未登录，请先在平台设置中填写 Cookie')
  const lists = await fetchPlaylistIndex(source)
  applyToStore(source, lists)
  try {
    await savePlaylistIndexCache(source, loginKey, lists)
  } catch (err: any) {
    // 列表本身已经拿到并回填 store（用户能看到），失败的是落盘：给一条能区分
    // 「拉取失败」与「缓存写入失败」的错误信息，页面据此提示，便于定位存储问题。
    throw new Error(`歌单已获取，但写入缓存失败：${err?.message ?? err}`)
  }
  return { source, lists, fromCache: false, updatedAt: Date.now() }
}

/** 该平台索引缓存里的歌单总数（无缓存返回 0） */
export const getCachedPlaylistIndexCount = async(source: LX.OnlineSource): Promise<number> => {
  const cached = await readCache(source)
  if (!cached) return 0
  return Object.values(cached.lists).reduce((sum, list) => sum + (list?.length ?? 0), 0)
}
