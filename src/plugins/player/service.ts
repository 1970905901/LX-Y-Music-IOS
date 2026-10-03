/* eslint-disable @typescript-eslint/no-misused-promises */
import TrackPlayer, { Event as TPEvent } from 'react-native-track-player'
import { Platform } from 'react-native'
import { pause, play } from '@/core/player/player'
import { initUnifiedPlayerController } from './controller'
import { exitApp } from '@/core/common'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'

let isInitialized = false
let shouldResumeAfterDuck = false
let duckRecoveryTimeouts: Array<ReturnType<typeof setTimeout>> = []

// —— 中断（interruption）恢复意图 ——
// 背景（2026-10-03 用户反馈）：车机蓝牙 + 高德播报时，音乐被暂停后不再恢复；不连蓝牙
// （外放）时高德只把音量压小（duck），所以看起来正常。根因是「中断结束后要不要恢复」
// 这一意图只按中断开始那一刻的 playerState.isPlay 记录，而 iOS 蓝牙场景下会同时产生
// 路由变化（车机 A2DP→HFP）与音频中断两个信号，谁先到 JS 不确定：只要播放态先被前一条
// 通路置为暂停，记下来的意图就是 false，中断结束后永远不恢复。
// 现在：① 用「最近确实在播」的时间窗记意图，抗住信号先后顺序；② 恢复带重试，确认真的
// 回到播放（车机在 HFP→A2DP 路由切换期间可能吞掉第一次 play）；③ iOS「中断结束但系统
// 没给 shouldResume」（RNTP 报 permanent=true）时，短暂中断（导航播报量级）也允许恢复，
// 长时间被其它 App 抢占则保持暂停，不与用户抢播放。
const RESUME_INTENT_WINDOW_MS = 3000
const SHORT_INTERRUPTION_MAX_MS = 30000
// 恢复后只补一次，且窗口很短：车机 HFP→A2DP 切换期间可能吞掉第一次 play()，需要补一次；
// 但窗口不能长 —— 否则用户在中断结束后很快按下暂停时，会被我们又把播放抢回来。
const RESUME_RETRY_DELAYS = [600]
let lastPlayingAt = 0
let interruptionStartedAt = 0
let resumeRetryTimeouts: Array<ReturnType<typeof setTimeout>> = []

/** 最近确实在播放（时间窗兜底，避免恢复意图被信号先后顺序吃掉） */
const wasRecentlyPlaying = () =>
  playerState.isPlay || (lastPlayingAt > 0 && Date.now() - lastPlayingAt <= RESUME_INTENT_WINDOW_MS)

const clearDuckRecoveryTimeouts = () => {
  for (const timeout of duckRecoveryTimeouts) clearTimeout(timeout)
  duckRecoveryTimeouts = []
}

const clearResumeRetryTimeouts = () => {
  for (const timeout of resumeRetryTimeouts) clearTimeout(timeout)
  resumeRetryTimeouts = []
}

const restoreConfiguredVolume = () => {
  clearDuckRecoveryTimeouts()

  const applyVolume = () => {
    void TrackPlayer.setVolume(settingState.setting['player.volume']).catch(() => {})
  }

  applyVolume()
  duckRecoveryTimeouts = [250, 1000].map(delay => setTimeout(applyVolume, delay))
}

/** 中断结束后恢复播放：先直接恢复，再按短延迟复查一次（播放态没回来才补发） */
const resumeAfterInterruption = () => {
  clearResumeRetryTimeouts()
  const attempt = () => {
    // 没有歌可播、或用户已经自己恢复（播放态已回到在播），都不再插手
    if (!playerState.playMusicInfo.musicInfo || playerState.isPlay) return
    play()
  }
  attempt()
  resumeRetryTimeouts = RESUME_RETRY_DELAYS.map(delay => setTimeout(attempt, delay))
}

const registerPlaybackService = async() => {
  if (isInitialized) return

  console.log('reg services...')
  initUnifiedPlayerController()

  // 记录「最近一次真的在播」——中断恢复意图的时间窗依赖它
  global.app_event.on('play', () => { lastPlayingAt = Date.now() })
  // 主动停止（用户停止 / 定时退出）时清掉待恢复意图；这里**不能**监听 'pause'：
  // 中断自身就是靠 pause 把播放态置为暂停的，监听它会把刚记下的恢复意图抹掉
  global.app_event.on('stop', () => {
    shouldResumeAfterDuck = false
    interruptionStartedAt = 0
    clearResumeRetryTimeouts()
  })

  // ⚠️ 这里**不要**再监听 RemotePlay / RemotePause / RemoteNext / RemotePrevious /
  // RemoteSeek —— 这些命令已由原生那条通路处理：AppDelegate.mm 给
  // MPRemoteCommandCenter 各命令 addTarget（LXInstallRemoteCommandHandlers）→ 发
  // LXRemoteCommand 通知 → UtilsModule 转 'remote-command' 事件 →
  // core/init/player/remoteCommand.ts。而 RNTP 的原生侧（SwiftAudioEx
  // RemoteCommandController）会给同一批命令**再挂一个 target**，于是两条通路各触发一次：
  //   - 方向盘 / 车机「下一曲」一次跳两首（用户实锤：只在少数几首之间来回循环）；
  //   - 车机「播放/暂停」一次开关两下（互相抵消，按钮看起来没反应）；
  //   - 控制中心拖进度条重复 seek。
  // 另外 RNTP 的 togglePlayPause 按它**自己的** playerState 判播放态，本 App 播
  // nativeFlac 时该状态与实际不符（会误发 remote-play）；原生通路发的是 'toggle'，
  // 走本 App 自己的 togglePlay()，语义才正确。
  // 这里只保留 RNTP 独有的 RemoteDuck（来电/路由打断）与 RemoteStop（系统停止播放）。
  TrackPlayer.addEventListener(TPEvent.RemoteStop, () => {
    // console.log('remote-stop')
    shouldResumeAfterDuck = false
    interruptionStartedAt = 0
    clearDuckRecoveryTimeouts()
    clearResumeRetryTimeouts()
    global.lx.isPlayedStop = false
    exitApp('Remote Stop')
  })

  TrackPlayer.addEventListener(TPEvent.RemoteDuck, ({ permanent, paused, ducking }) => {
    // On iOS, interruptions surface through RemoteDuck and we need to explicitly
    // restore playback/volume after the system finishes ducking or pausing audio.
    if (permanent) {
      // iOS：中断结束但系统没给 shouldResume（RNTP 报 permanent=true）。
      // 导航播报这类短暂中断仍按「中断前在播」恢复；长时间被其它 App 抢占（看视频等）
      // 保持暂停，避免把播放从用户手上抢回来。
      const shouldResumeShortInterruption = paused &&
        shouldResumeAfterDuck &&
        interruptionStartedAt > 0 &&
        Date.now() - interruptionStartedAt <= SHORT_INTERRUPTION_MAX_MS
      shouldResumeAfterDuck = false
      interruptionStartedAt = 0
      clearDuckRecoveryTimeouts()
      if (paused) void pause()
      if (shouldResumeShortInterruption) resumeAfterInterruption()
      return
    }

    if (ducking) {
      shouldResumeAfterDuck ||= wasRecentlyPlaying()
      clearDuckRecoveryTimeouts()
      return
    }

    if (paused) {
      // 中断开始：记录「中断结束后要不要恢复」。不能只看 playerState.isPlay ——
      // 蓝牙场景下路由变化那条通路可能已经先把播放态置成暂停（见文件头注释）。
      shouldResumeAfterDuck = wasRecentlyPlaying()
      interruptionStartedAt = Date.now()
      clearDuckRecoveryTimeouts()
      void pause()
      return
    }

    if (Platform.OS == 'ios' || ducking === false) restoreConfiguredVolume()

    const shouldResume = shouldResumeAfterDuck
    shouldResumeAfterDuck = false
    interruptionStartedAt = 0
    if (shouldResume) resumeAfterInterruption()
  })

  isInitialized = true
}


export default () => {
  if (global.lx.playerStatus.isRegisteredService) return
  console.log('handle registerPlaybackService...')
  TrackPlayer.registerPlaybackService(() => registerPlaybackService)
  global.lx.playerStatus.isRegisteredService = true
}
