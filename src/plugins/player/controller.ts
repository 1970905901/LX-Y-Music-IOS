import TrackPlayer from 'react-native-track-player'
import { Platform } from 'react-native'
import BackgroundTimer from 'react-native-background-timer'
import { updateMetaData } from './playList'
import { initUnifiedPlayerEngine, onUnifiedPlayerEvent } from './engine'
import { getNativeFlacTrackId, setNativeFlacRate, setNativeFlacVolume } from './nativeFlac'
import { getPositionStamped, elapsedSnapshotFields, isEmpty, setStop } from './utils'
import { exitApp } from '@/core/common'
import { playNext, setMusicUrl } from '@/core/player/player'
import { getNextTryQuality, getLastTryQuality, removeMusicUrl } from '@/core/music/online'
import { setStatusText } from '@/core/player/playStatus'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { playNowPlaying, pauseNowPlaying } from '@/utils/nativeModules/nowPlaying'
import { startPreload, stopPreload } from '@/core/player/preload'
import { savePlayInfo } from '@/utils/data'

let isInitialized = false

const handleExitApp = async(reason: string) => {
  global.lx.isPlayedStop = false
  // 对齐上游 usePlaybackPersistence 的 beforeunload 兜底：退出前把当前进度落盘。
  // time 按开关取值（关闭「记住播放进度」存 0，下次从头播），与常规保存一致
  if (playerState.playMusicInfo.musicInfo && playerState.playMusicInfo.listId) {
    void savePlayInfo({
      time: settingState.setting['player.isSavePlayTime'] ? playerState.progress.nowPlayTime : 0,
      maxTime: playerState.progress.maxPlayTime,
      listId: playerState.playMusicInfo.listId,
      index: playerState.playInfo.playIndex,
    }).catch(() => {})
  }
  exitApp(reason)
}

export const initUnifiedPlayerController = () => {
  if (isInitialized) return
  initUnifiedPlayerEngine()

  let retryNum = 0
  let prevTimeoutId: string | null = null
  let loadingTimeout: number | null = null
  let delayNextTimeout: number | null = null


  const clearLoadingTimeout = () => {
    if (!loadingTimeout) return
    BackgroundTimer.clearTimeout(loadingTimeout)
    loadingTimeout = null
  }

  const startLoadingTimeout = () => {
    clearLoadingTimeout()
    loadingTimeout = BackgroundTimer.setTimeout(() => {
      if (prevTimeoutId == playerState.musicInfo.id) {
        prevTimeoutId = null
        void playNext(true)
      } else {
        prevTimeoutId = playerState.musicInfo.id
        if (playerState.playMusicInfo.musicInfo) setMusicUrl(playerState.playMusicInfo.musicInfo, true)
      }
    }, 25000)
  }

  const clearDelayNextTimeout = () => {
    if (!delayNextTimeout) return
    BackgroundTimer.clearTimeout(delayNextTimeout)
    delayNextTimeout = null
  }

  const addDelayNextTimeout = () => {
    clearDelayNextTimeout()
    delayNextTimeout = BackgroundTimer.setTimeout(() => {
      if (global.lx.isPlayedStop) {
        setStatusText('')
        return
      }
      void playNext(true)
    }, 5000)
  }

  const resetRecoveryState = () => {
    retryNum = 0
    prevTimeoutId = null
    clearDelayNextTimeout()
    clearLoadingTimeout()
  }

  const handleControllerError = () => {
    if (!playerState.musicInfo.id) return
    clearLoadingTimeout()
    if (global.lx.isPlayedStop) return
    if (!isEmpty()) void setStop()

    // 【对齐上游 usePlayEvent.handleError】失败策略：① 音质逐级降级重试 →
    // ② 同 URL 刷新 ×2 → ③ 失败终态（错误状态 + 延迟自动跳下一首）
    if (playerState.playMusicInfo.musicInfo) {
      const currentMusicInfo = playerState.playMusicInfo.musicInfo
      // ① 高音质 URL 可能返回无法解码的加密内容，逐级降低音质重试（在线、非本地）
      if ('source' in currentMusicInfo && currentMusicInfo.source != 'local') {
        const onlineInfo = currentMusicInfo
        const urlSourceInfo = (onlineInfo.meta.toggleMusicInfo ?? onlineInfo)
        const lastQuality = getLastTryQuality(urlSourceInfo.id) ?? getLastTryQuality(currentMusicInfo.id)
        const nextQuality = getNextTryQuality(settingState.setting['player.playQuality'], urlSourceInfo, lastQuality)
        if (nextQuality) {
          if (lastQuality) {
            void removeMusicUrl(urlSourceInfo, lastQuality).catch(() => {})
            if (urlSourceInfo !== currentMusicInfo) void removeMusicUrl(currentMusicInfo as LX.Music.MusicInfo, lastQuality).catch(() => {})
          }
          setMusicUrl(currentMusicInfo, true, nextQuality)
          setStatusText(global.i18n.t('player__refresh_url'))
          return
        }
      }
      // ② 若音频 URL 无效则尝试刷新 2 次 URL
      if (retryNum < 2) {
        retryNum++
        setMusicUrl(currentMusicInfo, true)
        setStatusText(global.i18n.t('player__refresh_url'))
        return
      }
    }

    // ③ 全部失败：标记错误状态，延迟自动跳下一首（本端无 autoSkipOnError 设置项，
    // 保持上游默认开启的自动跳过语义；后台立即跳由 playNext 直达）
    setStatusText(global.i18n.t('player__error'))
    setTimeout(addDelayNextTimeout)
  }
  onUnifiedPlayerEvent(async(event) => {
    if (
      event.driver == 'trackPlayer' &&
      (
        global.lx.gettingUrlId ||
        (isEmpty(global.lx.playerTrackId) && /\/\/default\/\/restorePlay$/.test(global.lx.playerTrackId))
      )
    ) return
    switch (event.type) {
      case 'state':
        switch (event.state) {
          case 'loading':
            if (!global.lx.isPlayedStop && playerState.musicInfo.id) startLoadingTimeout()
            global.app_event.playerLoadstart()
            setStatusText(global.i18n.t('player__loading'))
            break
          case 'buffering':
            if (!global.lx.isPlayedStop && playerState.musicInfo.id) startLoadingTimeout()
            global.app_event.pause()
            global.app_event.playerWaiting()
            setStatusText(global.i18n.t('player__buffering'))
            break
          case 'playing':
            clearLoadingTimeout()
            setStatusText('')
            if (event.driver == 'nativeFlac') {
              global.lx.playerTrackId = getNativeFlacTrackId()
              // 每次 playing 都恢复音量；高码率音质的“seek 冻结静音”由进度模块的 catchUp
              // 轮询持续维持，不再依赖全局静音标志，避免标志泄漏到其它音质导致“没声音”。
              void setNativeFlacVolume(settingState.setting['player.volume'])
              void setNativeFlacRate(settingState.setting['player.playbackRate'])
              void getPositionStamped().then(async(stamped) => playNowPlaying({ elapsedTime: stamped.position, ...elapsedSnapshotFields(stamped), playbackRate: settingState.setting['player.playbackRate'] }).catch(() => {}))
            } else if (Platform.OS == 'ios') {
              void TrackPlayer.setVolume(settingState.setting['player.volume'])
            }
            if (Platform.OS == 'ios' && playerState.musicInfo.id) {
              // Refresh duration/elapsed metadata after playback actually starts so the
              // iOS lockscreen can render an active progress bar.
              void updateMetaData(playerState.musicInfo, true, playerState.lastLyric, true)
            }
            global.app_event.playerPlaying()
            global.app_event.play()
            startPreload()
            break
          case 'paused':
          case 'stopped':
          case 'idle':
            clearLoadingTimeout()
            if (event.driver == 'nativeFlac' && event.state != 'paused') global.lx.playerTrackId = ''
            global.app_event.playerPause()
            if (event.driver == 'nativeFlac') void getPositionStamped().then(async(stamped) => pauseNowPlaying({ elapsedTime: stamped.position, ...elapsedSnapshotFields(stamped) }).catch(() => {}))
            global.app_event.pause()
            break
        }
        if (global.lx.isPlayedStop) void handleExitApp('Timeout Exit')
        break
      case 'error':
        stopPreload()
        global.app_event.error()
        global.app_event.playerError()
        handleControllerError()
        break
      case 'trackChanged':
        global.lx.playerTrackId = event.trackId
        if (event.info?.track == null) return
        if (global.lx.isPlayedStop) return handleExitApp('Timeout Exit')
        if (Platform.OS == 'ios' && event.driver == 'trackPlayer') {
          void TrackPlayer.setVolume(settingState.setting['player.volume'])
        }
        if (Platform.OS != 'ios' && event.driver == 'trackPlayer' && isEmpty()) {
          stopPreload()
          await TrackPlayer.pause()
          global.app_event.playerPause()
          global.app_event.pause()
          global.app_event.playerEnded()
          global.app_event.playerEmptied()
          clearDelayNextTimeout()
          clearLoadingTimeout()
        }
        break
      case 'ended':
        stopPreload()
        global.lx.playerTrackId = ''
        global.app_event.playerPause()
        global.app_event.pause()
        global.app_event.playerEnded()
        global.app_event.playerEmptied()
        clearDelayNextTimeout()
        clearLoadingTimeout()
        break
    }
  })

  global.app_event.on('musicToggled', () => {
    resetRecoveryState()
    startPreload()
  })
  isInitialized = true
}
