import leaderboard from './leaderboard'
import lyric from './lyric'
import songList from './songList'
import musicSearch from './musicSearch'
import album from './album'
import artist from './artist'
import { apis } from '../api-source'
import hotSearch from './hotSearch'
import comment from './comment'
import user from './user'
import dailyRec from './dailyRec'
import {resolveQualityAlias} from "@/utils/musicSdk/utils";
// import tipSearch from './tipSearch'

const tx = {
  // tipSearch,
  leaderboard,
  songList,
  musicSearch,
  album,
  artist,
  hotSearch,
  comment,
  user,
  dailyRec,

  getMusicUrl(songInfo, type) {
    const qualityToRequest = resolveQualityAlias('tx', type);
    return apis('tx').getMusicUrl(songInfo, qualityToRequest);
  },
  getLyric(songInfo) {
    // let singer = songInfo.singer.indexOf('、') > -1 ? songInfo.singer.split('、')[0] : songInfo.singer
    return lyric.getLyric(songInfo.songmid)
  },
  async getPic(songInfo) {
    if (songInfo.albumId) {
      return `https://y.gtimg.cn/music/photo_new/T002R500x500M000${songInfo.albumId}.jpg`
    }
    return apis('tx').getPic(songInfo)
  },
  getMusicDetailPageUrl(songInfo) {
    return `https://y.qq.com/n/yqq/song/${songInfo.songmid}.html`
  },
}

export default tx
