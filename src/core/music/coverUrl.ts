import { getPicPath } from './index'
import { getCachedQsCover, fetchQsCover } from './qsCover'

/**
 * 列表项封面动态获取。
 *
 * 问题背景：cookie 登录平台歌单、WebDAV 同步、备份导入的歌曲，其 meta.picUrl 常为空，
 * 列表直接用静态 meta.picUrl 就显示无封面；而播放时 player.ts 会调 getPicPath 动态
 * 获取（在线接口/本地内嵌/网盘封面），所以「播放有封面、列表无封面」。
 *
 * 这里把同一套动态获取逻辑下沉到列表层：meta.picUrl 为空时按需调用 getPicPath
 * （内部已按 source 分发：在线 / webdav / 本地 / qs），结果按「歌名|歌手」缓存，
 * 并带并发上限，避免列表逐行触发请求打爆接口。
 */
const coverCache = new Map<string, string>()
const coverInflight = new Map<string, Promise<string>>()

const MAX_CONCURRENT = 4
let activeCount = 0
const taskQueue: Array<() => void> = []

const runWithLimit = async(fn: () => Promise<string>): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const execute = (): void => {
      activeCount++
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeCount--
          const next = taskQueue.shift()
          if (next) next()
        })
    }
    if (activeCount < MAX_CONCURRENT) execute()
    else taskQueue.push(execute)
  })
}

interface CoverSong { source: string, name: string, singer: string }

const keyOf = (song: CoverSong): string =>
  `${song.source}|${song.name}|${song.singer}`

export const getCachedCoverUrl = (song: CoverSong): string => {
  if (song.source === 'qs') return getCachedQsCover(song as LX.Music.MusicInfoOnline)
  return coverCache.get(keyOf(song)) ?? ''
}

export const fetchCoverUrl = async(song: CoverSong): Promise<string> => {
  // qs 源沿用既有跨平台匹配逻辑（含其独立缓存）
  if (song.source === 'qs') return fetchQsCover(song as LX.Music.MusicInfoOnline)

  const key = keyOf(song)
  const cached = coverCache.get(key)
  if (cached) return cached
  const inflight = coverInflight.get(key)
  if (inflight) return inflight

  const task = runWithLimit(async() =>
    getPicPath({ musicInfo: song as LX.Music.MusicInfo, isRefresh: false }),
  )
    .then((url) => {
      if (url) coverCache.set(key, url)
      return url
    })
    .catch(() => '')
    .finally(() => {
      coverInflight.delete(key)
    })
  coverInflight.set(key, task)
  return task
}
