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

// 并发上限：列表逐行触发封面匹配时，若不限制会瞬间并发数十个跨平台搜索，
// 集中唤醒射频并抢占 CPU/电量（尤其在播放中打开汽水歌单时）。串行化以削峰。
const MAX_CONCURRENT = 4
let activeCount = 0
const taskQueue: Array<() => void> = []

const runWithLimit = (fn: () => Promise<string>): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    const execute = () => {
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

export const getCachedQsCover = (song: LX.Music.MusicInfoOnline): string => {
  return qsCoverCache.get(`${song.name}|${song.singer}`) ?? ''
}

export const fetchQsCover = (song: LX.Music.MusicInfoOnline): Promise<string> => {
  const key = `${song.name}|${song.singer}`
  const cached = qsCoverCache.get(key)
  if (cached) return Promise.resolve(cached)
  const inflight = qsCoverInflight.get(key)
  if (inflight) return inflight
  const task = runWithLimit(() => getLocalPlayPicUrl({
    target: { name: song.name, singer: song.singer, filePath: '', picUrl: null },
  }))
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
