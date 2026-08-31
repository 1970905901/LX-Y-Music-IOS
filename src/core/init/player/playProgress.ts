import { updateListMusics } from '@/core/list'
import { setMaxplayTime, setNowPlayTime } from '@/core/player/progress'
import { play } from '@/core/player/player'
import { setCurrentTime, getDuration, getPosition } from '@/plugins/player'
import { syncToTime as lrcSyncToTime } from '@/plugins/lyric'
import { audioClock } from '@/core/player/audioClock'
import { formatPlayTime2 } from '@/utils/common'
import { savePlayInfo } from '@/utils/data'
import { throttleBackgroundTimer } from '@/utils/tools'
import BackgroundTimer from 'react-native-background-timer'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { onScreenStateChange } from '@/utils/nativeModules/utils'
import { AppState } from 'react-native'
import { updateScrobblePlayTime, updateScrobbleTotalTime } from '@/core/player/scrobble'
import { LIST_IDS } from '@/config/constant.ts'
import listState from '@/store/list/state'

// 记住播放进度：构造要持久化的播放信息（当前歌、位置、列表与索引）
const buildPlayInfoToSave = (): LX.Player.SavedPlayInfo | null => {
  const listIdToSave = playerState.playMusicInfo.listId
  if (!listIdToSave) return null
  const playInfoToSave: LX.Player.SavedPlayInfo = {
    time: playerState.progress.nowPlayTime,
    maxTime: playerState.progress.maxPlayTime,
    listId: listIdToSave,
    index: playerState.playInfo.playIndex,
  }

  if (listIdToSave === LIST_IDS.TEMP) {
    playInfoToSave.tempMeta = listState.tempListMeta
  }

  return playInfoToSave
}

// 立即保存（暂停 / 退后台时调用，避免最后一次进度超出节流窗口而丢失）
const savePlayInfoNow = () => {
  if (!playerState.musicInfo.id || playerState.playMusicInfo.isTempPlay) return
  const playInfoToSave = buildPlayInfoToSave()
  if (playInfoToSave) void savePlayInfo(playInfoToSave)
}

const delaySavePlayInfo = throttleBackgroundTimer(() => {
  const playInfoToSave = buildPlayInfoToSave()
  if (playInfoToSave) void savePlayInfo(playInfoToSave)
}, 2000)

export default () => {
  // const updateMusicInfo = useCommit('list', 'updateMusicInfo')

  // 帧循环句柄（requestAnimationFrame）：前台每帧（~16ms）外推音频位置并驱动歌词同步。
  let rafId: number | null = null
  // 背景计时器句柄（BackgroundTimer，跨 JS 休眠、前后台都跑）：负责锚点校准/进度条/保存/Scrobble。
  // 与 rAF 分工——rAF 每帧做歌词外推（无 Bridge 延迟），BackgroundTimer 保证后台进度不丢。
  let bgInterval: ReturnType<typeof BackgroundTimer.setInterval> | null = null
  let isScreenOn = true
  // AppState 是否处于前台（active）。iOS 上 onScreenStateChange 为空实现（utils.ts 直接 return），
  // isScreenOn 恒为 true，不能用来判断是否「退后台」。改用 AppState 在退后台时停掉 1s 后台计时器
  // 与帧循环，避免 BackgroundTimer 在后台仍每秒经 Bridge 取播放位置 / 写进度 / 上报 Scrobble，
  // 造成 iOS「后台活动」耗电（音频由原生继续播放，不受影响）。
  let isAppActive = AppState.currentState === 'active'
  // 用于「返回软件时自动播放」：仅在应用曾经进入过后台，随后回到前台时才触发，避免启动时误触。
  let wasInBackground = false
  // 进度条拖动进行中：此时歌词时钟由拖动预览 hold 在手指位置，进度条 UI 也跟随手指。
  let isDragging = false
  // 最近一次 seek/点击跳转的目标位置（毫秒），-1 表示当前不在 seek 沉降窗口内。
  // 外推时钟已在 setProgress 时立即锚到目标，这里仅用于在收敛前“保护”校准不被未到位的
  // 引擎旧位置拉回（iOS 一次 seek 约需 80~200ms 才生效）。
  let seekTargetMs = -1
  // 引擎是否正在缓冲/加载网络数据（seek 到未缓存区域时会持续数秒）。
  let isEngineBuffering = false
  const SEEK_CONVERGE_MS = 300 // 收敛容差（ms）：引擎位置落入目标±该值即判定 seek 已生效
  // seek 后额外用引擎真实位置探测收敛，覆盖 iOS seek 生效延迟 / 缓冲导致的首行滞后。
  // 仅用于“清除 seekTargetMs 放开校准”，不再用未收敛的旧位置重锚（外推已立即对齐到目标）。
  let seekResyncTimers: ReturnType<typeof BackgroundTimer.setTimeout>[] = []

  // 当前播放速率（集中读取，避免多处重复）。
  const getRate = () => settingState.setting['player.playbackRate']

  /**
   * 前台每帧（~16ms）驱动：用外推时钟（audioClock）拿到平滑的音频位置（秒），
   * 直接镜像到歌词——不再走 Bridge 取 getPosition()，消除 ~20ms 异步延迟与抖动。
   * 只做歌词 sync；进度条/校准/保存交由 tickCalibrate（前后台都跑的后台计时器）。
   * 行未变化时 lrcSyncToTime 内部跳过重渲染，故每帧高频调用不会重绘整棵歌词树。
   */
  const tickFrame = () => {
    const position = audioClock.getTime()
    try {
      lrcSyncToTime(position * 1000, playerState.isPlay)
    } catch {}
    rafId = requestAnimationFrame(tickFrame)
  }

  /**
   * 前后台都跑（BackgroundTimer，JS 休眠时仍触发）：用原生位置校准外推锚点，
   * 并写入进度条 / Scrobble / 记忆进度。保证后台长时间播放时进度不丢失（原 BackgroundTimer 行为），
   * 同时防止外推长期漂移。仅在「正常播放、非拖动、非 seek 沉降、非缓冲」时重锚，避免回跳。
   */
  const tickCalibrate = () => {
    void getPosition().then((position) => {
      if (position == null || !playerState.musicInfo.id) return
      if (!isDragging && seekTargetMs < 0 && !isEngineBuffering) {
        audioClock.setAnchor(position * 1000, getRate(), playerState.isPlay)
      }
      setNowPlayTime(position)
      if (playerState.isPlay) {
        updateScrobblePlayTime(position)
        if (
          settingState.setting['player.isSavePlayTime'] &&
          !playerState.playMusicInfo.isTempPlay
        ) {
          delaySavePlayInfo()
        }
      }
    }).catch(() => {})
  }

  const getMaxTime = async() => {
    const duration = await getDuration()
    setMaxplayTime(duration)
    updateScrobbleTotalTime(duration)

    if (
      playerState.playMusicInfo.musicInfo &&
      'source' in playerState.playMusicInfo.musicInfo &&
      !playerState.playMusicInfo.musicInfo.interval
    ) {
      if (playerState.playMusicInfo.listId) {
        void updateListMusics([
          {
            id: playerState.playMusicInfo.listId,
            musicInfo: {
              ...playerState.playMusicInfo.musicInfo,
              interval: formatPlayTime2(playerState.progress.maxPlayTime),
            },
          },
        ])
      }
    }
  }

  const clearUpdateTimeout = () => {
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (bgInterval != null) {
      BackgroundTimer.clearInterval(bgInterval)
      bgInterval = null
    }
  }

  const startUpdateTimeout = () => {
    if (!isScreenOn || !isAppActive) return
    clearUpdateTimeout()
    // 歌词时钟：requestAnimationFrame 每帧（~16ms）以「外推时钟」驱动，取代原 80ms Bridge 轮询。
    // 外推时钟只在锚点处取一次原生位置，之后纯 JS 单调时钟外推，不受 Bridge 往返延迟与
    // JS 线程排队影响，使高亮行紧贴音频真实位置（实时同步）。
    rafId = requestAnimationFrame(tickFrame)
    // 后台计时器（1s）：前后台都跑，负责锚点校准 / 进度条 / 保存 / Scrobble。
    // 与 rAF 分工——rAF 每帧做歌词外推（无 Bridge 延迟），BG 计时器保证后台进度不丢、外推不漂移。
    bgInterval = BackgroundTimer.setInterval(tickCalibrate, 1000)
  }

  const setProgress = (time: number, maxTime?: number) => {
    if (!playerState.musicInfo.id) return
    seekTargetMs = time * 1000 // 记录 seek 目标，开启“收敛保护”窗口，防止校准用旧位置拉回
    // 立即把外推时钟【冻结】在目标位置（不从这一刻外推前进）：歌词/进度条瞬间对齐到目标，
    // 且不会因 seek 生效延迟（80~450ms）让外推时钟漂到「目标+延迟」、使歌词跑在音频前面造成不同步。
    // 待 seek 真正生效（playerPlaying / 收敛探测）后用引擎真实位置 resume，从准确位置继续外推。
    audioClock.hold(time * 1000)
    setNowPlayTime(time)
    if (playerState.isPlay) updateScrobblePlayTime(time)
    void setCurrentTime(time)
    // 跳转进度时同步校正歌词：外推已锚到目标，歌词行与音频实时同步（不启动 ticker）。
    try {
      lrcSyncToTime(time * 1000, playerState.isPlay)
    } catch {}
    // seek 后引擎真正落位常有 80~200ms 延迟（尤其 iOS / 网络缓冲）。探测收敛：仅在引擎位置
    // 落入目标±容差时清除 seekTargetMs 放开校准，避免校准用未收敛旧位置把外推拉回造成回跳。
    // 注意：此处只用探测清除窗口，不再用旧位置重锚（外推已立即对齐目标，重锚反而回归 bug）。
    seekResyncTimers.forEach(t => BackgroundTimer.clearTimeout(t))
    seekResyncTimers = []
    const scheduleSeekSettle = (delay: number) => {
      const timer = BackgroundTimer.setTimeout(() => {
        void getPosition().then((position) => {
          if (position == null || !playerState.musicInfo.id) return
          if (Math.abs(position * 1000 - seekTargetMs) <= SEEK_CONVERGE_MS) {
            // 兜底：若未收到 playing 事件，这里同样用真实位置放开外推（保留当前播放态），
            // 避免歌词长时间卡在 seek 目标值而不随音频前进。
            audioClock.setAnchor(position * 1000, getRate(), playerState.isPlay)
            seekTargetMs = -1
          }
        }).catch(() => {})
      }, delay)
      seekResyncTimers.push(timer)
    }
    scheduleSeekSettle(150)
    scheduleSeekSettle(450)
    if (maxTime != null) {
      setMaxplayTime(maxTime)
      updateScrobbleTotalTime(maxTime)
    }
  }

  // 拖动进度条期间接管歌词时钟，使其高亮行跟随手指位置；同时实时 seek 音频。
  // 无论播放/暂停态，向左/向右拖动进度条，歌词高亮行都必须与手指实时同步。
  let lastPreviewTime = 0
  let lastDragSeekTime = 0
  const handleProgressDragPreview = (time: number) => {
    if (!playerState.musicInfo.id) return
    // 拖动预览：用真实手指位置 hold 住外推时钟（暂停外推、固定显示手指位置），
    // 歌词高亮行跟随手指；rAF 每帧用 hold 值同步，达到「拖动时音频与歌词实时同步」。
    audioClock.hold(time)
    setNowPlayTime(time / 1000)
    try {
      lrcSyncToTime(time, playerState.isPlay)
    } catch {}
    // 节流音频 seek：每 ~120ms 最多一次，避免连续拖动产生大量 seek 在 iOS 上堆积，
    // 导致音频滞后于手指、与即时更新的歌词/进度条不同步。
    const now = Date.now()
    if (time !== lastPreviewTime && now - lastDragSeekTime >= 120) {
      lastPreviewTime = time
      lastDragSeekTime = now
      void setCurrentTime(time / 1000, false)
    }
  }
  const handleProgressDragState = (drag: boolean) => {
    isDragging = drag
  }

  // 引擎缓冲/加载状态跟踪：seek 到未缓存区域时引擎进入 buffering（等待网络数据），
  // 暂停外推、固定显示当前位置，避免歌词超前于尚未真正播放的音频。
  const handlePlayerWaiting = () => {
    isEngineBuffering = true
    if (seekTargetMs >= 0) {
      // seek 进行中：固定显示在【seek 目标值】（已立即对齐），而非外推漂移值，避免歌词超前于尚未真正跳转的音频。
      audioClock.hold(seekTargetMs)
      return
    }
    // 网络缓冲：冻结在音频【真实】位置（而非外推漂移值），避免歌词超前于已停滞的音频；
    // playing 后用真实位置 resume 即可无缝衔接（不回跳）。与「预加载」(player.isEnableAudioPreload)
    // 互补：预加载保证切歌 / 缓冲边界流畅，此处保证播放中偶发网络缓冲时歌词与音频仍严格同步。
    void getPosition().then((position) => {
      if (position != null && playerState.musicInfo.id && isEngineBuffering) {
        audioClock.hold(position * 1000)
      } else if (playerState.musicInfo.id && isEngineBuffering) {
        audioClock.hold(audioClock.getTime() * 1000)
      }
    }).catch(() => {
      if (isEngineBuffering) audioClock.hold(audioClock.getTime() * 1000)
    })
  }
  const handlePlayerPlaying = () => {
    isEngineBuffering = false
    // seek 已真正生效并从该位置恢复播放：立即用引擎真实位置重锚外推并放开校准，
    // 歌词从此刻起严格跟随音频（不再死等收敛探测，消除「跳转后歌词卡在偏移位置」）。
    if (seekTargetMs >= 0) {
      void getPosition().then((position) => {
        if (position != null && playerState.musicInfo.id) {
          audioClock.resume(position * 1000, getRate())
        }
      }).catch(() => {})
      seekTargetMs = -1
      return
    }
    // 普通缓冲结束（非 seek）：用引擎真实位置重锚外推。
    void getPosition().then((position) => {
      if (position != null && playerState.musicInfo.id) {
        audioClock.resume(position * 1000, getRate())
      }
    }).catch(() => {})
  }

  const handlePlay = () => {
    void getMaxTime()
    startUpdateTimeout()
    // 从暂停 / 后台返回后恢复播放的瞬间，立即用引擎实时位置重锚外推时钟，
    // 避免首句高亮与音频真实位置错位，覆盖「暂停→后台→重开→播放」场景。
    if (playerState.musicInfo.id) {
      void getPosition().then((position) => {
        if (position != null && playerState.musicInfo.id) {
          audioClock.setAnchor(position * 1000, getRate(), true)
          try { lrcSyncToTime(position * 1000, true) } catch {}
        }
      })
      // 恢复播放（记忆进度 restore seek）/ 暂停恢复场景下，引擎从 seek 目标真正起播需要
      // 数百毫秒稳定期，'playing' 瞬间 getPosition 可能仍是旧值。延迟再锚一次校正外推时钟，
      // 确保「暂停→退出→重开→继续播放」后音频与歌词严格同步。
      BackgroundTimer.setTimeout(() => {
        void getPosition().then((position) => {
          if (position != null && playerState.musicInfo.id && playerState.isPlay) {
            audioClock.setAnchor(position * 1000, getRate(), true)
          }
        })
      }, 400)
    }
  }

  const handlePause = () => {
    // 外推停在当前位置：仍保持 rAF 每帧 sync，使歌词（含封面页 MiniLyric）始终与音频当前位置同步，
    // 但歌词时钟不再自行前进。暂停瞬间立即持久化一次当前进度，防止杀 App 丢失位置。
    audioClock.setPlaying(false)
    savePlayInfoNow()
  }

  const handleStop = () => {
    clearUpdateTimeout()
    seekResyncTimers.forEach(t => BackgroundTimer.clearTimeout(t))
    seekResyncTimers = []
    audioClock.reset()
    setNowPlayTime(0)
    setMaxplayTime(0)
  }

  const handleError = () => {
    clearUpdateTimeout()
    audioClock.reset()
  }

  const handleSetPlayInfo = () => {
    handlePause()
    if (!playerState.playMusicInfo.isTempPlay) {
      const playMusicInfo = playerState.playMusicInfo
      if (!playMusicInfo.listId) return

      const playInfoToSave: LX.Player.SavedPlayInfo = {
        time: playerState.progress.nowPlayTime,
        maxTime: playerState.progress.maxPlayTime,
        listId: playMusicInfo.listId,
        index: playerState.playInfo.playIndex,
      }

      if (playMusicInfo.listId === LIST_IDS.TEMP) {
        playInfoToSave.tempMeta = listState.tempListMeta
      }

      void savePlayInfo(playInfoToSave)
    }
  }

  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys, settings) => {
    if (keys.includes('player.playbackRate')) {
      // 速率变化：以当前外推位置为新的锚点重算，避免外推跳变；并重启帧循环（实际无需重启，
      // 但保持与原行为一致，确保新速率在下一帧立即生效）。
      audioClock.setRate(getRate())
      startUpdateTimeout()
    }
  }

  const handleScreenStateChanged: Parameters<typeof onScreenStateChange>[0] = (state) => {
    isScreenOn = state == 'ON'
    if (isScreenOn) {
      // 亮屏时即启动帧循环：无论播放/暂停都保持歌词与音频位置同步
      // （暂停 seek / 后台重开 / 封面页 MiniLyric 等场景）。
      startUpdateTimeout()
    } else clearUpdateTimeout()
  }

  AppState.addEventListener('change', (state) => {
    isAppActive = state == 'active'
    if (state == 'background') {
      // 退后台：立即持久化一次进度，并停掉 1s 后台计时器与帧循环。否则 BackgroundTimer 在后台仍
      // 每秒经 Bridge 取播放位置 / 写进度 / 上报 Scrobble，造成 iOS「后台活动」耗电。音频由原生继续播放。
      wasInBackground = true
      savePlayInfoNow()
      clearUpdateTimeout()
      return
    }
    if (state == 'active' && !isScreenOn) {
      handleScreenStateChanged('ON')
    }
    if (state == 'active' && playerState.musicInfo.id) {
      // 从后台/挂起状态回到前台：立即用引擎实时位置重锚外推时钟，不依赖 isScreenOn 是否已清，
      // 消除回前台瞬间高亮滞后窗口，保证“播放时后台回前台”音频与歌词实时同步。
      void getPosition().then((position) => {
        if (position != null && playerState.musicInfo.id) {
          audioClock.setAnchor(position * 1000, getRate(), playerState.isPlay)
          try { lrcSyncToTime(position * 1000, playerState.isPlay) } catch {}
        }
      })
      // 回前台重启帧循环与 1s 后台计时器（iOS 上 onScreenStateChange 为空实现，必须靠此路径重启，
      // 否则退后台清除后回到前台不会恢复歌词同步/进度校准）。
      startUpdateTimeout()
    }
    // 从后台切换回软件时，若开启开关且当前有歌曲但处于暂停状态，则自动恢复播放
    if (state == 'active' && wasInBackground && settingState.setting['player.autoPlayOnReturn'] && !playerState.isPlay && playerState.musicInfo.id) {
      play()
    }
  })

  global.app_event.on('play', handlePlay)
  global.app_event.on('pause', handlePause)
  global.app_event.on('stop', handleStop)
  global.app_event.on('error', handleError)
  global.app_event.on('setProgress', setProgress)
  global.app_event.on('progressDragPreview', handleProgressDragPreview)
  global.app_event.on('progressDragState', handleProgressDragState)
  global.app_event.on('musicToggled', handleSetPlayInfo)
  global.app_event.on('playerWaiting', handlePlayerWaiting)
  global.app_event.on('playerPlaying', handlePlayerPlaying)
  global.state_event.on('configUpdated', handleConfigUpdated)
  onScreenStateChange(handleScreenStateChanged)
}
