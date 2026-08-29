import { getPicUrl as getLocalPlayPicUrl } from '@/core/music/localPlay'

/**
 * 汽水(qs) 封面跨平台匹配。
 *
 * 汽水源自身通常不返回可用封面，这里按「歌名+歌手」跨平台匹配
 * （企鹅 → 网易 → 酷狗 → 酷我 → 咪咕）取封面。
 *
 * 每次匹配都要跨 5 个平台搜索，列表里逐首拉取时代价很高，因此：
 * - 按「歌名|歌手」缓存结果，同名歌曲（多榜单重复 / 重复渲染）只请求一次；
 * - 同一 key 的并发请求共享同一个 Promise，避免重复打接口被限流。
 */
const qsCoverCache = new Map<string, string>()
const qsCoverInflight = new Map<string, Promise<string>>()

export const getCachedQsCover = (song: LX.Music.MusicInfoOnline): string => {
  return qsCoverCache.get(`${song.name}|${song.singer}`) ?? ''
}

export const fetchQsCover = (song: LX.Music.MusicInfoOnline): Promise<string> => {
  const key = `${song.name}|${song.singer}`
  const cached = qsCoverCache.get(key)
  if (cached) return Promise.resolve(cached)
  const inflight = qsCoverInflight.get(key)
  if (inflight) return inflight
  const task = getLocalPlayPicUrl({
    target: { name: song.name, singer: song.singer, filePath: '', picUrl: null },
  })
    .then((url) => {
      if (url) qsCoverCache.set(key, url)
      return url
    })
    .catch(() => '')
    .finally(() => {
      qsCoverInflight.delete(key)
    })
  qsCoverInflight.set(key, task)
  return task
}
