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
// 中断恢复兜底定时器：begin 中断时启动，收到 ended 或超时未恢复时清除。
let resumeTimer: ReturnType<typeof setTimeout> | null = null

const clearResumeTimer = () => {
  if (resumeTimer != null) {
    clearTimeout(resumeTimer)
    resumeTimer = null
  }
}

const registerPlaybackService = async() => {
  if (isInitialized) return

  console.log('reg services...')
  initUnifiedPlayerController()
  TrackPlayer.addEventListener(TPEvent.RemotePlay, () => {
    // console.log('remote-play')
    markTimeoutExitInteraction()
    // 用户主动恢复播放：清除「用户主动暂停」标记，回前台自动播放判定才可生效。
    global.lx.playerStatus.userPaused = false
    play()
  })

  TrackPlayer.addEventListener(TPEvent.RemotePause, () => {
    // console.log('remote-pause')
    markTimeoutExitInteraction()
    // 用户主动暂停时清除“被中断后自动恢复”意图，避免恢复事件到达后误播
    shouldResumeAfterDuck = false
    // 标记为用户主动暂停：回前台自动播放（autoPlayOnReturn）据此尊重用户意图，不自动恢复。
    global.lx.playerStatus.userPaused = true
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
    global.lx.playerStatus.userPaused = false
    global.lx.isPlayedStop = false
    exitApp('Remote Stop')
  })

  TrackPlayer.addEventListener(TPEvent.RemoteDuck, ({ permanent, paused }) => {
    const handleAudioFocus = settingState.setting['player.isHandleAudioFocus']

    // 设置关闭：不希望被其他 App 打断。
    // 首选由 iOS 的 mixWithOthers（原生 setupPlayer 在 mixWithOthers 时使用 .default policy 确保生效）
    // 避免系统中断；若仍收到中断事件（兜底，如来电），立即恢复播放。
    if (!handleAudioFocus) {
      if (paused) {
        global.lx.playerStatus.userPaused = false
        void play()
      }
      return
    }

    // 系统明确告知中断结束后不应恢复（被其他 App 永久接管、来电等）。
    // 但若本次中断开始时我们确实在播放（仅没收到 shouldResume 信号），仍恢复，
    // 满足“其他 App 没声音了自动恢复”的预期。
    if (permanent) {
      clearResumeTimer()
      if (shouldResumeAfterDuck) {
        shouldResumeAfterDuck = false
        global.lx.playerStatus.userPaused = false
        void play()
      }
      return
    }

    // 中断开始（原生仅发 { paused: true }）：iOS 此刻已将播放器暂停，
    // 只要收到 began 中断必然是播放中被打断，故标记结束时要恢复。
    if (paused) {
      shouldResumeAfterDuck = true
      // 系统音频中断的暂停：置抑制标志，使 playProgress 的 pause 事件处理不把它
      // 误判为「用户主动暂停」，回前台自动播放时仍会恢复（被打断≠用户想停）。
      global.lx.playerStatus.suppressUserPaused = true
      void pause()
      // iOS 上其他 App 停止播放后，AVAudioSession 的 interruption ended 经常不发送给
      // react-native-track-player（或被延迟到 ~1 分钟），导致下方「中断结束恢复」永远等不到，
      // 表现成「被打断后很久才恢复」。这里设兜底超时：3s 内仍没收到 ended 且仍应恢复时主动 play()，
      // 让「其他 App 没声音了就自动恢复」即时生效（前台场景下无副作用：若其他 App 仍在播，
      // iOS 音频会话会重新 duck 我们，不会真正覆盖）。
      clearResumeTimer()
      resumeTimer = setTimeout(() => {
        resumeTimer = null
        if (shouldResumeAfterDuck) {
          shouldResumeAfterDuck = false
          global.lx.playerStatus.userPaused = false
          void play()
        }
      }, 3000)
      return
    }

    // 中断结束（原生发 { paused: false } 且带 shouldResume）：按标记恢复播放。
    if (shouldResumeAfterDuck) {
      shouldResumeAfterDuck = false
      clearResumeTimer()
      global.lx.playerStatus.userPaused = false
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
