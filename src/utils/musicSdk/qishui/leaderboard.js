import { formatPlayTime } from '@/utils/common'
import songList from './songList'

const H5_UA = 'Luna/19.1.0 Android'
const WEB_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

// 汽水排行榜本质是官方歌单。抖音网页 SSR 会为 SEO 内嵌歌曲 ID，
// 通过 SSR HTML 提取歌曲 ID，再用 H5 SEO 接口（无需签名）批量取歌曲详情。
const BOARDS = [
  { id: 'qs__7456941237036320787', name: '音乐排行榜', bangid: '7456941237036320787' },
]

// 抖音/汽水图片对象 → 完整 URL
const pickUrl = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0] || ''
  // 抖音图片对象标准结构：{ url_list: ['https://...', ...], uri, width, height }
  if (Array.isArray(value.url_list) && value.url_list.length > 0) return value.url_list[0]
  if (Array.isArray(value.urls) && value.urls.length > 0) return `${value.urls[0] || ''}${value.uri || ''}`
  return value.url || value.uri || ''
}

// 从抖音网页 SSR HTML 提取歌曲 ID 列表
const fetchBoardSongIds = async (bangid) => {
  const html = await fetch(`https://www.douyin.com/qishui/playlist/${bangid}`, {
    headers: { 'User-Agent': WEB_UA },
  }).then((r) => r.text())
  const ids = []
  // SSR HTML 里歌曲链接可能被 URL 编码成 song%2F123 或保持 song/123，两种都匹配
  const re = /song(?:%2F|\/)(\d+)/g
  let m
  while ((m = re.exec(html)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1])
  }
  return ids
}

// 用 H5 SEO 接口获取歌曲详情
const fetchTrack = async (trackId) => {
  const data = await fetch(
    `https://beta-luna.douyin.com/luna/h5/seo_track?track_id=${trackId}&device_platform=web`,
    { headers: { 'User-Agent': H5_UA } }
  ).then((r) => r.json())
  const track = data?.seo_track?.track
  if (!track || !track.id) return null
  const duration = track.duration || 0
  return {
    singer: (track.artists || [])
      .map((a) => a.name || a.simple_display_name || '')
      .filter(Boolean)
      .join('、'),
    name: track.name || '',
    albumName: track.album?.name || '',
    albumId: track.album?.id ? String(track.album.id) : '',
    songmid: String(track.id),
    source: 'qs',
    interval: formatPlayTime(duration > 1000 ? Math.round(duration / 1000) : duration),
    img: pickUrl(track.album?.url_cover),
    lrc: null,
    otherSource: null,
    types: [],
    _types: {},
    typeUrl: {},
  }
}

export default {
  regExps: {},

  getBoards() {
    return {
      list: BOARDS,
      source: 'qs',
    }
  },

  async getList(bangid, page, retryNum = 0) {
    // 汽水排行榜本质是官方歌单：优先用 Luna API（POST /luna/playlist/detail）
    // 获取完整榜单，避免 SSR 只内嵌部分歌曲导致列表不全。
    // 注意：Luna API 对部分 bangid（实测音乐排行榜 7456941237036320787）会返回
    // 空 media_resources 而非报错，此时必须回退 SSR，否则列表会变成 0 首。
    try {
      const result = await songList.getListDetail(String(bangid), page)
      if (result.list && result.list.length) {
        // 榜单名以 BOARDS 配置为准（Luna API 返回的歌单名可能缺失）
        result.info.name = BOARDS.find((b) => b.bangid == bangid)?.name || result.info.name || '音乐排行榜'
        return result
      }
    } catch {}

    // 回退：从抖音网页 SSR HTML 提取歌曲 ID（Luna API 为空/失败时的兜底）
    try {
      const ids = await fetchBoardSongIds(String(bangid))
      const tracks = await Promise.all(ids.map((id) => fetchTrack(id).catch(() => null)))
      const list = tracks.filter(Boolean)
      return {
        list,
        page,
        limit: list.length,
        total: list.length,
        source: 'qs',
        info: {
          name: BOARDS.find((b) => b.bangid == bangid)?.name || '音乐排行榜',
          img: '',
          desc: '',
          author: '',
          play_count: '',
        },
      }
    } catch (err2) {
      if (retryNum > 2) return Promise.reject(err2)
      return this.getList(bangid, page, ++retryNum)
    }
  },
}
