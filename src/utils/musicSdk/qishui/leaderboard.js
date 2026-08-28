import { formatPlayTime } from '../../index'

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
  if (Array.isArray(value.urls) && value.urls.length > 0) return `${value.urls[0] || ''}${value.uri || ''}`
  return value.url || value.uri || ''
}

// 从抖音网页 SSR HTML 提取歌曲 ID 列表
const fetchBoardSongIds = async (bangid) => {
  const html = await fetch(`https://www.douyin.com/qishui/playlist/${bangid}`, {
    headers: { 'User-Agent': WEB_UA },
  }).then((r) => r.text())
  const ids = []
  const re = /song%2F(\d+)/g
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
    } catch (err) {
      if (retryNum > 2) return Promise.reject(err)
      return this.getList(bangid, page, ++retryNum)
    }
  },
}
