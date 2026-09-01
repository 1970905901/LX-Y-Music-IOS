import { httpFetch } from '../../request'
import { b64DecodeUnicode, decodeName } from '../../index'

const formatQrcTime = (ms) => {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const cs = ms % 1000
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(3, '0')}`
}

// 将 QQ QRC 解析为 LRC 逐字格式（参考 LDDC 的 qrc.py）：
// 解密后的 QRC 为自闭合单标签 <Lyric_1 LyricType="1" LyricContent="..."/>，
// LyricContent 内是多行文本，每行为 [行起始,行时长]字(绝对起始,时长)字(绝对起始,时长)...。
// 注意：词时间标签在文字【之后】，且为【绝对毫秒】，需换算成相对行首。
const parseQrc = (text) => {
  if (!text) return ''
  // 若为 XML，取出 LyricContent 属性内容；否则按纯文本处理
  const contentMatch = /<Lyric_1[^>]*LyricContent="([\s\S]*?)"\s*\/>/i.exec(text)
  const content = contentMatch ? contentMatch[1] : text
  const lines = []
  for (const rawLine of content.split(/\r\n|\n|\r/)) {
    const line = rawLine.trim()
    const lineMatch = /^\[(\d+),(\d+)\](.*)$/.exec(line)
    if (!lineMatch) continue
    const lineStart = parseInt(lineMatch[1])
    const rest = lineMatch[3]
    const words = []
    let wm
    // 匹配「文字(绝对起始,时长)」：文字在前、时间标签在后
    const wordExp = /((?:(?!\(\d+,\d+\)).)+)\((\d+),(\d+)\)/g
    while ((wm = wordExp.exec(rest)) != null) {
      const wordText = wm[1]
      if (!wordText) continue
      const absStart = parseInt(wm[2])
      const duration = parseInt(wm[3])
      const relStart = Math.max(absStart - lineStart, 0)
      words.push(`<${relStart},${duration}>${wordText}`)
    }
    if (!words.length) continue
    lines.push(`[${formatQrcTime(lineStart)}]${words.join('')}`)
  }
  return lines.join('\n')
}

const TX_MUSIC_U_FCG = 'https://u.y.qq.com/cgi-bin/musicu.fcg'

const parseTimeToMs = (match) => {
  const min = parseInt(match[1])
  const sec = parseInt(match[2])
  const msStr = match[3] || '0'
  const ms = parseInt(msStr.padEnd(2, '0').substring(0, 2))
  return min * 60000 + sec * 1000 + ms
}

const fetchLyric = (songmid) => {
  const payload = {
    comm: { ct: 24, cv: 1800 },
    req_0: {
      module: 'music.musichallSong.PlayLyricInfo',
      method: 'GetPlayLyricInfo',
      param: {
        crypt: 0,
        lrc_t: 0,
        qrc: 1,
        qrc_t: 0,
        roma: 0,
        roma_t: 0,
        trans: 1,
        trans_t: 0,
        type: 1,
        songMid: songmid,
      },
    },
  }

  const requestObj = httpFetch(TX_MUSIC_U_FCG, {
    method: 'post',
    headers: {
      'User-Agent': 'QQMusic 14090508(android 12)',
      Referer: 'https://y.qq.com/',
    },
    body: payload,
  })

  requestObj.promise = requestObj.promise.then(({ body }) => {
    const data = body?.req_0?.data
    if (!data || !data.lyric) return Promise.reject(new Error('Get lyric failed'))

    const rawLyric = decodeName(b64DecodeUnicode(data.lyric))
    const rawTlyric = decodeName(b64DecodeUnicode(data.trans))

    // 过滤主歌词：移除空行和 // 行
    const filteredLyric = rawLyric?.split('\n')
      .filter(line => line.trim() !== '' && line.trim() !== '//')
      .join('\n') || ''

    // 过滤翻译歌词：移除空行、// 行、[kana:] 行、非标准行
    const filteredTlyric = rawTlyric?.split('\n')
      .filter(line => {
        if (line.trim() === '' || line.trim() === '//') return false
        if (line.includes('[kana:')) return false
        if (line.match(/^\[(ti|ar|al|by|offset):/i)) return true
        if (line.match(/^\[\d+:\d+/)) return true
        return false
      })
      .join('\n') || ''

    // 解析主歌词的时间戳 -> 原始行映射
    const mainLinesMap = {}
    const mainTimestamps = []
    for (const line of filteredLyric.split('\n')) {
      const match = line.match(/^\[(\d+):(\d+)\.(\d+)\]/)
      if (match) {
        const timeMs = parseTimeToMs(match)
        mainLinesMap[timeMs] = line
        mainTimestamps.push(timeMs)
      }
    }

    // 将翻译时间戳对齐到最近的主歌词时间戳
    const alignedLines = []
    for (const line of filteredTlyric.split('\n')) {
      // 保留元数据行
      if (line.match(/^\[(ti|ar|al|by|offset):/i)) {
        alignedLines.push(line)
        continue
      }

      const match = line.match(/^\[(\d+):(\d+)\.(\d+)\](.*)$/)
      if (match) {
        const timeMs = parseTimeToMs(match)
        const content = match[4].trim()
        if (!content || content === '//') continue

        // 找最近的主歌词时间戳
        let closestTime = mainTimestamps[0]
        let minDiff = Math.abs(timeMs - closestTime)
        for (const t of mainTimestamps) {
          const diff = Math.abs(timeMs - t)
          if (diff < minDiff) {
            minDiff = diff
            closestTime = t
          }
        }

        // 使用主歌词的时间戳格式
        const mainLine = mainLinesMap[closestTime]
        if (mainLine) {
          const timeMatch = mainLine.match(/^\[(\d+:\d+\.\d+)\]/)
          if (timeMatch) {
            alignedLines.push(`[${timeMatch[1]}]${content}`)
          }
        }
      }
    }

    // 逐字歌词：crypt:0 时 qrc 为 base64 明文，解码后解析为 LRC 逐字格式（失败则降级为整行高亮）
    let lxlyric = ''
    if (data.qrc) {
      try {
        lxlyric = parseQrc(b64DecodeUnicode(data.qrc))
      } catch {
        lxlyric = ''
      }
    }

    return {
      lyric: filteredLyric,
      tlyric: alignedLines.join('\n'),
      rlyric: '',
      lxlyric,
    }
  })

  return requestObj
}

const isValidLyric = (result) => {
  return result && typeof result.lyric === 'string' && result.lyric.trim().length > 0
}

export default {
  regexps: {
    matchLrc: /.+"lyric":"([\w=+/]*)".+/,
  },
  getLyric(songmid) {
    const requestObj = { cancelHttp: null }
    const lyricRequest = fetchLyric(songmid)

    requestObj.cancelHttp = () => {
      lyricRequest.cancelHttp()
    }

    requestObj.promise = lyricRequest.promise

    return requestObj
  },
}
