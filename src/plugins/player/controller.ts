import TrackPlayer from 'react-native-track-player'
import { Platform } from 'react-native'
import BackgroundTimer from 'react-native-background-timer'
import { updateMetaData, getCurrentTrack } from './playList'
import { initUnifiedPlayerEngine, onUnifiedPlayerEvent } from './engine'
import { getNativeFlacTrackId, setNativeFlacRate, setNativeFlacVolume } from './nativeFlac'
import { getPosition, isEmpty, setStop, setResource } from './utils'
import { exitApp } from '@/core/common'
import { playNext, setMusicUrl, executeFailureStrategy } from '@/core/player/player'
import { setStatusText } from '@/core/player/playStatus'
import { isActive } from '@/utils/tools'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { setNowPlayTime } from '@/core/player/progress'
import { startPreload, stopPreload } from '@/core/player/preload'

let isInitialized = false

const handleExitApp = async(reason: string) => {
  global.lx.isPlayedStop = false
  exitApp(reason)
}

export const initUnifiedPlayerController = () => {
  if (isInitialized) return
  initUnifiedPlayerEngine()

  let retryNum = 0
  let prevTimeoutId: string | null = null
  let loadingTimeout: number | null = null
  let delayNextTimeout: number | null = null
  let strategyRetryCount = 0
  let strategyStartIndex = 0
  let triedUrls: Set<string> | null = null

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
    strategyRetryCount = 0
    strategyStartIndex = 0
    triedUrls = null
  }

  const handleControllerError = () => {
    if (!playerState.musicInfo.id) return
    clearLoadingTimeout()
    if (global.lx.isPlayedStop) return

    if (settingState.setting['player.enableFailureStrategy'] && playerState.playMusicInfo.musicInfo && retryNum < 2) {
      const musicInfo = playerState.playMusicInfo.musicInfo
      if (retryNum === 0) setStatusText('音频加载失败，进行3次重试')
      void getPosition().then((position) => {
        if (position) setNowPlayTime(position)
      }).finally(() => {
        if (playerState.playMusicInfo.musicInfo !== musicInfo) return
        retryNum++
        setMusicUrl(playerState.playMusicInfo.musicInfo, true)
      })
      return
    }

    const currentMusicInfo = playerState.playMusicInfo.musicInfo
    if (currentMusicInfo && strategyRetryCount < 3) {
      setStatusText('进行播放失败策略')
      strategyRetryCount++
      if (!triedUrls) triedUrls = new Set()
      void getCurrentTrack()
        .then((track: any) => {
          if (track?.url) triedUrls!.add(track.url)
          return executeFailureStrategy(currentMusicInfo, true, new Error('Playback failed'), triedUrls ?? undefined, strategyStartIndex)
        })
        .then((result) => {
          if (result) {
            strategyStartIndex = result.index + 1
            setResource(currentMusicInfo, result.url, playerState.progress.nowPlayTime, result.quality)
          } else {
            triedUrls = null
            strategyStartIndex = 0
            global.lx.playerError = true
            if (!isEmpty()) void setStop()
            setStatusText(global.i18n.t('player__error'))
            setTimeout(addDelayNextTimeout)
          }
        })
        .catch(() => {
          triedUrls = null
          strategyStartIndex = 0
          global.lx.playerError = true
          if (!isEmpty()) void setStop()
          setStatusText(global.i18n.t('player__error'))
          setTimeout(addDelayNextTimeout)
        })
      return
    }

    if (!isEmpty()) void setStop()
    if (isActive()) {
      setStatusText(global.i18n.t('player__error'))
      setTimeout(addDelayNextTimeout)
    } else {
      void playNext(true)
    }
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
