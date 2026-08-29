import songlistState, {
  type TagInfo,
  type ListDetailInfo,
  type ListInfo,
} from '@/store/songlist/state'
import songlistActions, { LIST_LOAD_LIMIT } from '@/store/songlist/action'
import { deduplicationList, toNewMusicInfo } from '@/utils'
import musicSdk from '@/utils/musicSdk'
import { log } from '@/utils/log'
import { getPicUrl as getLocalPlayPicUrl } from '@/core/music/localPlay'
import { updateListMusics } from '@/core/list'

// 汽水(qs) 源自身通常不返回可用封面，这里用跨平台匹配（企鹅→网易→酷狗→酷我→咪咕）
// 补全列表封面：仅在该歌曲尚无可用封面时后台拉取，成功后写回列表 store，逐张“浮现”。
// 控制并发避免一次性打爆各音源接口。
const fetchQsListCovers = (listId: string, list: LX.Music.MusicInfoOnline[]) => {
  const qsSongs = list.filter((s) => s.source === 'qs' && !(s.meta as any)?.picUrl)
  if (!qsSongs.length) return
  const CONCURRENCY = 3
  let idx = 0
  const worker = () => {
    if (idx >= qsSongs.length) return
    const song = qsSongs[idx++]
    getLocalPlayPicUrl({
      target: { name: song.name, singer: song.singer, filePath: '', picUrl: null },
    })
      .then((url) => {
        if (url) {
          void updateListMusics([
            { id: listId, musicInfo: { ...song, meta: { ...song.meta, picUrl: url } } },
          ])
        }
      })
      .catch(() => {})
      .finally(worker)
  }
  for (let i = 0; i < CONCURRENCY; i++) worker()
}

interface DetailPageCache {
  data: ListDetailInfo
  sourcePage: number
}
type LimitDetailCache = Map<string, DetailPageCache | ListDetailInfo['list']>
type CacheValue = LimitDetailCache | ListInfo

const cache = new Map<string, CacheValue>()

// 并发治理：从歌单播放歌曲时的全量加载（getListDetailAll）会与界面滚动触发的
// "加载更多"并发调用 getListDetailLimit，并发请求会互相覆盖缓存分块
// （tempList 被双重消费），导致歌曲重复/丢失、分页边界错乱。
// cache 是模块级持久缓存，一旦污染，之后所有浏览都加载不全。
// 修复：同歌单同页的并发请求共享同一个 Promise（去重）；同歌单的不同页请求
// 串行排队执行，避免读到过期的 sourcePage / tempList。
const inflightDetailRequests = new Map<string, Promise<ListDetailInfo>>()
const detailRequestQueues = new Map<string, Promise<unknown>>()

/**
 * Get sort list
 * @param source
 * @returns
 */
export const getSortList = (source: LX.OnlineSource) => {
  return songlistState.sortList[source]!
}

/**
 * Get tag list
 * @param source
 * @returns
 */
export const getTags = async <T extends LX.OnlineSource>(source: T) => {
  if (songlistState.tags[source]) return songlistState.tags[source] as TagInfo<T>
  const info = await (musicSdk[source]?.songList.getTags() as Promise<TagInfo<T>>)
  songlistActions.setTags(info, source)
  return info
}

/**
 * Set list basic info before loading (for reload after failure)
 * @param source
 * @param tagId
 * @param sortId
 */
export const setListInfo: typeof songlistActions.setListInfo = (source, tagId, sortId) => {
  clearList()
  songlistActions.setListInfo(source, tagId, sortId)
}
/**
 * Set list info
 * @param result
 * @param tagId
 * @param sortId
 * @param page
 * @returns
 */
export const setList: typeof songlistActions.setList = (result, tagId, sortId, page) => {
  return songlistActions.setList(result, tagId, sortId, page)
}

export const clearList = () => {
  songlistActions.clearList()
}

/**
 * Get songlist list
 * @param source Songlist source
 * @param tabId Type id
 * @param sortId Sort id
 * @param page Page number
 * @param isRefresh Whether to skip cache
 * @returns
 */
export const getList = async (
  source: LX.OnlineSource,
  tabId: string,
  sortId: string,
  page: number,
  isRefresh = false
): Promise<ListInfo> => {
  let pageKey = `slist__${source}__${sortId}__${tabId}__${page}`

  let listCache = cache.get(pageKey) as ListInfo
  if (listCache) {
    if (isRefresh) cache.delete(pageKey)
    else return listCache
  }

  return musicSdk[source]?.songList.getList(sortId, tabId, page).then((result: ListInfo) => {
    cache.set(pageKey, result)
    return result
    // if (pageKey != listInfo.key) return
    // setList(result, tabId, sortId, page)
  })
}

/**
 * Get paginated songs from songlist detail (for local page size control)
 * @param source Source
 * @param id Songlist id
 * @param page Page number
 * @returns
 */
const doGetListDetailLimit = async (
  source: LX.OnlineSource,
  id: string,
  page: number
): Promise<ListDetailInfo> => {
  const listKey = `sdetail__${source}__${id}`
  const prevPageKey = `sdetail__${source}__${id}__${page - 1}`
  const tempListKey = `sdetail__${source}__${id}__temp`

  let listCache = cache.get(listKey) as LimitDetailCache
  if (!listCache) cache.set(listKey, (listCache = new Map()))
  let sourcePage = 0
  {
    const prevPageData = listCache.get(prevPageKey) as DetailPageCache
    if (prevPageData) sourcePage = prevPageData.sourcePage
  }

  return (
    musicSdk[source]?.songList.getListDetail(id, sourcePage + 1).then((result: ListDetailInfo) => {
      if (listCache !== cache.get(listKey)) {
        cache.set(listKey, (listCache = new Map()))
      }
      result.list = deduplicationList(
        result.list.map((m) => toNewMusicInfo(m)).filter(Boolean) as LX.Music.MusicInfoOnline[]
      )
      // 汽水(qs) 歌单/排行榜：用跨平台匹配补全封面（后台异步，逐张浮现）
      if (source === 'qs') fetchQsListCovers(id, result.list)
      let p = page
      const tempList = listCache.get(tempListKey) as ListDetailInfo['list']
      if (tempList) {
        listCache.delete(tempListKey)
        listCache.set(`sdetail__${source}__${id}__${p}`, {
          data: {
            ...result,
            list: [...tempList, ...result.list.splice(0, LIST_LOAD_LIMIT - tempList.length)],
            page: p,
            limit: LIST_LOAD_LIMIT,
          },
          sourcePage,
        })
        p++
      }
      sourcePage++
      do {
        if (
          result.list.length < LIST_LOAD_LIMIT &&
          sourcePage < Math.ceil(result.total / result.limit)
        ) {
          listCache.set(tempListKey, result.list.splice(0, LIST_LOAD_LIMIT))
          break
        }
        listCache.set(`sdetail__${source}__${id}__${p}`, {
          data: {
            ...result,
            list: result.list.splice(0, LIST_LOAD_LIMIT),
            page: p,
            limit: LIST_LOAD_LIMIT,
          },
          sourcePage,
        })
        p++
      } while (result.list.length > 0)
      return (listCache.get(`sdetail__${source}__${id}__${page}`) as DetailPageCache).data
    }) ?? Promise.reject(new Error('source not found'))
  )
}

// 带并发治理的 getListDetailLimit：同页去重 + 同歌单串行（见上方注释）
const getListDetailLimit = (
  source: LX.OnlineSource,
  id: string,
  page: number
): Promise<ListDetailInfo> => {
  const listKey = `sdetail__${source}__${id}`
  const reqKey = `${listKey}__${page}`
  const inflight = inflightDetailRequests.get(reqKey)
  if (inflight) return inflight
  const prev = detailRequestQueues.get(listKey) ?? Promise.resolve()
  const run = prev
    .catch(() => {})
    .then(() => doGetListDetailLimit(source, id, page))
    .finally(() => {
      if (inflightDetailRequests.get(reqKey) === run) inflightDetailRequests.delete(reqKey)
    })
  inflightDetailRequests.set(reqKey, run)
  detailRequestQueues.set(listKey, run.catch(() => {}))
  return run
}

/**
 * Set list detail basic info before loading (for reload after failure)
 * @param source
 * @param tagId
 * @param sortId
 */
export const setListDetailInfo: typeof songlistActions.setListDetailInfo = (source, id) => {
  clearListDetail()
  songlistActions.setListDetailInfo(source, id)
}
export const setListDetail: typeof songlistActions.setListDetail = (result, id, page) => {
  return songlistActions.setListDetail(result, id, page)
}

export const clearListDetail = () => {
  songlistActions.clearListDetail()
}

/**
 * Get single page songs from songlist
 * @param id Songlist id
 * @param source Songlist source
 * @param isRefresh Whether to skip cache
 * @returns
 */
export const getListDetail = async (
  id: string,
  source: LX.OnlineSource,
  page: number,
  isRefresh = false
): Promise<ListDetailInfo> => {
  const listKey = `sdetail__${source}__${id}`
  const pageKey = `sdetail__${source}__${id}__${page}`

  let listCache = cache.get(listKey) as LimitDetailCache
  if (!listCache || isRefresh) {
    cache.set(listKey, (listCache = new Map()))
  }

  let pageCache = listCache.get(pageKey) as DetailPageCache
  if (pageCache) return pageCache.data

  return getListDetailLimit(source, id, page)
}

/**
 * Get all songs from songlist
 * @param id Songlist id
 * @param source Songlist source
 * @param isRefresh Whether to skip cache
 * @returns
 */
export const getListDetailAll = async (
  source: LX.OnlineSource,
  id: string,
  isRefresh = false
): Promise<LX.Music.MusicInfoOnline[]> => {
  // console.log(tabId)
  const listKey = `sdetail__${source}__${id}`
  let listCache = cache.get(listKey) as LimitDetailCache
  if (!listCache || isRefresh) {
    cache.set(listKey, (listCache = new Map()))
  }

  const loadData = async (page: number): Promise<ListDetailInfo> => {
    const pageKey = `sdetail__${source}__${id}__${page}`
    let pageCache = listCache.get(pageKey) as DetailPageCache
    if (pageCache) return pageCache.data
    return getListDetailLimit(source, id, page)
  }
  return loadData(1)
    .then(async (result) => {
      if (result.total <= result.limit) return result.list

      let maxPage = Math.ceil(result.total / result.limit)
      const loadDetail = async (loadPage = 2): Promise<LX.Music.MusicInfoOnline[]> => {
        return loadPage == maxPage
          ? loadData(loadPage).then((result) => result.list)
          : loadData(loadPage).then((result1) =>
              loadDetail(++loadPage).then((result2) => [...result1.list, ...result2])
            )
      }
      return loadDetail().then((result2) => [...result.list, ...result2])
    })
    .then((list) => deduplicationList(list))
}

export const clearListDetailCache = (source: LX.OnlineSource, id: string) => {
  const listKey = `sdetail__${source}__${id}`
  if (cache.has(listKey)) {
    cache.delete(listKey)
  }
  if (source === 'kg') {
    try {
      const kgSongList = require('@/utils/musicSdk/kg/songList').default
      kgSongList.evictDetailCache?.(id)
    } catch {}
  }
}
