import { generateSongId, loadDatabase } from './util'

export default {
  async getLyric(songInfo) {
    let gitcodeData = songInfo._gitcodeData

    if (!gitcodeData) {
      const database = await loadDatabase()
      gitcodeData = database.find((item) => generateSongId(item.relative_path) === songInfo.songmid)
    }

    if (gitcodeData?.lyrics) {
      return {
        lyric: gitcodeData.lyrics,
        tlyric: '',
        lxlyric: '',
      }
    }

    return {
      lyric: '[00:00.00]暂无歌词',
      tlyric: '',
      lxlyric: '',
    }
  },
}
