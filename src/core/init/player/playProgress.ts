import { updateListMusics } from '@/core/list'
import { setMaxplayTime, setNowPlayTime } from '@/core/player/progress'
import { getTimelineDuration } from '@/core/player/timeline'
import { setCurrentTime, getDuration, getPositionStamped, getPlaybackEngineState } from '@/plugins/player/utils'
import { formatPlayTime2 } from '@/utils/common'
import { savePlayInfo } from '@/utils/data'
import { throttleBackgroundTimer } from '@/utils/tools'
import BackgroundTimer from 'react-native-background-timer'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { onScreenStateChange, onPlayerPosition } from '@/utils/nativeModules/utils'
import { reanchorNowPlayingLyric } from '@/utils/nativeModules/nowPlaying'
import { syncNowPlayingState } from '@/core/player/nowPlaying'
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

  // 快慢双路径：
  // - 快路径：原生歌词时钟 4Hz 外推位置事件（仅前台播放时发布），免桥接查询直接
  //   驱动进度 UI 与歌词行同步；
  // - 慢路径（2s）：引擎真实位置查询，负责校准（含回传原生重锚）、引擎状态/缓冲
  //   检测、seek 生效窗口、scrobble 与进度持久化。
  // 快路径仅在慢路径确认引擎在播后启用；缓冲 hold / seek 窗口 / 拖动期间冻结。
  let engineConfirmedPlaying = false
  let isBufferingHold = false

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
    // 带快照时间信息的位置快照：nativeFlac 原生时钟戳 / AVPlayer 年龄估计。
    // 重锚时把歌词时钟锚点回放到快照时刻（reanchorNowPlayingLyric 第三参），
    // 消除「快照位置被钉在现在」造成的灵动岛/控制中心歌词恒定滞后（~100-300ms）
    const calibStartedAt = Date.now()
    void getPositionStamped().then(async stamped => {
      const position = stamped.position
      if (!position || id != playerState.musicInfo.id) return

      // seek 生效窗口内：引擎可能仍回报 seek 前的旧位置（seek 异步生效）。
      // 此时绝不能把旧位置发布进 UI 状态（setNowPlayTime → playProgressChanged
      // → 进度条/时间标签/歌词监听器）——否则进度条先跳回旧位置、窗口结束后再
      // 跳回落点，表现为快进/快退后进度条抽帧。只把歌词/UI 时钟冻结在落点，
      // 等下一次轮询；引擎已在落点附近恢复播放时解除窗口，正常锚定。
      if (seekTargetPosition != null && Date.now() < seekHoldUntil) {
        if (Math.abs(position - seekTargetPosition) >= 1.5) {
          audioClock.hold(seekTargetPosition * 1000)
          return
        }
        seekTargetPosition = null
        seekHoldUntil = 0
      }

      setNowPlayTime(position)

      // 先检查引擎状态：buffering 期间音频没有真正渲染，getPosition() 返回的是
      // seek 目标而非实际播放位置。此时必须：
      // 1. 冻结 audioClock（playing=false）→ scrollToActiveContinuous 不会外推超前
      // 2. 跳过歌词行同步 → 高亮行不会跑到音频前面
      // 等 state 变为 playing（解码器真正从目标位置渲染）后再恢复同步。
      const engineState = await getPlaybackEngineState()
      const isBuffering = engineState === 'buffering' || engineState === 'loading'
      const wasBufferingHold = isBufferingHold
      isBufferingHold = isBuffering
      engineConfirmedPlaying = !isBuffering && engineState === 'playing' && !!playerState.isPlay

      if (!playerState.isPlay) return

      if (isBuffering) {
        // 解码器还在 buffering：硬冻结时钟，不外推、不同步歌词。
        audioClock.hold(position * 1000)
        return
      }

      audioClock.setAnchor(position * 1000, settingState.setting['player.playbackRate'], playerState.isPlay)
      // 回传引擎真实位置：重锚原生歌词/位置时钟（控制中心/灵动岛歌词与进度 UI 同源
      // 校准）。nativeFlac 路径带原生时钟戳精确回放；AVPlayer 路径无原生戳——快照
      // 产生于发起后 stamped.ageMs（往返半程）处，重锚发起时快照年龄 = 已流逝总时长
      // − stamped.ageMs（对称往返假设，残余 ≈ reanchor 单程，远小于旧行为的整段往返）
      const ageMs = stamped.snapshotAt > 0 ? 0 : Math.max(0, Date.now() - calibStartedAt - stamped.ageMs)
      void reanchorNowPlayingLyric(position * 1000, stamped.snapshotAt, ageMs)

      syncToTimeFromPosition(position * 1000, playerState.isPlay)

      updateScrobblePlayTime(position)

      // 缓冲恢复出声（长距离 seek 超过 300ms 快路径窗口、网络卡顿后）：缓冲期间
      // 控制中心进度基线外推已偏且无人重设——nativeFlac 路径无原生 seek 事件、
      // 快路径贴「playing 才重锚」语义在 buffering 时跳过了发布。恢复瞬间补一次
      // 带戳基线发布兜底（nativeFlac 走 getPositionStamped 原生戳精确回放；
      // AVPlayer 路径原生事件已重设基线，此处重复发布被推进吸收，无害）。
      if (wasBufferingHold) void syncNowPlayingState('play')

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
    // 慢速校准 tick（1s）：引擎真实位置重锚（快路径由原生 4Hz 位置事件驱动）+
    // 引擎状态/缓冲检测 + seek 生效窗口确认 + scrobble/播放记录/进度持久化。
    // 周期即控制中心歌词外推的最大漂移窗口，过大会表现为"同步一句停一会"
    updateTimeout = BackgroundTimer.setInterval(() => {
      if (isProgressDragging) return
      getCurrentTime()
    }, 1000)
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

  // 对齐上游 lx-m 桌面版范式（playing 事件 → 用引擎绝对播放时间重锚歌词并广播）：
  // seek 落点确认 / 暂停恢复后 ~300ms 触发一次快路径重锚，把 1s 慢校准的同步窗口
  // 压到 0.3s。快路径直接复用慢校准函数 getCurrentTime()（完整链路：seek 窗口拦截
  // → 引擎状态确认 → buffering hold / setAnchor + reanchorNowPlayingLyric 带戳回放
  // → 行同步），不复制任何状态机。补充一条：引擎确认 playing 时 syncNowPlayingState
  // ('play') 发布控制中心进度基线——nativeFlac 路径 seek/恢复播放后没有任何 info
  // 发布（TrackPlayer 已 reset、无原生事件），控制中心进度条会继续从旧基线外推，
  // 直到下一次元数据发布；AVPlayer 路径原生事件已更新基线，重复发布无害（同值守卫
  // 挡重播、基线推进吸收）。
  const scheduleFastResync = (musicId: string) => {
    BackgroundTimer.setTimeout(() => {
      if (!playerState.isPlay || playerState.musicInfo.id != musicId) return
      getCurrentTime()
      void getPlaybackEngineState().then((engineState) => {
        if (!playerState.isPlay || playerState.musicInfo.id != musicId) return
        // buffering/loading 时不发布：贴上游「playing 才重锚」语义，交给慢校准
        if (engineState === 'playing') void syncNowPlayingState('play')
      })
    }, 300)
  }

  const setProgress = (time: number, maxTime?: number) => {
    if (!playerState.musicInfo.id) return
    const musicId = playerState.musicInfo.id
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
        // App 内歌词以真实落点校正（nativeFlac 解码器落点可能偏离 seek 目标；
        // 上游同位置逻辑 = seek 后用引擎真实时间重锚歌词）
        syncLyric(targetPosition, playerState.isPlay)
        // 落点确认快路径：~300ms 后重锚歌词/原生时钟/进度基线（不等 1s 慢校准）
        scheduleFastResync(musicId)
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
    // 300ms 快路径：引擎确认在播后立即用真实位置重锚（歌词 + 原生时钟 + 进度基线），
    // 覆盖所有音质的暂停恢复不同步，并把基线发布（syncNowPlayingState('play')）
    // 补给 AVPlayer 路径——其恢复播放只走原生 state 事件重锚、不发 info。
    if (playerState.musicInfo.id) scheduleFastResync(playerState.musicInfo.id)
  }
  const handlePause = () => {
    // prevProgressStatus = 'paused'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    // clearBufferTimeout()
    audioClock.setPlaying(false)
    clearUpdateTimeout()
    stopLyricTick()
    // 快路径随暂停冻结，恢复播放后由慢速 tick 重新确认引擎状态再启用
    engineConfirmedPlaying = false
    isBufferingHold = false
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
    engineConfirmedPlaying = false
    isBufferingHold = false
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

  // 原生位置事件快路径（4Hz，仅前台播放时由歌词时钟发布）：免桥接查询驱动
  // 进度 UI 与歌词行同步。启用条件：慢路径已确认引擎在播、非缓冲 hold、
  // 非进度拖动、非 seek 生效窗口、App 前台。
  onPlayerPosition((position, rate) => {
    if (AppState.currentState !== 'active') return
    if (!engineConfirmedPlaying || isBufferingHold) return
    if (isProgressDragging) return
    if (!playerState.isPlay || !playerState.musicInfo.id) return
    if (seekTargetPosition != null && Date.now() < seekHoldUntil) return
    setNowPlayTime(position)
    audioClock.setAnchor(position * 1000, rate || settingState.setting['player.playbackRate'], true)
    syncToTimeFromPosition(position * 1000, true)
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
