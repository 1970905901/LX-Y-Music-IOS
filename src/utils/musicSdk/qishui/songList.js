import { formatPlayTime } from '../../index'

// 汽水音乐（字节跳动旗下）Luna API 域名
const LUNA_API_HOST = 'https://beta-luna.douyin.com'

// 从歌单链接 / ID 中解析 playlist_id
// 支持：https://.../playlist/123456、?playlist_id=123456、纯数字 ID
const extractByPatterns = (input) => {
  const patterns = [
    /[?&]playlist_id=(\d+)/,
    /\/(?:playlist|list)\/(\d+)/,
    /^\s*(\d+)\s*$/,
    /\b(\d{6,})\b/,
  ]
  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (match) return match[1]
  }
  return ''
}

const extractPlaylistId = (input) => {
  if (!input) return ''
  const str = String(input).trim()
  try {
    const decoded = decodeURIComponent(str)
    return decoded === str ? extractByPatterns(str) : extractByPatterns(decoded)
  } catch {
    return extractByPatterns(str)
  }
}

export default {
  regExps: {
    listDetailLink: /^.+\/(?:playlist|list)\/(\d+)(?:\?.*|&.*$|#.*$|$)/,
  },
  sortList: [],
  limit_list: 30,
  limit_song: 200,

  // 打开歌单详情：调用汽水 Luna API（POST /luna/playlist/detail），无需登录、无需签名
  async getListDetail(id, page, retryNum = 0) {
    let playlistId = id
    if (/[?&:/]/.test(id)) {
      playlistId = extractPlaylistId(id)
    }
    if (!playlistId) return Promise.reject(new Error('汽水歌单链接或 ID 解析失败'))

    try {
      const response = await fetch(`${LUNA_API_HOST}/luna/playlist/detail`, {
        method: 'POST',
        headers: {
          'User-Agent': 'Luna/19.1.0 Android',
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ playlist_id: playlistId, count: this.limit_song }),
      })
      const data = await response.json()

      const playlist = data?.playlist || {}
      const mediaResources = Array.isArray(data?.media_resources) ? data.media_resources : []

      return {
        list: this.filterListDetail(mediaResources),
        page,
        limit: mediaResources.length,
        total: mediaResources.length,
        source: 'qs',
        info: {
          name: playlist.title || playlist.name || '',
          img: playlist.url_cover || playlist.cover || playlist.cover_url || '',
          desc: playlist.description || playlist.intro || '',
          author: '',
          play_count: '',
        },
      }
    } catch (err) {
      if (retryNum > 2) return Promise.reject(err)
      return this.getListDetail(id, page, ++retryNum)
    }
  },

  // 转换汽水歌曲为 musicInfo 格式
  filterListDetail(mediaResources) {
    return mediaResources
      .map((item) => {
        const track =
          item?.entity?.track_wrapper?.track ||
          item?.entity?.track ||
          item?.track
        if (!track || !track.id) return null
        const album = track.album || {}
        const artists = Array.isArray(track.artists) ? track.artists : []
        const singer = artists
          .map((a) => a.name || a.simple_display_name || a.user_info?.nickname || '')
          .filter(Boolean)
          .join('、')
        const cover = album.url_cover || album.cover_url || album.coverURL || ''
        const duration = track.duration ?? track.duration_ms ?? 0

        return {
          singer,
          name: track.name || track.trackName || '',
          albumName: album.name || '',
          albumId: album.id ? String(album.id) : '',
          songmid: String(track.id),
          source: 'qs',
          interval: formatPlayTime(duration > 1000 ? Math.round(duration / 1000) : duration),
          img: cover,
          lrc: null,
          otherSource: null,
          types: [],
          _types: {},
          typeUrl: {},
        }
      })
      .filter(Boolean)
  },

  // 汽水歌单不支持分类/标签列表，仅支持按链接/ID 打开
  getList() {
    return Promise.reject(new Error('汽水音乐仅支持打开歌单链接或 ID'))
  },
  getTags() {
    return Promise.reject(new Error('汽水音乐仅支持打开歌单链接或 ID'))
  },
}
