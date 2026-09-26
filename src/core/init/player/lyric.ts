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
import { Platform, AppState } from 'react-native'

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
    onLyricPlay((line, text) => {
      const lyric = text || undefined
      if (lyric === prevLyric) return
      prevLyric = lyric
      void updateRemoteLyric(lyric)
      if (playerState.playMusicInfo.musicInfo) {
        void updateMetaData(playerState.musicInfo, playerState.isPlay, lyric, true)
      }
    })

    // 后台/锁屏兜底：前台由 250ms 轮询 + rAF 每帧驱动歌词行（见 playProgress.ts），
    // 但退后台 / 熄屏时轮询被 AppState 守卫跳过、rAF 与歌词 ticker 一并停掉，
    // 蓝牙设备（车机 / 耳机屏）上的歌词会卡在退后台前那一行。音频后台播放时
    // JS 线程仍存活，原生 BackgroundTimer 照常触发，这里每秒按 audioClock 外推
    // 位置推导当前行并推送 NowPlaying；前台时跳过，完全交给原有链路避免双写。
    let lastBackgroundLyric: string | undefined
    BackgroundTimer.setInterval(() => {
      if (AppState.currentState === 'active') return
      if (!playerState.isPlay || !playerState.playMusicInfo.musicInfo) return
      if (global.lx.gettingUrlId) return
      const text = getLyricLineTextByTime(audioClock.getTime() * 1000)
      if (!text || text === lastBackgroundLyric) return
      lastBackgroundLyric = text
      void updateMetaData(playerState.musicInfo, playerState.isPlay, text, true)
    }, 1000)
  }


  global.app_event.on('play', play)
  global.app_event.on('pause', pause)
  global.app_event.on('stop', stop)
  global.app_event.on('error', pause)
  global.app_event.on('seekLyric', seek)
  global.app_event.on('musicToggled', stop)
  global.app_event.on('lyricUpdated', setLyric)
}
