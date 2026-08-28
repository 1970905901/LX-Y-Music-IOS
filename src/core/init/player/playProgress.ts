import { updateListMusics } from '@/core/list'
import { setMaxplayTime, setNowPlayTime } from '@/core/player/progress'
import { play } from '@/core/player/player'
import { setCurrentTime, getDuration, getPosition } from '@/plugins/player'
import { syncToTime as lrcSyncToTime } from '@/plugins/lyric'
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

  let updateTimeout: number | null = null
  let isScreenOn = true
  // 进度条拖动进行中：此时歌词时钟交由拖动预览重锚，暂停逐秒的 lrc 重锚，
  // 否则每拍都会把预览高亮拽回音频旧位置，表现为“拖动时进度条与歌词高亮行不同步”。
  let isDragging = false
  // 最近一次 seek/点击跳转的时间戳。每拍重锚歌词时钟前需判断是否在 seek 沉降窗口内，
  // 避免把刚跳转的高亮行又拽回 seek 前的旧位置（iOS 一次 seek 约需 ~80-150ms 才生效）。
  let lastSeekTime = 0
  // 最近一次 seek 的目标位置（毫秒），-1 表示当前不在 seek 沉降窗口内。
  // 改用“位置收敛”判定替代固定 120ms：iOS seek 实际生效时间 80~150ms 且不稳定，
  // 固定窗口早于生效即放开轮询会把进度条/歌词拽回旧位置造成回跳；收敛判定则一直
  // 按住目标值直到 getPosition() 真正到达目标附近，再无缝交还轮询，最大化实时同步。
  let seekTargetMs = -1
  // 引擎是否正在缓冲/加载网络数据（seek 到未缓存区域时会持续数秒）。
  // 缓冲期间沉降窗口使用更长的硬上限，避免窗口提前关闭后轮询用未收敛的旧位置
  // 把进度条/歌词拽回旧位置造成回跳（快进快退到未缓存位置时不同步的主因）。
  let isEngineBuffering = false
  const SEEK_SETTLE_MAX_MS = 1200 // 无缓冲沉降窗口硬上限：覆盖偶发慢 seek，防止提前放开拽回
  const SEEK_SETTLE_BUFFERING_MAX_MS = 5000 // 缓冲中硬上限：等网络数据到位收敛，同时兜底防死等
  const SEEK_CONVERGE_MS = 300 // 收敛容差（ms）：引擎位置落入目标±该值即判定 seek 已生效

  // seek 沉降窗口判定：返回 true 表示当前仍在 seek 沉降中，轮询应“按住”进度条与歌词、
  // 不读取尚未生效的 getPosition() 旧值。positionMs 为本次轮询取到的引擎位置（ms）。
  const inSeekSettle = (positionMs: number): boolean => {
    if (seekTargetMs < 0) return false
    const maxMs = isEngineBuffering ? SEEK_SETTLE_BUFFERING_MAX_MS : SEEK_SETTLE_MAX_MS
    if (Date.now() - lastSeekTime > maxMs) {
      seekTargetMs = -1
      return false
    }
    if (!Number.isNaN(positionMs) && Math.abs(positionMs - seekTargetMs) <= SEEK_CONVERGE_MS) {
      seekTargetMs = -1
      return false
    }
    return true
  }

  const getCurrentTime = () => {
    let id = playerState.musicInfo.id
    void getPosition().then((position) => {
      // 仅以 position == null（未取到位置）为跳过条件，允许 position 为 0（歌曲起始瞬间）。
      if (position == null || id != playerState.musicInfo.id) return
      // seek 沉降窗口内（拖动中 / 刚 seek 后引擎位置尚未收敛到目标）：进度条与歌词均保持
      // 在 setProgress / progressDragPreview 写入的目标值，不读取尚未生效的 getPosition() 旧值，
      // 避免把刚跳转的高亮行又拽回旧位置（iOS 一次 seek 约需 80~150ms 才生效，固定 120ms
      // 窗口会早于生效放开导致回跳）。位置收敛到目标附近或超硬上限后，inSeekSettle 返回
      // false，下方正常重锚无缝接管，最大化音频与歌词实时同步。
      const suppressReanchor = isDragging || (!isDragging && inSeekSettle(position * 1000))
      if (!suppressReanchor) {
        setNowPlayTime(position)
        try {
          // 无论播放/暂停，用【真实音频位置】做纯镜像重锚（不启动 ticker），
          // 歌词行永远等于音频真实位置 → 音频与歌词实时同步（覆盖所有场景，含 ⑩）。
          lrcSyncToTime(position * 1000, playerState.isPlay)
        } catch {}
      }

      if (!playerState.isPlay) return

      updateScrobblePlayTime(position)
      if (
        settingState.setting['player.isSavePlayTime'] &&
        !playerState.playMusicInfo.isTempPlay &&
        isScreenOn
      ) {
        delaySavePlayInfo()
      }
    }).catch(() => {
      // getPosition() 在个别情况下可能 reject（如原生模块未就绪）；
      // 绝不能让一次失败静默杀死整条轮询链，否则歌词将彻底停止跟随音频。
    })
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
    if (!updateTimeout) return
    BackgroundTimer.clearInterval(updateTimeout)
    updateTimeout = null
  }

  const startUpdateTimeout = () => {
    if (!isScreenOn) return
    clearUpdateTimeout()
    // 歌词时钟与音频位置的重锚节拍：原 1000ms 过粗，叠加 seek 后 500ms 抑制窗口，
    // 拖拽/快进后高亮行最大可滞后约 1.5s（用户反馈“高亮歌词晚一点”）。
    // 继续收紧到 80ms，使高亮更贴近音频真实位置（getPosition 本身仍有轮询延迟，
    // 该值即高亮与音频的稳态偏差上限）。
    updateTimeout = BackgroundTimer.setInterval(() => {
      getCurrentTime()
    }, 80 / settingState.setting['player.playbackRate'])
    getCurrentTime()
  }

  const setProgress = (time: number, maxTime?: number) => {
    if (!playerState.musicInfo.id) return
    lastSeekTime = Date.now()
    seekTargetMs = time * 1000 // 记录 seek 目标，开启“位置收敛”沉降窗口，按住 UI 直到引擎真正到位
    setNowPlayTime(time)
    if (playerState.isPlay) updateScrobblePlayTime(time)
    void setCurrentTime(time)
    // 跳转进度时同步校正歌词：用真实音频位置纯镜像重锚（含点击歌词行 / 进度条 seek），
    // 无论播放暂停都锚到该位置，歌词行与音频实时同步（不启动 ticker）。
    try {
      lrcSyncToTime(time * 1000, playerState.isPlay)
    } catch {}
    if (maxTime != null) {
      setMaxplayTime(maxTime)
      updateScrobbleTotalTime(maxTime)
    }
  }

  // bug③/⑪: 拖动进度条期间接管歌词时钟，使其高亮行跟随手指位置；
  // 同时实时 seek 音频，让音频与高亮歌词一起跟手指走，达到「播放/暂停态拖动进度条音频与歌词实时同步」。
  // 无论播放还是暂停，向左/向右拖动进度条，歌词高亮行都必须与手指实时同步（第⑪条验收）。
  let lastPreviewTime = 0
  let lastDragSeekTime = 0
  const handleProgressDragPreview = (time: number) => {
    if (!playerState.musicInfo.id) return
    // 拖动预览歌词：用真实音频位置纯镜像重锚（time 已是毫秒），
    // 歌词高亮行跟随手指位置；播放/暂停态一致，左右拖动均与歌词实时同步（不启动 ticker）。
    try {
      lrcSyncToTime(time, playerState.isPlay)
    } catch {}
    // 同步更新 store 进度，使进度条 UI 与歌词在拖动全程（含暂停态）都实时一致：
    // 渲染层进度条与歌词高亮行永远指向同一手指位置（第⑪条：向左/向右拖动均与歌词实时同步）。
    setNowPlayTime(time / 1000)
    const now = Date.now()
    // 节流音频 seek：每 ~120ms 最多一次，避免连续拖动产生大量 seek 在 iOS 上堆积
    // （每次约 80~150ms 才生效），导致音频滞后于手指、与即时更新的歌词/进度条不同步。
    // 仅在时间变化且距上次 seek 已满节流窗口时下发；松手时 setProgress 会做一次权威
    // seek 兜底到精确位置，确保松手后音频停在手指处（第⑪条验收）。
    // verify=false：预览 seek 只做指令下发，不等待/校验/重试，避免拖动中打断
    // 进行中的网络缓冲，导致音频追不上手指、与歌词/进度条脱节。
    if (time !== lastPreviewTime && now - lastDragSeekTime >= 120) {
      lastPreviewTime = time
      lastDragSeekTime = now
      void setCurrentTime(time / 1000, false)
    }
  }
  const handleProgressDragState = (drag: boolean) => {
    isDragging = drag
    // 进入拖动瞬间记一次 seek 时间戳，避免刚结束拖动时逐秒重锚把高亮拽回旧位置
    if (drag) lastSeekTime = Date.now()
  }

  // 引擎缓冲/加载状态跟踪：seek 到未缓存区域时引擎进入 buffering（等待网络数据），
  // 此时沉降窗口需用更长的硬上限（见 inSeekSettle），防止提前放开轮询把
  // 进度条/歌词拽回旧位置。playing 事件在缓冲结束、音频真正恢复时触发。
  const handlePlayerWaiting = () => {
    isEngineBuffering = true
  }
  const handlePlayerPlaying = () => {
    isEngineBuffering = false
  }

  const handlePlay = () => {
    void getMaxTime()
    startUpdateTimeout()
    // 从暂停 / 后台返回后恢复播放的瞬间，立即用引擎实时位置重锚歌词时钟，
    // 避免首句高亮与音频真实位置错位，覆盖「暂停→后台→重开→播放」场景。
    if (playerState.musicInfo.id) {
      void getPosition().then((position) => {
        if (position != null && playerState.musicInfo.id) {
          // 恢复播放瞬间用真实位置纯镜像重锚（不启动 ticker），消除起播错位。
          try { lrcSyncToTime(position * 1000, true) } catch {}
        }
      })
      // 恢复播放（记忆进度 restore seek）/ 暂停恢复场景下，引擎从 seek 目标
      // 真正起播需要数百毫秒稳定期，'playing' 瞬间 getPosition 可能仍是旧值。
      // 延迟再锚一次，用稳定后的引擎真实位置校正歌词时钟，
      // 确保「暂停→退出→重开→继续播放」后音频与歌词严格同步。
      BackgroundTimer.setTimeout(() => {
        void getPosition().then((position) => {
          if (position != null && playerState.musicInfo.id && playerState.isPlay) {
            try { lrcSyncToTime(position * 1000, true) } catch {}
          }
        })
      }, 400)
    }
  }

  const handlePause = () => {
    // 不再清除 updateTimeout：暂停时仍保持 250ms 轮询，使歌词（含封面页 MiniLyric）
    // 始终与音频当前位置同步。播放/保存/Scrobble 等播放态专属逻辑由 getCurrentTime 内部判断。
    // 记住播放进度：暂停瞬间立即持久化一次当前进度，
    // 用户暂停后直接杀掉 App 也不会丢失最后位置（节流保存可能在 2s 窗口内丢尾部）。
    savePlayInfoNow()
  }

  const handleStop = () => {
    clearUpdateTimeout()
    setNowPlayTime(0)
    setMaxplayTime(0)
  }

  const handleError = () => {
    clearUpdateTimeout()
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
    if (keys.includes('player.playbackRate')) startUpdateTimeout()
  }

  const handleScreenStateChanged: Parameters<typeof onScreenStateChange>[0] = (state) => {
    isScreenOn = state == 'ON'
    if (isScreenOn) {
      // 亮屏时即启动轮询：无论播放/暂停都保持歌词与音频位置同步
      // （暂停 seek / 后台重开 / 封面页 MiniLyric 等场景）。
      startUpdateTimeout()
    } else clearUpdateTimeout()
  }

  AppState.addEventListener('change', (state) => {
    // 记住播放进度：退后台立即持久化一次当前进度（iOS 上从后台被杀不保证还有保存机会）
    if (state == 'background') savePlayInfoNow()
    if (state == 'active' && !isScreenOn) {
      handleScreenStateChanged('ON')
    }
    if (state == 'active' && playerState.musicInfo.id) {
      // 从后台/挂起状态回到前台：立即用引擎实时位置纯镜像重锚歌词时钟，
      // 不依赖 isScreenOn 是否已被清为 false，消除回前台瞬间高亮滞后窗口，
      // 保证“播放时后台回前台”音频与歌词实时同步（第⑫条验收）。
      void getPosition().then((position) => {
        if (position != null && playerState.musicInfo.id) {
          try { lrcSyncToTime(position * 1000, playerState.isPlay) } catch {}
        }
      })
    }
    // 从后台切换回软件时，若开启开关且当前有歌曲但处于暂停状态，则自动恢复播放
    if (state == 'active' && settingState.setting['player.autoPlayOnReturn'] && !playerState.isPlay && playerState.musicInfo.id) {
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
