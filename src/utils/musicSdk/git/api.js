import { loadDatabase } from './util'
import { generateSongId, buildDownloadUrl } from './util'

export const getMusicUrl = async (songInfo, type) => {
  let gitcodeData = songInfo._gitcodeData

  if (!gitcodeData) {
    const database = await loadDatabase()
    gitcodeData = database.find((item) => generateSongId(item.relative_path) === songInfo.songmid)
  }

  if (!gitcodeData) {
    return Promise.reject(new Error('找不到歌曲信息'))
  }

  return Promise.resolve({
    type,
    url: gitcodeData.download_url || buildDownloadUrl(gitcodeData.relative_path),
  })
}
