import { updateListMusics } from '@/core/list'
import { setMaxplayTime, setNowPlayTime } from '@/core/player/progress'
import { play } from '@/core/player/player'
import { setCurrentTime, getDuration, getPosition } from '@/plugins/player'
import { play as lrcPlay } from '@/plugins/lyric'
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

const delaySavePlayInfo = throttleBackgroundTimer(() => {
  const listIdToSave = playerState.playMusicInfo.listId
  const playInfoToSave: LX.Player.SavedPlayInfo = {
    time: playerState.progress.nowPlayTime,
    maxTime: playerState.progress.maxPlayTime,
    listId: listIdToSave!,
    index: playerState.playInfo.playIndex,
  }

  if (listIdToSave === LIST_IDS.TEMP) {
    playInfoToSave.tempMeta = listState.tempListMeta
  }

  void savePlayInfo(playInfoToSave)
}, 2000)

export default () => {
  // const updateMusicInfo = useCommit('list', 'updateMusicInfo')

  let updateTimeout: number | null = null
  let isScreenOn = true
  // 进度条拖动进行中：此时歌词时钟交由拖动预览重锚，暂停逐秒的 lrc 重锚，
  // 否则每拍都会把预览高亮拽回音频旧位置，表现为“拖动时进度条与歌词高亮行不同步”。
  let isDragging = false
  // 最近一次 seek/点击跳转的时间戳。每拍重锚歌词时钟前需判断是否在 seek 沉降窗口内，
  // 避免把刚跳转的高亮行又拽回 seek 前的旧位置（iOS 一次 seek 约需 ~180ms 才生效）。
  let lastSeekTime = 0

  const getCurrentTime = () => {
    let id = playerState.musicInfo.id
    void getPosition().then((position) => {
      if (!position || id != playerState.musicInfo.id) return
      setNowPlayTime(position)
      updateScrobblePlayTime(position)

      if (!playerState.isPlay) return

      // 长期同步：每拍用真实音频位置重锚歌词时钟，避免 seek/拖动/卡顿/倍速后
      // 歌词解析器自身的墙钟与真实音频位置永久漂移（表现为“快进后/点歌词后对不齐”）。
      // 拖动进度条期间由 progressDragPreview 事件接管歌词时钟，这里跳过，避免把预览高亮拽回旧位置。
      // seek/点击后的 ~250ms 内跳过，避免把刚跳转的高亮行又拽回 seek 前的旧位置
      // （iOS 一次 seek 约需 ~180ms 才生效，期间 getPosition 仍是旧位置；250ms 已留足余量）。
      if (!isDragging && Date.now() - lastSeekTime > 250) {
        try { lrcPlay(position * 1000) } catch {}
      }
      if (
        settingState.setting['player.isSavePlayTime'] &&
        !playerState.playMusicInfo.isTempPlay &&
        isScreenOn
      ) {
        delaySavePlayInfo()
      }
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
    // 收紧到 250ms，使高亮更贴近音频真实位置（getPosition 本身仍有轮询延迟，
    // 该值即高亮与音频的稳态偏差上限）。
    updateTimeout = BackgroundTimer.setInterval(() => {
      getCurrentTime()
    }, 250 / settingState.setting['player.playbackRate'])
    getCurrentTime()
  }

  const setProgress = (time: number, maxTime?: number) => {
    if (!playerState.musicInfo.id) return
    lastSeekTime = Date.now()
    setNowPlayTime(time)
    updateScrobblePlayTime(time)
    void setCurrentTime(time)
    // 跳转进度时同步校正歌词时钟：点击歌词段落 / 拖动进度条后让高亮行立即跟随
    try { lrcPlay(time * 1000) } catch {}
    if (maxTime != null) {
      setMaxplayTime(maxTime)
      updateScrobbleTotalTime(maxTime)
    }
  }

  // bug③: 拖动进度条期间接管歌词时钟，使其高亮行跟随手指位置而不 seek 音频（防卡顿）。
  const handleProgressDragPreview = (time: number) => {
    if (!playerState.musicInfo.id) return
    try { lrcPlay(time) } catch {}
  }
  const handleProgressDragState = (drag: boolean) => {
    isDragging = drag
    // 进入拖动瞬间记一次 seek 时间戳，避免刚结束拖动时逐秒重锚把高亮拽回旧位置
    if (drag) lastSeekTime = Date.now()
  }

  const handlePlay = () => {
    void getMaxTime()
    startUpdateTimeout()
    // 从暂停 / 后台返回后恢复播放的瞬间，立即用引擎实时位置重锚歌词时钟，
    // 避免首句高亮与音频真实位置错位，覆盖「暂停→后台→重开→播放」场景。
    if (playerState.musicInfo.id) {
      void getPosition().then((position) => {
        if (position != null && playerState.musicInfo.id) {
          try { lrcPlay(position * 1000) } catch {}
        }
      })
    }
  }

  const handlePause = () => {
    clearUpdateTimeout()
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
      if (playerState.isPlay) startUpdateTimeout()
    } else clearUpdateTimeout()
  }

  AppState.addEventListener('change', (state) => {
    if (state == 'active' && !isScreenOn) {
      handleScreenStateChanged('ON')
      // 从后台切换回软件时，若开启开关且当前有歌曲但处于暂停状态，则自动恢复播放
      if (settingState.setting['player.autoPlayOnReturn'] && !playerState.isPlay && playerState.musicInfo.id) {
        play()
      }
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
  global.state_event.on('configUpdated', handleConfigUpdated)
  onScreenStateChange(handleScreenStateChanged)
}
