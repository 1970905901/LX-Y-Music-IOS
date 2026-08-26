/* eslint-disable @typescript-eslint/no-misused-promises */
import TrackPlayer, { Event as TPEvent, State } from 'react-native-track-player'
import { Platform } from 'react-native'
import { pause, play, playNext, playPrev } from '@/core/player/player'
import { markTimeoutExitInteraction } from '@/core/player/timeoutExit'
import { initUnifiedPlayerController } from './controller'
import { exitApp } from '@/core/common'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'

let isInitialized = false
let shouldResumeAfterDuck = false
let duckRecoveryTimeouts: Array<ReturnType<typeof setTimeout>> = []

const clearDuckRecoveryTimeouts = () => {
  for (const timeout of duckRecoveryTimeouts) clearTimeout(timeout)
  duckRecoveryTimeouts = []
}

const restoreConfiguredVolume = () => {
  clearDuckRecoveryTimeouts()

  const applyVolume = () => {
    void TrackPlayer.setVolume(settingState.setting['player.volume']).catch(() => {})
  }

  applyVolume()
  duckRecoveryTimeouts = [250, 1000].map(delay => setTimeout(applyVolume, delay))
}

const registerPlaybackService = async() => {
  if (isInitialized) return

  console.log('reg services...')
  initUnifiedPlayerController()
  TrackPlayer.addEventListener(TPEvent.RemotePlay, () => {
    // console.log('remote-play')
    markTimeoutExitInteraction()
    play()
  })

  TrackPlayer.addEventListener(TPEvent.RemotePause, () => {
    // console.log('remote-pause')
    markTimeoutExitInteraction()
    // 用户主动暂停时清除“被中断后自动恢复”意图，避免恢复事件到达后误播
    shouldResumeAfterDuck = false
    void pause()
  })

  TrackPlayer.addEventListener(TPEvent.RemoteNext, () => {
    // console.log('remote-next')
    markTimeoutExitInteraction()
    void playNext()
  })

  TrackPlayer.addEventListener(TPEvent.RemotePrevious, () => {
    // console.log('remote-previous')
    markTimeoutExitInteraction()
    void playPrev()
  })

  TrackPlayer.addEventListener(TPEvent.RemoteStop, () => {
    // console.log('remote-stop')
    shouldResumeAfterDuck = false
    clearDuckRecoveryTimeouts()
    global.lx.isPlayedStop = false
    exitApp('Remote Stop')
  })

  TrackPlayer.addEventListener(TPEvent.RemoteDuck, async ({ permanent, paused, ducking }) => {
    // 设置关闭时，完全不理会音频焦点事件：既不暂停也不自动恢复。
    // iOS 侧已通过 iosCategoryOptions: ['mixWithOthers'] 避免系统强制中断。
    if (!settingState.setting['player.isHandleAudioFocus']) return

    // permanent 中断：系统明确告知中断结束后不应自动恢复（Android / iOS）。
    if (permanent) {
      shouldResumeAfterDuck = false
      clearDuckRecoveryTimeouts()
      if (paused) void pause()
      return
    }

    // 中断开始：iOS 发送 { paused: true }，Android 可能发送 { ducking: true }。
    // 以 TrackPlayer 当前真实状态为准，避免 playerState.isPlay 因并发状态更新
    // 已被提前置为 false，导致中断结束后无法自动恢复。
    if (paused || ducking) {
      clearDuckRecoveryTimeouts()
      const state = await TrackPlayer.getState().catch(() => null)
      if (state == State.Playing) shouldResumeAfterDuck = true
      if (paused) void pause()
      return
    }

    // 中断结束 / ducking 结束：恢复音量，并根据恢复意图继续播放。
    if (Platform.OS == 'ios' || ducking === false) restoreConfiguredVolume()

    if (shouldResumeAfterDuck) {
      shouldResumeAfterDuck = false
      play()
    }
  })

  TrackPlayer.addEventListener(TPEvent.RemoteSeek, async({ position }) => {
    markTimeoutExitInteraction()
    global.app_event.setProgress(position as number)
  })
  isInitialized = true
}


export default () => {
  if (global.lx.playerStatus.isRegisteredService) return
  console.log('handle registerPlaybackService...')
  TrackPlayer.registerPlaybackService(() => registerPlaybackService)
  global.lx.playerStatus.isRegisteredService = true
}
