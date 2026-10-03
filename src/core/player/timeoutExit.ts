import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import BackgroundTimer from 'react-native-background-timer'
import { exitApp } from '@/core/common'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'

type TimeoutMode = 'off' | 'timer'

export interface TimeoutExitInfo {
  time: number
  isPlayedStop: boolean
  mode: TimeoutMode
  active: boolean
}

type Hook = (info: TimeoutExitInfo) => void

interface TimeoutToolsSnapshot {
  getTime: () => number
  mode: TimeoutMode
}

const createInfo = (tools: TimeoutToolsSnapshot): TimeoutExitInfo => ({
  time: tools.getTime(),
  isPlayedStop: global.lx.isPlayedStop,
  mode: tools.mode,
  active: tools.getTime() >= 0,
})

const timeoutTools = {
  bgTimeout: null as number | null,
  // 倒计时刷新表（1s）：只在「App 前台 + 有 UI 订阅」时运行，见 syncHooksTimer()
  hooksTimer: null as ReturnType<typeof setInterval> | null,
  appActive: AppState.currentState === 'active',
  startTime: 0,
  time: -1,
  mode: 'off' as TimeoutMode,
  timeHooks: [] as Hook[],
  exit() {
    if (settingState.setting['player.timeoutExitPlayed'] && playerState.isPlay) {
      global.lx.isPlayedStop = true
      this.callHooks()
    } else {
      exitApp('Timeout Exit')
    }
  },
  getTime() {
    return Math.max(this.time - Math.round((performance.now() - this.startTime) / 1000), -1)
  },
  callHooks() {
    const info = createInfo(this)
    for (const hook of this.timeHooks) {
      hook(info)
    }
  },
  /**
   * 按「前台 + 有 UI 订阅 + 定时中」决定 1s 倒计时刷新表是否运行。
   *
   * 【耗电，2026-10-03 盘点】睡眠定时一开就是几十分钟～24 小时，而带 audio 后台模式的
   * App 在后台仍然存活：此前这颗普通 setInterval 会在锁屏整段时间里每秒唤醒一次 JS 线程
   * （即使没有 UI 在看倒计时）。到期本身由 bgTimeout 负责，根本不依赖它；倒计时数值由
   * performance.now() 派生、不累积误差，停表后重新起表即是正确值。
   */
  syncHooksTimer() {
    const wanted = this.appActive && this.timeHooks.length > 0 && this.mode == 'timer'
    if (!wanted) {
      if (this.hooksTimer != null) {
        clearInterval(this.hooksTimer)
        this.hooksTimer = null
      }
      return
    }
    if (this.hooksTimer != null) return
    this.hooksTimer = setInterval(() => {
      this.callHooks()
    }, 1000)
  },
  clearTimer(resetMode = true) {
    if (this.bgTimeout) {
      BackgroundTimer.clearTimeout(this.bgTimeout)
      this.bgTimeout = null
    }
    this.time = -1
    if (resetMode && this.mode == 'timer') this.mode = 'off'
    this.syncHooksTimer()
    this.callHooks()
  },
  start(time: number) {
    this.clearTimer(false)
    this.mode = 'timer'
    this.time = time
    this.startTime = performance.now()
    // 到期必须能在后台触发：BackgroundTimer（原生定时器 + 后台任务断言）只在到期这一拍
    // 唤醒一次；倒计时 UI 刷新用普通 setInterval，并被 syncHooksTimer 门控在「前台 +
    // 有 UI 订阅」时才运行。
    this.bgTimeout = BackgroundTimer.setTimeout(() => {
      this.clearTimer()
      this.exit()
    }, time * 1000)
    this.syncHooksTimer()
    this.callHooks()
  },
  addTimeHook(hook: Hook) {
    this.timeHooks.push(hook)
    this.syncHooksTimer()
    hook(createInfo(this))
  },
  removeTimeHook(hook: Hook) {
    const index = this.timeHooks.indexOf(hook)
    if (index > -1) this.timeHooks.splice(index, 1)
    this.syncHooksTimer()
  },
}

// 前后台切换：退后台停掉 1s 倒计时刷新（不再每秒唤醒 JS），回前台立即补一次正确值并起表。
// 只认 'background'：'inactive'（下拉控制中心 / 来电横幅）瞬时且倒计时可能仍在显示。
AppState.addEventListener('change', (state) => {
  const active = state === 'active'
  if (active === timeoutTools.appActive) return
  timeoutTools.appActive = active
  if (active) timeoutTools.callHooks()
  timeoutTools.syncHooksTimer()
})

export const startTimeoutExit = (time: number) => {
  timeoutTools.start(time)
}
export const stopTimeoutExit = () => {
  timeoutTools.clearTimer()
}
export const getTimeoutExitTime = () => {
  return timeoutTools.time
}

export const useTimeoutExitTimeInfo = () => {
  const [info, setInfo] = useState<TimeoutExitInfo>(createInfo(timeoutTools))
  useEffect(() => {
    const hook: Hook = (info) => {
      setInfo(info)
    }
    timeoutTools.addTimeHook(hook)
    return () => { timeoutTools.removeTimeHook(hook) }
  }, [setInfo])

  return info
}

export const onTimeUpdate = (handler: Hook) => {
  timeoutTools.addTimeHook(handler)

  return () => {
    timeoutTools.removeTimeHook(handler)
  }
}

export const cancelTimeoutExit = () => {
  global.lx.isPlayedStop = false
  timeoutTools.callHooks()
}

export const markTimeoutExitInteraction = () => {}
