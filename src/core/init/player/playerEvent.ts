import { playNext, setMusicUrl, executeFailureStrategy } from '@/core/player/player'
import { setStatusText } from '@/core/player/playStatus'
import { getPosition, isEmpty, setStop, setResource } from '@/plugins/player'
import { getCurrentTrack } from '@/plugins/player/playList'
import { isActive } from '@/utils/tools'
import BackgroundTimer from 'react-native-background-timer'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { setNowPlayTime } from '@/core/player/progress'
import { updateScrobbleInfo } from '@/core/player/scrobble'

export default () => {
  let retryNum = 0
  let strategyRetryCount = 0
  let strategyStartIndex = 0
  let prevTimeoutId: string | null = null
  let loadingTimeout: number | null = null
  let delayNextTimeout: number | null = null
  let triedUrls: Set<string> | null = null

  const startLoadingTimeout = () => {
    clearLoadingTimeout()
    loadingTimeout = BackgroundTimer.setTimeout(() => {
      if (global.lx.isPlayedStop) return
      void handleError()
    }, 25000)
  }

  const clearLoadingTimeout = () => {
    if (!loadingTimeout) return
    BackgroundTimer.clearTimeout(loadingTimeout)
    loadingTimeout = null
  }

  const clearDelayNextTimeout = () => {
    if (!delayNextTimeout) return
    BackgroundTimer.clearTimeout(delayNextTimeout)
    delayNextTimeout = null
  }

  const handleLoadstart = () => {
    if (global.lx.isPlayedStop) return
    startLoadingTimeout()
    setStatusText(global.i18n.t('player__loading'))
  }

  const handlePlaying = () => {
    setStatusText('')
    clearLoadingTimeout()
  }

  const handleEmpied = () => {
    clearDelayNextTimeout()
  }

  const handleWating = () => {
    setStatusText(global.i18n.t('player__buffering'))
  }

  const handleError = () => {
    console.log('[YNX-DEBUG] handleError triggered, musicInfo.id:', playerState.musicInfo?.id, 'isPlayedStop:', global.lx.isPlayedStop, 'retryNum:', retryNum, 'strategyRetryCount:', strategyRetryCount)
    if (!playerState.musicInfo.id) return
    clearLoadingTimeout()
    if (global.lx.isPlayedStop) return

    if (settingState.setting['player.enableFailureStrategy'] && playerState.playMusicInfo.musicInfo && retryNum < 2) {
      if (retryNum === 0) setStatusText('音频加载失败，进行3次重试')
      let musicInfo = playerState.playMusicInfo.musicInfo
      void getPosition()
        .then((position) => { if (position) setNowPlayTime(position) })
        .finally(() => {
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
          return executeFailureStrategy(currentMusicInfo, true, new Error('Playback failed'), triedUrls, strategyStartIndex)
        })
        .then((result) => {
          if (result) {
            strategyStartIndex = result.index + 1
            setResource(currentMusicInfo, result.url, playerState.progress.nowPlayTime)
          } else {
            triedUrls = null
            strategyStartIndex = 0
            global.lx.playerError = true
            if (!isEmpty()) void setStop()
            setStatusText(global.i18n.t('player__error'))
          }
        })
        .catch(() => {
          triedUrls = null
          strategyStartIndex = 0
          global.lx.playerError = true
          if (!isEmpty()) void setStop()
          setStatusText(global.i18n.t('player__error'))
        })
      return
    }

    global.lx.playerError = true
    if (!isEmpty()) void setStop()
    setStatusText(global.i18n.t('player__error'))
  }

  const resetRetryState = () => {
    retryNum = 0
    strategyRetryCount = 0
    strategyStartIndex = 0
    triedUrls = null
  }

  const handleSetPlayInfo = () => {
    retryNum = 0
    strategyRetryCount = 0
    strategyStartIndex = 0
    triedUrls = null
    prevTimeoutId = null
    clearDelayNextTimeout()
    updateScrobbleInfo()
  }

  global.app_event.on('playerLoadstart', handleLoadstart)
  global.app_event.on('playerPlaying', handlePlaying)
  global.app_event.on('playerWaiting', handleWating)
  global.app_event.on('playerEmptied', handleEmpied)
  global.app_event.on('playerError', handleError)
  global.app_event.on('musicToggled', handleSetPlayInfo)
}
