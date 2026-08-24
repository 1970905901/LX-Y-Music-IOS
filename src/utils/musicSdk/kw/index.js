import { httpFetch } from '../../request'
import tipSearch from './tipSearch'
import musicSearch from './musicSearch'
import { formatSinger } from './util'
import leaderboard from './leaderboard'
import lyric from './lyric'
import pic from './pic'
import { apis } from '../api-source'
import songList from './songList'
import hotSearch from './hotSearch'
import comment from './comment'
import {resolveQualityAlias} from "@/utils/musicSdk/utils";

const kw = {
  _musicInfoRequestObj: null,
  _musicInfoPromiseCancelFn: null,
  _musicPicRequestObj: null,
  _musicPicPromiseCancelFn: null,

  tipSearch,
  musicSearch,
  leaderboard,
  songList,
  hotSearch,
  comment,
  getLyric(songInfo, isGetLyricx) {
    return lyric.getLyric(songInfo, isGetLyricx)
  },
  handleMusicInfo(songInfo) {
    return this.getMusicInfo(songInfo).then((info) => {
      songInfo.name = info.name
      songInfo.singer = formatSinger(info.artist)
      songInfo.img = info.pic
      songInfo.albumName = info.album
      return songInfo
    })
  },

  getMusicUrl(songInfo, type) {
    const qualityToRequest = resolveQualityAlias('kw', type);
    return apis('kw').getMusicUrl(songInfo, qualityToRequest);
  },

  getMusicInfo(songInfo) {
    if (this._musicInfoRequestObj) this._musicInfoRequestObj.cancelHttp()
    this._musicInfoRequestObj = httpFetch(
      `http://www.kuwo.cn/api/www/music/musicInfo?mid=${songInfo.songmid}`
    )
    return this._musicInfoRequestObj.promise.then(({ body }) => {
      return body.code === 200 ? body.data : Promise.reject(new Error(body.msg))
    })
  },

  getMusicUrls(musicInfo, cb) {
    let tasks = []
    let songId = musicInfo.songmid
    musicInfo.types.forEach((type) => {
      tasks.push(kw.getMusicUrl(songId, type.type).promise)
    })
    Promise.all(tasks).then((urlInfo) => {
      let typeUrl = {}
      urlInfo.forEach((info) => {
        typeUrl[info.type] = info.url
      })
      cb(typeUrl)
    })
  },

  getPic(songInfo) {
    return pic.getPic(songInfo)
  },

  getMusicDetailPageUrl(songInfo) {
    return `http://www.kuwo.cn/play_detail/${songInfo.songmid}`
  },
}

export default kw
