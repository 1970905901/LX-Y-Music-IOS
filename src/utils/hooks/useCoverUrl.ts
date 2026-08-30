import { useEffect, useState } from 'react'
import { getCachedCoverUrl, fetchCoverUrl } from '@/core/music/coverUrl'

/**
 * 列表项封面 URL hook。
 *
 * 优先使用歌曲自带的 meta.picUrl；为空时按需动态获取（在线接口 / 本地内嵌 /
 * 网盘封面 / qs 跨平台匹配），结果带缓存与并发限制（见 core/music/coverUrl.ts）。
 * 用于解决「cookie 歌单 / WebDAV 同步 / 备份导入的歌单列表无封面，但播放时有封面」。
 */
const useCoverUrl = (item: {
  source: string
  name: string
  singer: string
  meta?: { picUrl?: string | null }
}): string => {
  // 汽水(qs) 等音源自身返回的封面（meta.picUrl）通常不可用/为空，播放链路对此一律
  // 走跨平台匹配（core/music/index.ts 对 qs 强制 picUrl=null）。列表侧保持一致：
  // 忽略 meta.picUrl，统一走 getCachedCoverUrl / fetchCoverUrl（qs 会分发到 qsCover
  // 跨平台匹配），避免「列表用不可用封面加载失败、播放详情页却有封面」的不一致。
  const isCrossMatchSource = item.source === 'qs'
  const [url, setUrl] = useState<string>(() =>
    isCrossMatchSource ? getCachedCoverUrl(item) : (item.meta?.picUrl ?? getCachedCoverUrl(item))
  )

  useEffect(() => {
    if (!isCrossMatchSource && item.meta?.picUrl) {
      setUrl(item.meta.picUrl)
      return
    }
    const cached = getCachedCoverUrl(item)
    if (cached) {
      setUrl(cached)
      return
    }
    let ignore = false
    void fetchCoverUrl(item).then((pic) => {
      if (!ignore && pic) setUrl(pic)
    })
    return () => {
      ignore = true
    }
  }, [item, isCrossMatchSource])

  return url
}

export default useCoverUrl
