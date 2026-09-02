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
import { audioClock } from '@/core/player/audioClock'
import { getLyricLineTextByTime } from '@/plugins/lyric'

// 记录最近一次用于蓝牙歌词/锁屏歌词的文本，供后台定时器回刷用。
// iOS 切后台后 JS setTimeout 会被节流，导致 lrc-file-parser 的逐行回调停发；
// 但 BackgroundTimer 每秒仍在取引擎位置，可用当前时间对应的歌词文本继续更新 NowPlaying artist。
const lastRemoteLyricRef = { current: '' }

const updateRemoteLyric = async (lrc?: string) => {
  setLastLyric(lrc)
  lastRemoteLyricRef.current = lrc ?? ''
  if (Platform.OS == 'ios') {
    // iOS 无 track-player 的 updateNowPlayingTitles。逐行歌词直接写入 now playing 的
    // artist 字段（与 updateMetaInfo 的 iOS 布局一致：title="歌名 - 歌手"、artist=歌词），
    // 蓝牙设备即可实时显示歌词。没有当前歌词时保留歌手名，避免 iOS 27 Beta
    // 把缺少有效副标题的媒体项降级成“未在播放”。
    // 同时刷新 elapsedTime 与 playbackRate：每次只更新 artist 会重置控制中心的
    // 进度参考时间，导致 iPad 控制中心进度条与软件内不同步；带上当前真实进度后
    // 系统才能继续正确推进进度条。
    void updateNowPlayingInfo({
      artist: lrc ?? playerState.musicInfo.singer ?? '',
      elapsedTime: audioClock.getTime(),
      playbackRate: playerState.isPlay ? settingState.setting['player.playbackRate'] : 0,
    }).catch(() => {})
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

/**
 * 后台定时器调用：用当前播放时间对应的歌词行继续刷新 NowPlaying artist。
 * 解决 iOS 切后台后 JS 歌词引擎 ticker 被节流，导致锁屏/灵动岛歌词卡住的问题。
 */
export const refreshRemoteLyric = () => {
  if (!settingState.setting['player.isShowBluetoothLyric']) return
  if (!playerState.musicInfo.id) return
  if (Platform.OS != 'ios') return
  const currentMs = audioClock.getTime() * 1000
  const lineText = getLyricLineTextByTime(currentMs) || lastRemoteLyricRef.current
  void updateRemoteLyric(lineText || undefined)
}
