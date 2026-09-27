import { init as initLyricPlayer, toggleTranslation, toggleRoma, play, pause, stop, setLyric, setPlaybackRate, seek, onLyricPlay } from '@/core/lyric'
import { updateSetting } from '@/core/common'
import { onDesktopLyricPositionChange, showDesktopLyric, onLyricLinePlay, showRemoteLyric } from '@/core/desktopLyric'
import playerState from '@/store/player/state'
import { updateNowPlayingTitles } from '@/plugins/player/utils'
import { updateMetaData } from '@/plugins/player'
import { setLastLyric } from '@/core/player/playInfo'
import { state } from '@/plugins/player/playList'
import { audioClock } from '@/core/player/audioClock'
import { getLyricLineTextByTime } from '@/plugins/lyric'
import BackgroundTimer from 'react-native-background-timer'
import { Platform } from 'react-native'

const updateRemoteLyric = async(lrc?: string) => {
  setLastLyric(lrc)
  if (lrc == null) {
    void updateNowPlayingTitles((state.prevDuration || 0) * 1000, playerState.musicInfo.name, playerState.musicInfo.singer ?? '', playerState.musicInfo.album ?? '')
  } else {
    void updateNowPlayingTitles((state.prevDuration || 0) * 1000, lrc, `${playerState.musicInfo.name}${playerState.musicInfo.singer ? ` - ${playerState.musicInfo.singer}` : ''}`, playerState.musicInfo.album ?? '')
  }
}

export default async(setting: LX.AppSetting) => {
  await initLyricPlayer()
  await Promise.all([
    setPlaybackRate(setting['player.playbackRate']),
    toggleTranslation(setting['player.isShowLyricTranslation']),
    toggleRoma(setting['player.isShowLyricRoma']),
  ])

  if (setting['desktopLyric.enable']) {
    showDesktopLyric().catch(() => {
      updateSetting({ 'desktopLyric.enable': false })
    })
  }
  if (setting['player.isShowBluetoothLyric']) {
    showRemoteLyric(true).catch(() => {
      updateSetting({ 'player.isShowBluetoothLyric': false })
    })
  }
  onDesktopLyricPositionChange(position => {
    updateSetting({
      'desktopLyric.position.x': position.x,
      'desktopLyric.position.y': position.y,
    })
  })
  onLyricLinePlay(({ text, extendedLyrics: _extendedLyrics }) => {
    if (!text && !state.isPlaying) {
      void updateRemoteLyric()
    } else {
      void updateRemoteLyric(text)
    }
  })
  if (Platform.OS == 'ios') {
    let prevLyric: string | undefined
    // 最近一次已推送到 NowPlaying 的歌词行（前台路径写入），供兜底定时器去重
    let lastForegroundLyric: string | undefined
    onLyricPlay((line, text) => {
      const lyric = text || undefined
      if (lyric === prevLyric) return
      prevLyric = lyric
      lastForegroundLyric = lyric
      void updateRemoteLyric(lyric)
      if (playerState.playMusicInfo.musicInfo) {
        void updateMetaData(playerState.musicInfo, playerState.isPlay, lyric, true)
      }
    })

    // NowPlaying 歌词兜底（含控制中心/通知中心下拉的 inactive 态）：下拉控制中心时
    // App 进入 inactive，前台 rAF 与歌词 ticker 停转，控制中心里的歌词会冻结在
    // 打开前的那一行。这里无条件定时运行，用 audioClock 外推位置推导当前行，
    // 且仅当与最近一次已推送行不同时才推送——前台正常时自动静默无双写，
    // 前台驱动一旦停转（任意原因）立即接管，控制中心歌词持续跟进。
    let lastBackgroundLyric: string | undefined
    BackgroundTimer.setInterval(() => {
      if (!playerState.isPlay || !playerState.playMusicInfo.musicInfo) return
      if (global.lx.gettingUrlId) return
      const text = getLyricLineTextByTime(audioClock.getTime() * 1000)
      if (!text || text === lastBackgroundLyric || text === lastForegroundLyric) return
      lastBackgroundLyric = text
      void updateMetaData(playerState.musicInfo, playerState.isPlay, text, true)
    }, 500)
  }


  global.app_event.on('play', play)
  global.app_event.on('pause', pause)
  global.app_event.on('stop', stop)
  global.app_event.on('error', pause)
  global.app_event.on('seekLyric', seek)
  global.app_event.on('musicToggled', stop)
  global.app_event.on('lyricUpdated', setLyric)
}
