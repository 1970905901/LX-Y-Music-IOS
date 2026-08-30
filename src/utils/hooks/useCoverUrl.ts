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
  const [url, setUrl] = useState<string>(() => item.meta?.picUrl ?? getCachedCoverUrl(item))

  useEffect(() => {
    if (item.meta?.picUrl) {
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
  }, [item])

  return url
}

export default useCoverUrl
