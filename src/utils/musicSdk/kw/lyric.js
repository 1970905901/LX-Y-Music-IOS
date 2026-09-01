import { httpFetch } from '../../request'
import { decodeLyric, lrcTools } from './util'
import { decodeName } from '../../index'

const buf_key = Buffer.from('yeelion')
const buf_key_len = buf_key.length
const buildParams = (id, isGetLyricx) => {
  let params = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${id}`
  if (isGetLyricx) params += '&lrcx=1'
  const buf_str = Buffer.from(params)
  const buf_str_len = buf_str.length
  const output = new Uint16Array(buf_str_len)
  let i = 0
  while (i < buf_str_len) {
    let j = 0
    while (j < buf_key_len && i < buf_str_len) {
      output[i] = buf_key[j] ^ buf_str[i]
      i++
      j++
    }
  }
  return Buffer.from(output).toString('base64')
}

// console.log(buildParams('207527604', false))
// console.log(buildParams('207527604', true))

const timeExp = /^\[([\d:.]*)\]{1}/g
const existTimeExp = /\[\d{1,2}:.*\d{1,4}\]/
const lyricxTag = /^<-?\d+,-?\d+>/
export default {
    sortLrcArr(arr) {
    const lrcSet = new Set()
    let lrc = []
    let lrcT = []

    let isLyricx = false
    for (const item of arr) {
      if (lrcSet.has(item.time)) {
        if (lrc.length < 2) continue
        const tItem = lrc.pop()
        tItem.time = lrc[lrc.length - 1].time
        lrcT.push(tItem)
        lrc.push(item)
      } else {
        lrc.push(item)
        lrcSet.add(item.time)
      }
      if (!isLyricx && lyricxTag.test(item.text)) isLyricx = true
    }

    if (!isLyricx && lrcT.length > lrc.length * 0.3 && lrc.length - lrcT.length > 6) {
      throw new Error('failed')
    }

    return {
      lrc,
      lrcT,
    }
  },
  transformLrc(tags, lrclist) {
    return `${tags.join('\n')}\n${lrclist ? lrclist.map((l) => `[${l.time}]${l.text}\n`).join('') : '暂无歌词'}`
  },
  parseLrc(lrc) {
    const lines = lrc.split(/\r\n|\r|\n/)
    let tags = []
    let lrcArr = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      let result = timeExp.exec(line)
      if (result) {
        const text = line.replace(timeExp, '').trim()
        let time = RegExp.$1
        if (/\.\d\d$/.test(time)) time += '0'
        lrcArr.push({
          time,
          text,
        })
      } else if (lrcTools.rxps.tagLine.test(line)) {
        tags.push(line)
      }
    }
    const lrcInfo = this.sortLrcArr(lrcArr)
    // 逐字歌词：将酷我歌词行内已解码的 <起始,时长>(ms, 相对行首) 词标签
    // 转换为 LRC 逐字格式 [时间]<起始,时长>词...；行首无词标签的词补 <0,首个词起始>。
    let lxlyric = ''
    try {
      lxlyric = lrcInfo.lrc.map((item) => {
        let text = item.text
        if (!/^<(-?\d+),(-?\d+)>/.test(text)) {
          const lead = /<(-?\d+),(-?\d+)>/.exec(text)
          if (lead) text = `<0,${parseInt(lead[1])}>${text}`
        }
        return `[${item.time}]${text}`
      }).join('\n')
    } catch {
      lxlyric = ''
    }
    return {
      lyric: decodeName(this.transformLrc(tags, lrcInfo.lrc)),
      tlyric: lrcInfo.lrcT.length ? decodeName(this.transformLrc(tags, lrcInfo.lrcT)) : '',
      lxlyric,
    }
  },
  getLyric(musicInfo, isGetLyricx = true) {
    const requestObj = httpFetch(
      `http://newlyric.kuwo.cn/newlyric.lrc?${buildParams(musicInfo.songmid, isGetLyricx)}`,
      {
        cache: false,
        binary: true,
      }
    )
    requestObj.promise = requestObj.promise.then(({ statusCode, body }) => {
      if (statusCode != 200) return Promise.reject(new Error(JSON.stringify(body)))
      return decodeLyric({ lrcBuffer: body, isGetLyricx }).then((base64Data) => {
        let lrcInfo
        try {
          lrcInfo = this.parseLrc(Buffer.from(base64Data, 'base64').toString())
        } catch (err) {
          return Promise.reject(new Error('Get lyric failed'))
        }
        if (lrcInfo.tlyric) lrcInfo.tlyric = lrcInfo.tlyric.replace(lrcTools.rxps.wordTimeAll, '')
        lrcInfo.lyric = lrcInfo.lyric.replace(lrcTools.rxps.wordTimeAll, '')
        if (!existTimeExp.test(lrcInfo.lyric)) return Promise.reject(new Error('Get lyric failed'))
        return lrcInfo
      })
    })
    return requestObj
  },
}
