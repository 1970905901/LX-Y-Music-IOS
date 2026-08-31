import TrackPlayer from 'react-native-track-player'
import { Platform } from 'react-native'
import BackgroundTimer from 'react-native-background-timer'
import { updateMetaData } from './playList'
import { initUnifiedPlayerEngine, onUnifiedPlayerEvent } from './engine'
import { getNativeFlacTrackId, setNativeFlacRate, setNativeFlacVolume } from './nativeFlac'
import { getPosition, isEmpty, setStop } from './utils'
import { exitApp } from '@/core/common'
import { playNext, setMusicUrl } from '@/core/player/player'
import { setStatusText } from '@/core/player/playStatus'
import { isActive } from '@/utils/tools'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { setNowPlayTime } from '@/core/player/progress'

let isInitialized = false

// 「正在取链」期间，下面的事件守卫会直接 return 掉所有 trackPlayer 事件。
// 锁屏/后台时取链 Promise 可能因定时器被冻结而永不 settle，global.lx.gettingUrlId 就永远
// 不清空，之后所有播放事件（含 ended）会被永久吞掉 —— 播完不再跳下一首，且无法自愈。
// 看门狗给「取链中」状态设上限。取值需大于 player.ts 的 addLoadTimeout(30s)，
// 让内置超时机制先起作用；看门狗只作为死锁时的最后防线。
const GETTING_URL_WATCHDOG_MS = 40000

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

  // 取链看门狗：只针对「gettingUrlId 完全没变」的真死锁。
  // 若超时时发现取链目标已经换过（例如 addLoadTimeout 在 30s 时已经跳过歌、开启了新的取链），
  // 说明流程仍在推进，此时重新计时而不是打断，避免与内置超时机制重复跳歌。
  let gettingUrlWatchdog: ReturnType<typeof BackgroundTimer.setTimeout> | null = null
  let watchdogGettingUrlId: string | null = null

  const clearGettingUrlWatchdog = () => {
    if (gettingUrlWatchdog) {
      BackgroundTimer.clearTimeout(gettingUrlWatchdog)
      gettingUrlWatchdog = null
    }
    watchdogGettingUrlId = null
  }

  const startGettingUrlWatchdog = () => {
    if (gettingUrlWatchdog) return
    watchdogGettingUrlId = global.lx.gettingUrlId
    gettingUrlWatchdog = BackgroundTimer.setTimeout(() => {
      gettingUrlWatchdog = null
      const current = global.lx.gettingUrlId
      if (!current) return
      if (current !== watchdogGettingUrlId) {
        startGettingUrlWatchdog()
        return
      }
      watchdogGettingUrlId = null
      console.log('[controller] gettingUrl watchdog timeout, force release & play next')
      global.lx.gettingUrlId = ''
      if (global.lx.isPlayedStop) return
      void playNext(true)
    }, GETTING_URL_WATCHDOG_MS)
  }

  const resetRecoveryState = () => {
    retryNum = 0
    prevTimeoutId = null
    clearDelayNextTimeout()
    clearLoadingTimeout()
    clearGettingUrlWatchdog()
  }

  const handleControllerError = () => {
    if (!playerState.musicInfo.id) return
    clearLoadingTimeout()
    if (global.lx.isPlayedStop) return
    if (playerState.playMusicInfo.musicInfo && retryNum < 2) {
      const musicInfo = playerState.playMusicInfo.musicInfo
      void getPosition().then((position) => {
        if (position) setNowPlayTime(position)
      }).finally(() => {
        if (playerState.playMusicInfo.musicInfo !== musicInfo) return
        retryNum++
        setMusicUrl(playerState.playMusicInfo.musicInfo, true)
        setStatusText(global.i18n.t('player__refresh_url'))
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
        // 恒为 false 的死条件：isEmpty() 为真意味着 trackId 为空串或匹配 /\/\/default$/，
        // 此时对 /\/\/default\/\/restorePlay$/ 的 test 必然为 false。保留以维持现有行为不变。
        (isEmpty(global.lx.playerTrackId) && /\/\/default\/\/restorePlay$/.test(global.lx.playerTrackId))
      )
    ) {
      // 正在取链：吞掉本次事件，同时确保看门狗已启动，防止取链卡死导致事件被永久吞掉
      if (global.lx.gettingUrlId) startGettingUrlWatchdog()
      return
    }
    clearGettingUrlWatchdog()
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

  global.app_event.on('musicToggled', resetRecoveryState)
  isInitialized = true
}
