/* eslint-disable @typescript-eslint/no-misused-promises */
import TrackPlayer, { Event as TPEvent } from 'react-native-track-player'
import { pause, play, playNext, playPrev } from '@/core/player/player'
import { markTimeoutExitInteraction } from '@/core/player/timeoutExit'
import { initUnifiedPlayerController } from './controller'
import { exitApp } from '@/core/common'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'

let isInitialized = false
let shouldResumeAfterDuck = false

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

  TrackPlayer.addEventListener(TPEvent.RemoteDuck, ({ permanent, paused }) => {
    const handleAudioFocus = settingState.setting['player.isHandleAudioFocus']

    // 设置关闭：不希望被其他 App 打断。
    // 首选由 iOS 的 mixWithOthers（原生 setupPlayer 在 mixWithOthers 时使用 .default policy 确保生效）
    // 避免系统中断；若仍收到中断事件（兜底，如来电），立即恢复播放。
    if (!handleAudioFocus) {
      if (paused) void play()
      return
    }

    // 系统明确告知中断结束后不应恢复（被其他 App 永久接管、来电等）。
    // 但若本次中断开始时我们确实在播放（仅没收到 shouldResume 信号），仍恢复，
    // 满足“其他 App 没声音了自动恢复”的预期。
    if (permanent) {
      if (shouldResumeAfterDuck) {
        shouldResumeAfterDuck = false
        void play()
      }
      return
    }

    // 中断开始（原生仅发 { paused: true }）：iOS 此刻已将播放器暂停，
    // 只要收到 began 中断必然是播放中被打断，故标记结束时要恢复。
    if (paused) {
      shouldResumeAfterDuck = true
      void pause()
      return
    }

    // 中断结束（原生发 { paused: false } 且带 shouldResume）：按标记恢复播放。
    if (shouldResumeAfterDuck) {
      shouldResumeAfterDuck = false
      void play()
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
