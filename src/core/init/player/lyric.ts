import { init as initLyricPlayer, toggleTranslation, toggleRoma, play, pause, stop, setLyric, setPlaybackRate, seek, onLyricPlay } from '@/core/lyric'
import playerState from '@/store/player/state'
import { updateMetaData } from '@/plugins/player'
import { setLastLyric } from '@/core/player/playInfo'
import { getCurrentLyricLines } from '@/plugins/lyric'
import { setNowPlayingLyrics } from '@/utils/nativeModules/nowPlaying'
import { Platform } from 'react-native'

export default async(setting: LX.AppSetting) => {
  await initLyricPlayer()
  await Promise.all([
    setPlaybackRate(setting['player.playbackRate']),
    toggleTranslation(setting['player.isShowLyricTranslation']),
    toggleRoma(setting['player.isShowLyricRoma']),
  ])

  if (Platform.OS == 'ios') {
    let prevLyric: string | undefined
    onLyricPlay((line, text) => {
      const lyric = text || undefined
      if (lyric === prevLyric) return
      prevLyric = lyric
      setLastLyric(lyric)
      if (playerState.playMusicInfo.musicInfo) {
        void updateMetaData(playerState.musicInfo, playerState.isPlay, lyric, true)
      }
    })
  }


  // 歌词加载完成：iOS 侧在解析完成后把整条时间轴交给原生 NSTimer 驱动控制中心
  // 歌词（原生按锚点外推位置直接写 MPNowPlayingInfoCenter，不依赖 JS 定时器——
  // 下拉控制中心/锁屏时 App inactive，JS 定时器停转，歌词会冻结在打开前那行）。
  // 无歌词的歌（musicInfo.lrc 为空）传空数组，清掉原生侧残留的上一首时间轴。
  global.app_event.on('lyricUpdated', () => {
    if (Platform.OS == 'ios') {
      void setLyric().then(() => {
        const lines = playerState.musicInfo.lrc ? getCurrentLyricLines() : []
        void setNowPlayingLyrics(lines)
      })
    } else {
      setLyric()
    }
  })

  global.app_event.on('play', play)
  global.app_event.on('pause', pause)
  global.app_event.on('stop', stop)
  global.app_event.on('error', pause)
  global.app_event.on('seekLyric', seek)
  global.app_event.on('musicToggled', stop)
}
