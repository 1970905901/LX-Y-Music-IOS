import {
  init as initLyricPlayer,
  toggleTranslation,
  toggleRoma,
  play,
  pause,
  stop,
  setLyric,
  setPlaybackRate,
} from '@/core/lyric'
import { updateSetting } from '@/core/common'
import settingState from '@/store/setting/state'
import {
  onLyricLinePlay,
  showRemoteLyric,
} from '@/core/desktopLyric'
import playerState from '@/store/player/state'
import { updateNowPlayingTitles } from '@/plugins/player/utils'
import { updateNowPlayingInfo } from '@/utils/nativeModules/nowPlaying'
import { Platform } from 'react-native'
import { setLastLyric } from '@/core/player/playInfo'
import { state } from '@/plugins/player/playList'

const updateRemoteLyric = async (lrc?: string) => {
  setLastLyric(lrc)
  if (Platform.OS == 'ios') {
    // iOS 无 track-player 的 updateNowPlayingTitles。逐行歌词直接写入 now playing 的
    // artist 字段（与 updateMetaInfo 的 iOS 布局一致：title="歌名 - 歌手"、artist=歌词），
    // 蓝牙设备即可实时显示歌词。仅更新 artist，保留 title/album 等信息。
    void updateNowPlayingInfo({ artist: lrc ?? '' }).catch(() => {})
    return
  }
  if (lrc == null) {
    void updateNowPlayingTitles(
      (state.prevDuration || 0) * 1000,
      playerState.musicInfo.name,
      playerState.musicInfo.singer ?? '',
      playerState.musicInfo.album ?? ''
    )
  } else {
    void updateNowPlayingTitles(
      (state.prevDuration || 0) * 1000,
      lrc,
      `${playerState.musicInfo.name}${playerState.musicInfo.singer ? ` - ${playerState.musicInfo.singer}` : ''}`,
      playerState.musicInfo.album ?? ''
    )
  }
}

export default async (setting: LX.AppSetting) => {
  await initLyricPlayer()
  await Promise.all([
    setPlaybackRate(setting['player.playbackRate']),
    toggleTranslation(setting['player.isShowLyricTranslation']),
    toggleRoma(setting['player.isShowLyricRoma']),
  ])

  if (setting['player.isShowBluetoothLyric']) {
    showRemoteLyric(true).catch(() => {
      updateSetting({ 'player.isShowBluetoothLyric': false })
    })
  }
  onLyricLinePlay(({ text, extendedLyrics }) => {
    if (!settingState.setting['player.isShowBluetoothLyric']) return
    if (!text && !state.isPlaying) {
      void updateRemoteLyric()
    } else {
      void updateRemoteLyric(text)
    }
  })

  global.app_event.on('play', play)
  global.app_event.on('pause', pause)
  global.app_event.on('stop', stop)
  global.app_event.on('error', pause)
  global.app_event.on('musicToggled', stop)
  global.app_event.on('lyricUpdated', setLyric)
}
