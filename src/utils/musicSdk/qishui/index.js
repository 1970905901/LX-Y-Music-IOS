import songList from './songList'
import leaderboard from './leaderboard'

// 汽水音乐：实现歌单打开 + 排行榜（均无需登录/签名）。
// 歌曲播放/歌词/封面走「其他源匹配」链路（见 core/music/index.ts 对 'qs' 的分发）。
const qishui = {
  songList,
  leaderboard,
}

export default qishui
