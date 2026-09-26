import { updateListMusics } from '@/core/list'
import { setMaxplayTime, setNowPlayTime } from '@/core/player/progress'
import { getTimelineDuration } from '@/core/player/timeline'
import { setCurrentTime, getDuration, getPosition, getPlaybackEngineState } from '@/plugins/player/utils'
import { formatPlayTime2 } from '@/utils/common'
import { savePlayInfo } from '@/utils/data'
import { throttleBackgroundTimer } from '@/utils/tools'
import BackgroundTimer from 'react-native-background-timer'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { onScreenStateChange } from '@/utils/nativeModules/utils'
import { AppState } from 'react-native'
// UI 平滑时钟：仅服务于逐字歌词高亮与歌词连续滚动的每帧插值，
// 不参与歌词行同步（行高亮已交由歌词引擎内部 ticker 驱动）。
import { audioClock } from '@/core/player/audioClock'
import { syncLyric } from '@/core/lyric'
// 行级高亮的两种同步方式：
// - syncToTimeFromPosition：250ms 轮询用引擎真实位置同步（带“每帧推进”的回退迟滞，见插件内注释）
// - advanceToTime：每帧用 audioClock 外推时钟把当前行向前推进（见下）
import { advanceToTime, syncToTimeFromPosition } from '@/plugins/lyric'

import {
  updateScrobbleInfo,
  updateScrobblePlayTime,
  updateScrobbleTotalTime,
} from '@/core/player/scrobble'

const delaySavePlayInfo = throttleBackgroundTimer(() => {
  void savePlayInfo({
    time: playerState.progress.nowPlayTime,
    maxTime: playerState.progress.maxPlayTime,
    listId: playerState.playMusicInfo.listId!,
    index: playerState.playInfo.playIndex,
  })
}, 2000)

export default () => {
  // const updateMusicInfo = useCommit('list', 'updateMusicInfo')

  let updateTimeout: number | null = null

  let isScreenOn = true

  // 进度条拖动期间暂停 250ms 轮询：每次 tick 都有 getPosition/getPlaybackEngineState
  // 两次原生桥往返 + setNowPlayTime → playProgressChanged 连锁的 PlayInfo 子树 React
  // 重渲染（4 次/秒）+ playHistory/playStatus/preloadNextMusic 监听器执行。拖动的
  // 手势事件同样走 JS 线程，这些负载会把 move 事件挤到排队（表现为拖动不跟手），
  // 拖动期间整体跳过，JS 帧全部让给手势。播放继续走 audioClock 锚点外推，位置无感知
  // 停顿；拖动结束的 setProgress 会统一重锚，无状态残留。
  let isProgressDragging = false

  const isRestoringCurrentMusic = () => {
    const restorePlayInfo = global.lx.restorePlayInfo
    if (!restorePlayInfo) return false
    return restorePlayInfo.listId == playerState.playMusicInfo.listId &&
      restorePlayInfo.index == playerState.playInfo.playIndex
  }

  const getCurrentTime = () => {
    // 后台（音频后台播放时 JS 线程仍存活）跳过全部轮询工作：
    // 位置桥往返、React 渲染、进度条补间重启、存储写入在后台都没有意义，
    // 只会持续占用 JS 线程，返回前台后叠加成明显的触摸延迟。
    // 前台恢复后下一次 tick 会用引擎真实位置重锚时钟，状态无残留。
    if (AppState.currentState !== 'active') return
    let id = playerState.musicInfo.id
    void getPosition().then(async position => {
      if (!position || id != playerState.musicInfo.id) return
      setNowPlayTime(position)

      // 先检查引擎状态：buffering 期间音频没有真正渲染，getPosition() 返回的是
      // seek 目标而非实际播放位置。此时必须：
      // 1. 冻结 audioClock（playing=false）→ scrollToActiveContinuous 不会外推超前
      // 2. 跳过歌词行同步 → 高亮行不会跑到音频前面
      // 等 state 变为 playing（解码器真正从目标位置渲染）后再恢复同步。
      const engineState = await getPlaybackEngineState()
      const isBuffering = engineState === 'buffering' || engineState === 'loading'

      if (!playerState.isPlay) return

      if (isBuffering) {
        // 解码器还在 buffering：硬冻结时钟，不外推、不同步歌词。
        audioClock.hold(position * 1000)
        return
      }

      // seek 生效窗口内：引擎可能仍回报 seek 前的旧位置（seek 异步生效）。
      // 此时不能用旧位置重新锚定/同步歌词——否则点击歌词行/拖动进度条后音频已跳转，
      // 歌词与进度却回到旧位置（音频与歌词不同步）。保持冻结在落点，等下一次轮询；
      // 引擎已在落点附近恢复播放时解除窗口，正常锚定。
      if (seekTargetPosition != null && Date.now() < seekHoldUntil) {
        if (Math.abs(position - seekTargetPosition) >= 1.5) {
          audioClock.hold(seekTargetPosition * 1000)
          return
        }
        seekTargetPosition = null
        seekHoldUntil = 0
      }

      audioClock.setAnchor(position * 1000, settingState.setting['player.playbackRate'], playerState.isPlay)

      syncToTimeFromPosition(position * 1000, playerState.isPlay)


      updateScrobblePlayTime(position)

      if (settingState.setting['player.isSavePlayTime'] && !playerState.playMusicInfo.isTempPlay && isScreenOn) {
        delaySavePlayInfo()
      }
    })
  }
  const getMaxTime = async() => {
    const duration = await getDuration()
    const timelineDuration = getTimelineDuration(playerState.playMusicInfo.musicInfo, duration)
    setMaxplayTime(timelineDuration)
    updateScrobbleTotalTime(timelineDuration)

    if (playerState.playMusicInfo.musicInfo && 'source' in playerState.playMusicInfo.musicInfo && !playerState.playMusicInfo.musicInfo.interval) {
      // console.log(formatPlayTime2(playProgress.maxPlayTime))

      if (playerState.playMusicInfo.listId) {
        void updateListMusics([{
          id: playerState.playMusicInfo.listId,
          musicInfo: {
            ...playerState.playMusicInfo.musicInfo,
            interval: formatPlayTime2(playerState.progress.maxPlayTime),
          },
        }])
      }
    }
  }

  const clearUpdateTimeout = () => {
    if (!updateTimeout) return
    BackgroundTimer.clearInterval(updateTimeout)
    updateTimeout = null
  }
  const startUpdateTimeout = () => {
    if (!isScreenOn) return
    clearUpdateTimeout()
    updateTimeout = BackgroundTimer.setInterval(() => {
      if (isProgressDragging) return
      getCurrentTime()
    }, 250 / settingState.setting['player.playbackRate'])
    getCurrentTime()
  }

  // 行级高亮的每帧推进（消除 250ms 轮询带来的跨行延迟）：
  // 逐字/卡拉OK 高亮由 audioClock 每帧驱动，而行级高亮原先只能等 250ms 轮询（最坏晚 250ms），
  // 于是跨行瞬间会看到「新行已经开始唱、行高亮与滚动还没切过去」。这里用同一个外推时钟
  // 每帧把当前行向前推进，把跨行延迟压到一帧内；只前进不后退，回退交给上面的精确路径。
  let lyricTickRaf = 0
  let lastLyricTickMs = -1
  const tickLyricLine = () => {
    lyricTickRaf = requestAnimationFrame(tickLyricLine)
    const t = audioClock.getTime() * 1000
    // 时钟未推进（暂停 / 缓冲被 hold 在 seek 目标 / 屏幕关闭）时跳过：
    // 否则会按 hold 住的目标位置提前切行，也与“音频没动、字幕不动”相悖。
    if (t === lastLyricTickMs) return
    lastLyricTickMs = t
    advanceToTime(t, playerState.isPlay)
  }
  const startLyricTick = () => {
    if (lyricTickRaf) return
    lastLyricTickMs = -1
    lyricTickRaf = requestAnimationFrame(tickLyricLine)
  }
  const stopLyricTick = () => {
    if (!lyricTickRaf) return
    cancelAnimationFrame(lyricTickRaf)
    lyricTickRaf = 0
    lastLyricTickMs = -1
  }

  // seek 生效窗口：从发起到引擎在落点恢复播放之间，引擎的 getPosition() 可能仍回报
  // seek 前的旧位置（seek 是异步生效的，普通音质下尤其明显）。窗口内不能用旧位置
  // 重新锚定 UI 时钟 / 同步歌词，否则「点击歌词行 / 拖动进度条」后音频已跳到新位置，
  // 歌词与进度却回到旧位置（音频与歌词不同步）。窗口超时自愈（2s），
  // 引擎在落点附近恢复播放时提前结束窗口（见 getCurrentTime）。
  let seekTargetPosition: number | null = null
  let seekHoldUntil = 0

  const setProgress = (time: number, maxTime?: number) => {
    if (!playerState.musicInfo.id) return
    // console.log('setProgress', time, maxTime)
    setNowPlayTime(time)
    // seek 期间先冻结 UI 时钟在目标位置，等引擎返回真实落点后再重锚。
    audioClock.hold(time * 1000)
    seekTargetPosition = time
    seekHoldUntil = Date.now() + 2000
    syncLyric(time, playerState.isPlay)

    // 参考项目对齐的 seek：音频与歌词用同一真实落点，保证普通音质快进/快退后二者同步。
    void setCurrentTime(time).then((targetPosition) => {
      if (!playerState.musicInfo.id) return
      if (targetPosition > 0) {
        setNowPlayTime(targetPosition)
        // seek 已被引擎接受：把 UI 时钟冻结在真实落点上，直到轮询确认引擎在落点恢复播放。
        // 期间轮询即使取到 seek 未生效时的旧位置，也不会把时钟/歌词拽回旧位置。
        audioClock.hold(targetPosition * 1000)
        seekTargetPosition = targetPosition
        seekHoldUntil = Date.now() + 2000
      }

      // 所有音质统一走 AVPlayer 系统级 seek：TrackPlayer 准确报告真实落点，
      // 直接以该落点锚定 UI 时钟并同步歌词，由每秒 getCurrentTime 校准防止长期漂移。
      // 不在这里 setAnchor / syncLyric：native FLAC seekTo 立即 resolve 但解码器
      // 还在 buffering，此时解冻时机会让 scrollToActiveContinuous 外推超前。
      // 完全交给 250ms 轮询：等引擎 state 变为 playing 后统一解冻 + 同步。

      // FLAC native seekTo 立即 resolve 请求位置，解码器实际落点可能有偏差；
      // 300ms 后取引擎真实位置校正歌词 ticker，避免等 1s 轮询才纠正。
    })

    if (maxTime != null) setMaxplayTime(getTimelineDuration(playerState.playMusicInfo.musicInfo, maxTime))

    // if (!isPlay) audio.play()
  }


  const handlePlay = () => {
    void getMaxTime()
    // prevProgressStatus = 'normal'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    audioClock.setPlaying(true)
    startUpdateTimeout()
    // 逐帧推进行高亮（与逐字高亮同一个时钟），让跨行切得跟音频一样准
    startLyricTick()

    // 暂停期间轮询停止，恢复时 progress.nowPlayTime 可能过期；
    // lyric.play() 用 getReliableLyricPosition 启动 ticker 可能用了旧值。
    // 300ms 后用引擎真实位置强制重锚，覆盖所有音质的暂停恢复不同步。
  }
  const handlePause = () => {
    // prevProgressStatus = 'paused'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    // clearBufferTimeout()
    audioClock.setPlaying(false)
    clearUpdateTimeout()
    stopLyricTick()
    // 暂停/停止时解除 seek 窗口，避免恢复播放后仍被窗口逻辑钉在旧落点
    seekTargetPosition = null
    seekHoldUntil = 0
  }

  const handleStop = () => {
    clearUpdateTimeout()
    stopLyricTick()
    seekTargetPosition = null
    seekHoldUntil = 0
    audioClock.reset()
    setNowPlayTime(0)
    setMaxplayTime(0)
    // prevProgressStatus = 'none'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
  }

  const handleError = () => {
    // if (!restorePlayTime) restorePlayTime = getCurrentTime() // 记录出错的播放时间
    // console.log('handleError')
    // prevProgressStatus = 'error'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    clearUpdateTimeout()
    stopLyricTick()
  }


  const handleSetPlayInfo = () => {
    // restorePlayTime = playProgress.nowPlayTime
    // void setCurrentTime(playerState.progress.nowPlayTime)
    // setMaxplayTime(playProgress.maxPlayTime)
    handlePause()
    updateScrobbleInfo()
    // Skip the startup restore transition so we don't overwrite saved progress with 0.
    if (isRestoringCurrentMusic()) return
    if (!playerState.playMusicInfo.isTempPlay) {
      void savePlayInfo({
        time: playerState.progress.nowPlayTime,
        maxTime: playerState.progress.maxPlayTime,
        listId: playerState.playMusicInfo.listId!,
        index: playerState.playInfo.playIndex,
      })
    }
  }

  // watch(() => playerState.progress.nowPlayTime, (newValue, oldValue) => {
  //   if (settingState.setting['player.isSavePlayTime'] && !playMusicInfo.isTempPlay) {
  //     delaySavePlayInfo({
  //       time: newValue,
  //       maxTime: playerState.progress.maxPlayTime,
  //       listId: playMusicInfo.listId as string,
  //       index: playInfo.playIndex,
  //     })
  //   }
  // })
  // watch(() => playerState.progress.maxPlayTime, maxPlayTime => {
  //   if (!playMusicInfo.isTempPlay) {
  //     delaySavePlayInfo({
  //       time: playerState.progress.nowPlayTime,
  //       maxTime: maxPlayTime,
  //       listId: playMusicInfo.listId as string,
  //       index: playInfo.playIndex,
  //     })
  //   }
  // })

  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys, _settings) => {
    if (keys.includes('player.playbackRate')) startUpdateTimeout()
  }

  const handleScreenStateChanged: Parameters<typeof onScreenStateChange>[0] = (state) => {
    isScreenOn = state == 'ON'
    if (isScreenOn) {
      if (playerState.isPlay) {
        startUpdateTimeout()
        // 熄屏期间两者都停：唤醒后一起恢复，保持行高亮与轮询同步
        startLyricTick()
      }
    } else {
      clearUpdateTimeout()
      stopLyricTick()
    }
  }

  // 修复在某些设备上屏幕状态改变事件未触发导致的进度条未更新的问题
  AppState.addEventListener('change', (state) => {
    if (state == 'active' && !isScreenOn) handleScreenStateChanged('ON')
  })

  global.app_event.on('play', handlePlay)
  global.app_event.on('pause', handlePause)
  global.app_event.on('stop', handleStop)
  global.app_event.on('error', handleError)
  global.app_event.on('setProgress', setProgress)
  global.app_event.on('progressDragState', (dragging: boolean) => {
    isProgressDragging = dragging
  })
  // global.app_event.on(eventPlayerNames.restorePlay, handleRestorePlay)
  // global.app_event.on('playerLoadeddata', handleLoadeddata)
  // global.app_event.on('playerCanplay', handleCanplay)
  // global.app_event.on('playerWaiting', handleWating)
  // global.app_event.on('playerEmptied', handleEmpied)
  global.app_event.on('musicToggled', handleSetPlayInfo)
  global.state_event.on('configUpdated', handleConfigUpdated)

  onScreenStateChange(handleScreenStateChanged)
}
