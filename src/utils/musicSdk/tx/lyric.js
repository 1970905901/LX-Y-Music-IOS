import { httpFetch } from '../../request'
import { b64DecodeUnicode, decodeName } from '../../index'
import { decryptQrc } from './qrc/decode'

const formatQrcTime = (ms) => {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const cs = ms % 1000
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(3, '0')}`
}

// 将 QQ QRC(解密后的 XML) 解析为 LRC 逐字格式：
// <Lyric_1 Time="ms"> <Word Offset="相对行首ms" Duration="ms">词</Word> ... </Lyric_1>
const parseQrc = (xml) => {
  if (!xml) return ''
  const lineBlocks = xml.match(/<lyric_1[^>]*>[\s\S]*?<\/lyric_1>/gi)
  if (!lineBlocks) return ''
  const lines = []
  for (const block of lineBlocks) {
    const timeMatch = /time="(-?\d+)"/i.exec(block)
    if (!timeMatch) continue
    const time = parseInt(timeMatch[1])
    const words = []
    let wm
    const wordExp = /<word\s+offset="(-?\d+)"\s+duration="(-?\d+)"[^>]*>([\s\S]*?)<\/word>/gi
    while ((wm = wordExp.exec(block)) != null) {
      words.push(`<${wm[1]},${wm[2]}>${wm[3]}`)
    }
    if (!words.length) continue
    lines.push(`[${formatQrcTime(time)}]${words.join('')}`)
  }
  return lines.join('\n')
}

// QQ 返回的 qrc 可能是 hex 或 base64，统一转 hex 再解密
const toQrcHex = (qrc) => {
  if (/^[0-9a-fA-F]+$/.test(qrc)) return qrc
  return Buffer.from(qrc, 'base64').toString('hex')
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

    // 逐字歌词：解密 QQ QRC 并解析为 LRC 逐字格式（解析失败则降级为整行高亮）
    let lxlyric = ''
    if (data.qrc) {
      try {
        lxlyric = parseQrc(decryptQrc(toQrcHex(data.qrc)))
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
