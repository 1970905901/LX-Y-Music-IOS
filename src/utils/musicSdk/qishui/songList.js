import { formatPlayTime } from '@/utils/common'
import { httpFetch } from '@/utils/request'

// 汽水音乐（字节跳动旗下）Luna API 域名
const LUNA_API_HOST = 'https://beta-luna.douyin.com'

// 确定性失败（参数解析/业务报错），重试没有意义，标记后直接抛出
const fail = (message) => {
  const err = new Error(message)
  err.noRetry = true
  return Promise.reject(err)
}

// httpFetch 在响应体为合法 JSON 时已把 body 解析成对象，这里兼容两种形态。
// 直接对对象再做 JSON.parse 会拿到 "[object Object]" 并抛 SyntaxError。
const parseJsonBody = (body) => {
  if (!body) return null
  if (typeof body === 'object') return body
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return null
    }
  }
  return null
}

const matchPatterns = (input, patterns) => {
  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (match) return match[1]
  }
  return ''
}

// 先原样匹配，再尝试 URL 解码后匹配（分享链接里的 %2F 需解码后才认得出）
const runWithDecode = (input, fn) => {
  if (!input) return ''
  const str = String(input).trim()
  try {
    const decoded = decodeURIComponent(str)
    return fn(decoded === str ? str : decoded)
  } catch {
    return fn(str)
  }
}

// 从歌单链接 / ID 中解析 playlist_id
// 支持：https://.../playlist/123456、?playlist_id=123456、纯数字 ID
// 注意：不要用「任意 6 位以上数字」兜底。分享短链落地页里往往同时带
// track_id / sec_sharer_id，会把歌曲 ID 误当成歌单 ID，
// 请求详情时返回 ERR_RESOURCE_NOT_FOUND，最终表现为「导入失败」。
const PLAYLIST_ID_PATTERNS = [
  /[?&]playlist_id=(\d+)/,
  /\/(?:playlist|list)\/(\d+)/,
  /^\s*(\d+)\s*$/,
]
const extractPlaylistId = (input) =>
  runWithDecode(input, (str) => matchPatterns(str, PLAYLIST_ID_PATTERNS))

// 歌曲分享：https://music.douyin.com/qishui/share/track?track_id=123
const extractTrackId = (input) =>
  runWithDecode(input, (str) => matchPatterns(str, [/track_id=(\d+)/, /song(?:%2F|\/)(\d+)/]))

// 分享页 HTML 兜底：只认 playlist 语义，避免把同页里的 track_id 当成歌单 ID
const extractPlaylistIdFromText = (text) => {
  if (!text) return ''
  return (
    text.match(/"?playlist_id"?\s*[=:]\s*"?(\d+)/)?.[1] ||
    text.match(/playlist(?:%2F|\/)(\d{6,})/)?.[1] ||
    ''
  )
}

// 短链解析：https://qishui.douyin.com/s/iXUsubPF/ 这类分享短链会 302 到
// https://music.douyin.com/qishui/share/playlist?playlist_id=xxx（跨 host）。
// RN 的 fetch 自动跟随重定向，最终返回分享页 HTML。
// RN 在 iOS 上不保证 response.url 一定是重定向后的最终 URL，
// 所以 URL 与 HTML 两条路都走一遍，返回 { playlistId, trackId }。
const resolveShortLink = async (url) => {
  try {
    const resp = await httpFetch(url, {
      method: 'get',
      headers: { 'User-Agent': 'Luna/19.1.0 Android' },
    }).promise
    const finalUrl = resp.url || ''
    // 1) 优先从重定向后的最终 URL 提取
    const idFromUrl = extractPlaylistId(finalUrl)
    if (idFromUrl) return { playlistId: idFromUrl, trackId: '' }
    // 2) 兜底从 HTML 文本提取（分享页多为 SSR，内含 playlist_id / track_id）
    const text = typeof resp.body === 'string' ? resp.body : ''
    return {
      playlistId: extractPlaylistIdFromText(text),
      trackId: extractTrackId(finalUrl) || extractTrackId(text),
    }
  } catch {
    return { playlistId: '', trackId: '' }
  }
}

// 抖音/汽水图片对象 → 完整 URL（url_cover/cover 等字段是 { url_list: [...] } 结构）
const pickUrl = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0] || ''
  if (Array.isArray(value.url_list) && value.url_list.length > 0) return value.url_list[0]
  if (Array.isArray(value.urls) && value.urls.length > 0) return `${value.urls[0] || ''}${value.uri || ''}`
  return value.url || value.uri || ''
}

export default {
  regExps: {
    listDetailLink: /^.+\/(?:playlist|list)\/(\d+)(?:\?.*|&.*$|#.*$|$)/,
  },
  sortList: [],
  limit_list: 30,
  limit_song: 1000,

  // 打开歌单详情：调用汽水 Luna API（POST /luna/playlist/detail），无需登录、无需签名
  async getListDetail(id, page, retryNum = 0) {
    let playlistId = id
    if (/[?&:/]/.test(id)) {
      playlistId = extractPlaylistId(id)
    }
    // 短链（/s/xxx/）无法直接解析出 ID，先跟随重定向拿到 playlist_id
    if (!playlistId && /^https?:\/\//.test(id)) {
      const resolved = await resolveShortLink(id)
      if (!resolved.playlistId) {
        // 落到 share/track 说明分享的是单曲，不是歌单
        return fail(
          resolved.trackId
            ? '这是汽水音乐的单曲分享链接，请在汽水音乐内分享歌单后再打开'
            : '汽水歌单链接或 ID 解析失败'
        )
      }
      playlistId = resolved.playlistId
    }
    if (!playlistId) return fail('汽水歌单链接或 ID 解析失败')

    try {
      // 改用 httpFetch：内置超时与统一错误处理，避免 iPad 横屏/弹窗场景下裸 fetch 被挂起导致导入卡住。
      const resp = await httpFetch(`${LUNA_API_HOST}/luna/playlist/detail`, {
        method: 'POST',
        headers: {
          'User-Agent': 'Luna/19.1.0 Android',
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: { playlist_id: playlistId, count: this.limit_song },
        timeout: 30000,
      }).promise
      if (!resp.ok) return Promise.reject(new Error(`汽水歌单请求失败 (${resp.statusCode})`))
      const data = parseJsonBody(resp.body)
      if (!data) return fail('汽水歌单返回数据解析失败')

      // Luna API 用 HTTP 200 + 非 0 的 status_code 表达业务失败
      // （例如 playlist_id 不存在时返回 ERR_RESOURCE_NOT_FOUND）。
      // 这里必须校验，否则会被当成「空歌单」静默返回，
      // 表现为导入失败却没有任何错误提示。
      const statusCode = data.status_code
      if (statusCode != null && Number(statusCode) !== 0) {
        return fail(`汽水歌单获取失败：${data.status_info?.status_msg || statusCode}`)
      }

      const playlist = data.playlist || {}
      const mediaResources = Array.isArray(data.media_resources) ? data.media_resources : []

      return {
        list: this.filterListDetail(mediaResources),
        page,
        limit: mediaResources.length,
        total: mediaResources.length,
        source: 'qs',
        info: {
          name: playlist.title || playlist.name || '',
          img: pickUrl(playlist.url_cover || playlist.cover || playlist.cover_url),
          desc: playlist.description || playlist.intro || '',
          author: '',
          play_count: '',
        },
      }
    } catch (err) {
      // 参数解析 / 业务报错属于确定性失败，重试没有意义
      if (err?.noRetry || retryNum > 2) return Promise.reject(err)
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
        const cover = pickUrl(album.url_cover || album.cover_url || album.coverURL)
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
