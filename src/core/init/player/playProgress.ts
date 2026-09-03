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
import TrackPlayer, { State } from 'react-native-track-player'
import { updateScrobblePlayTime, updateScrobbleTotalTime } from '@/core/player/scrobble'
import { syncNowPlayingMetadata, syncNowPlayingState } from '@/core/player/nowPlaying'
import { refreshRemoteLyric } from '@/core/init/player/lyric'
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
  const SEEK_CONVERGE_MS = 400 // 收敛容差（ms）：引擎位置落入目标±该值即判定 seek 已生效；在线音频 segment/keyframe 对齐允许更大偏差
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
      // seek 沉降期间保持 nowPlayTime 为目标值，避免 500ms 校准用尚未收敛的旧位置把进度条/歌词拽回，
      // 表现为“松手后进度条先跳到目标、下一秒又闪回旧位置”。
      if (seekTargetMs < 0) {
        setNowPlayTime(position)
      }
      if (playerState.isPlay) {
        // Scrobble 仍用引擎真实位置累计，避免 seek 期间被计为“没播放”。
        updateScrobblePlayTime(position)
        if (
          settingState.setting['player.isSavePlayTime'] &&
          !playerState.playMusicInfo.isTempPlay
        ) {
          delaySavePlayInfo()
        }
      }
      // 后台时 JS 歌词 ticker 会被 iOS 节流，导致锁屏/灵动岛歌词不前进。
      // 用 BackgroundTimer 每秒取到的引擎位置回刷一次 NowPlaying artist，保持歌词同步。
      if (!isAppActive) {
        refreshRemoteLyric()
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
    // 后台计时器（500ms）：前后台都跑，负责锚点校准 / 进度条 / 保存 / Scrobble。
    // 与 rAF 分工——rAF 每帧做歌词外推（无 Bridge 延迟），BG 计时器保证后台进度不丢、外推不漂移。
    bgInterval = BackgroundTimer.setInterval(tickCalibrate, 500)
  }

  /**
   * seek 后主动轮询引擎位置，直到确认 seek 已生效或超时兜底。
   * 核心策略：在线音频 seek 不一定精确落到目标（受 segment/keyframe 对齐影响），
   * 所以 settlement 期间不再把歌词/进度条“钉”在目标值，而是每轮都用引擎真实位置回刷。
   * 这样即使实际落点与目标有偏差，歌词也始终跟着真实声音走，避免“快/退后差一行”。
   */
  const startSeekSettlement = (targetMs: number) => {
    seekResyncTimers.forEach(t => BackgroundTimer.clearTimeout(t))
    seekResyncTimers = []

    const maxAttempts = 15 // 100ms * 15 = 1.5s 兜底
    let attempts = 0
    const settle = () => {
      attempts++
      void Promise.all([
        getPosition(),
        TrackPlayer.getState().catch(() => null),
      ]).then(([position, state]) => {
        if (!playerState.musicInfo.id) {
          seekTargetMs = -1
          return
        }
        const positionMs = position == null ? 0 : position * 1000
        const isEnginePlaying = state == State.Playing
        const nearTarget = position != null && Math.abs(positionMs - targetMs) <= SEEK_CONVERGE_MS

        // 每轮都用引擎真实位置回刷歌词和进度条：
        // 在线音频 seek 可能落到目标前后附近，死守目标会导致歌词与真实声音错位。
        if (position != null) {
          try { lrcSyncToTime(positionMs, isEnginePlaying || playerState.isPlay) } catch {}
          setNowPlayTime(positionMs / 1000)
        }

        // 引擎真正在播放且位置接近目标 → seek 已真正生效，从真实位置恢复外推
        if (isEnginePlaying && nearTarget) {
          audioClock.setAnchor(positionMs, getRate(), true)
          seekTargetMs = -1
          return
        }
        // 超时兜底：按引擎实际状态恢复，避免永久 hold
        if (attempts >= maxAttempts) {
          audioClock.setAnchor(positionMs || targetMs, getRate(), isEnginePlaying)
          seekTargetMs = -1
          return
        }
        // 继续轮询
        const timer = BackgroundTimer.setTimeout(settle, 100)
        seekResyncTimers.push(timer)
      }).catch(() => {
        if (attempts >= maxAttempts || !playerState.musicInfo.id) {
          audioClock.setAnchor(targetMs, getRate(), playerState.isPlay)
          seekTargetMs = -1
        } else {
          const timer = BackgroundTimer.setTimeout(settle, 100)
          seekResyncTimers.push(timer)
        }
      })
    }
    settle()
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
    // seek 后引擎真正落位常有 80~200ms 延迟（尤其 iOS / 网络缓冲）。
    // 用主动轮询 settlement 替代固定 150/450/900ms 探测，更快发现 seek 生效并恢复外推。
    startSeekSettlement(seekTargetMs)
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
    // 歌词高亮行跟随手指；rAF 每帧用 hold 值同步，达到「拖动时歌词与进度条实时同步」。
    audioClock.hold(time)
    setNowPlayTime(time / 1000)
    try {
      lrcSyncToTime(time, playerState.isPlay)
    } catch {}
    // 节流音频 seek：避免连续小幅度拖动产生大量 seek 在 iOS / 在线音频上堆积，
    // 导致音频紊乱、与歌词/进度条脱节。
    // 策略：跳转 >=300ms 立即 seek；小幅度移动每 300ms 最多 seek 一次。
    const now = Date.now()
    const timeDelta = Math.abs(time - lastPreviewTime)
    lastPreviewTime = time
    if (timeDelta >= 300 || (timeDelta >= 100 && now - lastDragSeekTime >= 300)) {
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
    if (seekTargetMs >= 0) {
      // seek 已真正生效并从该位置恢复播放：复用 settlement 轮询，命中真实位置后立即恢复外推。
      // 避免原来“未落入容差就保持 hold”导致歌词卡住不随音频前进。
      startSeekSettlement(seekTargetMs)
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
    // 播放即清除「用户主动暂停」标记：回前台自动播放判定（autoPlayOnReturn）据此
    // 区分「被打断 / 系统暂停」与「用户主动暂停」，避免用户暂停后切回前台被误恢复。
    global.lx.playerStatus.userPaused = false
    void getMaxTime()
    // seek 沉降期间由 startSeekSettlement 统一恢复外推：
    // 若此处直接 setPlaying(true)，会在缓冲尚未结束时让歌词从目标位置提前跑起来，
    // 导致在线歌曲快进后歌词比音频快。
    const inSeekSettlement = seekTargetMs >= 0
    if (!inSeekSettlement) {
      // 立即把外推时钟切到「播放中」：play 事件（原生 'playing'）本身就代表正在播放，
      // 这里同步把 audioClock 置为 playing（以当前外推位置为锚，通常是暂停/记忆位置），
      // 让 rAF 在下一帧立即开始外推，避免「原生 playing 事件到达 → getPosition().then
      // 异步重锚生效前」这段空窗里 audioClock 仍停在暂停态、歌词被钉在旧行不动。
      audioClock.setPlaying(true)
      try { lrcSyncToTime(audioClock.getTime() * 1000, true) } catch {}
    }
    startUpdateTimeout()
    // 从暂停 / 后台返回后恢复播放的瞬间，立即用引擎实时位置重锚外推时钟，
    // 避免首句高亮与音频真实位置错位，覆盖「暂停→后台→重开→播放」场景。
    if (playerState.musicInfo.id && !inSeekSettlement) {
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
    // 区分暂停来源：系统音频中断（RemoteDuck）暂停前会置 suppressUserPaused=true，
    // 此处跳过标记，避免「被其他 App 打断的暂停」被误判为用户主动暂停；
    // 其余（App 内暂停按钮、控制中心 RemotePause）一律视为用户主动暂停，回前台不自动恢复。
    if (global.lx.playerStatus.suppressUserPaused) {
      global.lx.playerStatus.suppressUserPaused = false
    } else {
      global.lx.playerStatus.userPaused = true
    }
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
      // 播放中调整倍速时，必须同步到控制中心/锁屏，否则系统仍按旧速率推进进度条，
      // 导致 iPad 控制中心进度与软件内不同步。
      if (playerState.isPlay) {
        void syncNowPlayingState('play')
      }
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
      // 重锚完成（或取位失败）后再启动帧循环：否则会先以「退后台前陈旧的 anchorSystemMs +
      // 后台期间 performance.now 跳跃」外推，导致后台仍在播放时回前台瞬间歌词大幅超前再闪回。
      void getPosition().then((position) => {
        if (position != null && playerState.musicInfo.id) {
          audioClock.setAnchor(position * 1000, getRate(), playerState.isPlay)
          try { lrcSyncToTime(position * 1000, playerState.isPlay) } catch {}
        }
      }).finally(() => {
        // 回前台重启帧循环与 1s 后台计时器（iOS 上 onScreenStateChange 为空实现，必须靠此路径重启，
        // 否则退后台清除后回到前台不会恢复歌词同步/进度校准）。
        startUpdateTimeout()
        // 同步最新进度与速率到控制中心/锁屏：退后台期间系统按旧参考时间推进进度条，
        // 回前台后若只重应用缓存的 elapsedTime，iPad 控制中心进度会与软件内错位。
        void syncNowPlayingState(playerState.isPlay ? 'play' : 'pause')
        // 强制回刷一次歌曲元数据：某些 iOS 版本在 App 挂起后会清空 NowPlaying 会话，
        // 回前台只同步状态可能导致控制中心仍空白。
        void syncNowPlayingMetadata(true)
      })
    }
    // 从后台切换回软件时，若开启开关、当前有歌曲且处于暂停状态，则自动恢复播放。
    // 策略：暂停后切回前台「仍继续播放」——无论暂停来自用户主动（App 内 / 控制中心）
    // 还是系统音频打断，回前台一律恢复，符合「返回软件自动播放」语义（用户要求）。
    // 限制条件：wasInBackground 为 true 仅表示「曾经退过后台」（每次退后台置 true，
    // 回前台即消费为 false），避免重复 / 累积触发导致「关闭开关后概率自动播放」等异常。
    if (state == 'active' && wasInBackground && settingState.setting['player.autoPlayOnReturn'] && !playerState.isPlay && playerState.musicInfo.id) {
      play()
    }
    // 消费：本次「退后台 → 回前台」周期结束，下一次自动播放需重新退后台再回来才触发。
    wasInBackground = false
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
