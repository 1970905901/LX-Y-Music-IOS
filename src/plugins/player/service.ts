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
    clearDuckRecoveryTimeouts()
    global.lx.isPlayedStop = false
    exitApp('Remote Stop')
  })

  TrackPlayer.addEventListener(TPEvent.RemoteDuck, ({ permanent, paused, ducking }) => {
    // On iOS, interruptions surface through RemoteDuck and we need to explicitly
    // restore playback/volume after the system finishes ducking or pausing audio.
    if (permanent) {
      shouldResumeAfterDuck = false
      clearDuckRecoveryTimeouts()
      if (paused) void pause()
      return
    }

    if (ducking) {
      shouldResumeAfterDuck ||= playerState.isPlay
      clearDuckRecoveryTimeouts()
      return
    }

    if (paused) {
      shouldResumeAfterDuck = playerState.isPlay
      clearDuckRecoveryTimeouts()
      void pause()
      return
    }

    if (Platform.OS == 'ios' || ducking === false) restoreConfiguredVolume()

    if (shouldResumeAfterDuck) {
      shouldResumeAfterDuck = false
      play()
    }
  })

  isInitialized = true
}


export default () => {
  if (global.lx.playerStatus.isRegisteredService) return
  console.log('handle registerPlaybackService...')
  TrackPlayer.registerPlaybackService(() => registerPlaybackService)
  global.lx.playerStatus.isRegisteredService = true
}
