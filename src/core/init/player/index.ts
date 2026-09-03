import initPlayer from './player'
import initPlayInfo from './playInfo'
import initPlayStatus from './playStatus'
import initWatchList from './watchList'
import initPlayProgress from './playProgress'
import initPreloadNextMusic from './preloadNextMusic'
import initPlayHistory from './playHistory'
import initLyric from './lyric'
import initRemoteCommand from './remoteCommand'

export default async(setting: LX.AppSetting) => {
  await initPlayer(setting)
  await initLyric(setting)
  await initPlayInfo(setting)
  initPlayStatus()
  initWatchList()
  initPlayProgress()
  initPreloadNextMusic()
  // 本项目独有：播放历史记录。参考分支没有该模块，这里保留挂载，
  // 否则「播放历史」页面将不再产生任何记录。
  initPlayHistory()
  initRemoteCommand()
}
