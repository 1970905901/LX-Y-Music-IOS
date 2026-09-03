import { updateListMusics } from '@/core/list'
import { setMaxplayTime, setNowPlayTime } from '@/core/player/progress'
import { getTimelineDuration } from '@/core/player/timeline'
import { setCurrentTime, getDuration, getPosition } from '@/plugins/player/utils'
import { formatPlayTime2 } from '@/utils/common'
import { savePlayInfo } from '@/utils/data'
import { throttleBackgroundTimer } from '@/utils/tools'
import BackgroundTimer from 'react-native-background-timer'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { onScreenStateChange } from '@/utils/nativeModules/utils'
import { AppState, Platform } from 'react-native'
// UI 平滑时钟：仅服务于逐字歌词高亮与歌词连续滚动的每帧插值，
// 不参与歌词行同步（行高亮已交由歌词引擎内部 ticker 驱动）。
import { audioClock } from '@/core/player/audioClock'
import {
  updateScrobbleInfo,
  updateScrobblePlayTime,
  updateScrobbleTotalTime,
} from '@/core/player/scrobble'
import { syncLyric } from '@/core/lyric'

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

  // iOS seek 稳定期：播放态快进/快退后，在指定时间内用引擎真实位置纯镜像歌词，
  // 避免解码器/缓冲尚未落点时歌词 ticker 提前启动导致先走。
  let seekGeneration = 0
  const SEEK_SETTLE_MS = 2500

  const isRestoringCurrentMusic = () => {
    const restorePlayInfo = global.lx.restorePlayInfo
    if (!restorePlayInfo) return false
    return restorePlayInfo.listId == playerState.playMusicInfo.listId &&
      restorePlayInfo.index == playerState.playInfo.playIndex
  }

  const getCurrentTime = () => {
    let id = playerState.musicInfo.id
    void getPosition().then(position => {
      if (!position || id != playerState.musicInfo.id) return
      setNowPlayTime(position)
      // 用引擎真实位置重新锚定 UI 时钟：外推只在两次校准之间插值，避免长期漂移。
      audioClock.setAnchor(position * 1000, settingState.setting['player.playbackRate'], playerState.isPlay)

      // iOS 播放态 seek 稳定期内：用引擎真实位置纯镜像歌词，防止解码器/缓冲尚未落点
      // 时歌词 ticker 提前启动，导致快进/快退后歌词与音频不同步。
      if (Platform.OS == 'ios' && playerState.isPlay && seekGeneration > 0) {
        syncLyric(position, playerState.isPlay)
      }

      if (!playerState.isPlay) return

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
      getCurrentTime()
    }, 1000 / settingState.setting['player.playbackRate'])
    getCurrentTime()
  }

  const setProgress = (time: number, maxTime?: number) => {
    if (!playerState.musicInfo.id) return
    // console.log('setProgress', time, maxTime)
    setNowPlayTime(time)
    // seek 期间先冻结 UI 时钟在目标位置，等引擎返回真实落点后再重锚。
    audioClock.hold(time * 1000)

    // iOS 播放态 seek：进入稳定期，由进度轮询用真实位置纯镜像歌词；
    // 稳定期结束后再启动歌词 ticker，避免解码器/缓冲尚未落点时歌词先跳到目标位置。
    seekGeneration++
    const currentGeneration = seekGeneration

    void setCurrentTime(time).then((targetPosition) => {
      if (!playerState.musicInfo.id) return
      const actualTime = targetPosition > 0 ? targetPosition : time
      if (targetPosition > 0) setNowPlayTime(targetPosition)
      audioClock.setAnchor(actualTime * 1000, settingState.setting['player.playbackRate'], playerState.isPlay)

      // 非 iOS 或暂停态：可以直接用实际落点启动歌词 ticker。
      if (Platform.OS != 'ios' || !playerState.isPlay) {
        global.app_event.seekLyric(actualTime)
        return
      }

      BackgroundTimer.setTimeout(() => {
        if (seekGeneration !== currentGeneration) return
        seekGeneration = 0
        void getPosition().then((position) => {
          if (position <= 0) return
          global.app_event.seekLyric(position)
        })
      }, SEEK_SETTLE_MS)
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
  }
  const handlePause = () => {
    // prevProgressStatus = 'paused'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    // clearBufferTimeout()
    audioClock.setPlaying(false)
    clearUpdateTimeout()
  }

  const handleStop = () => {
    clearUpdateTimeout()
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

  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys, settings) => {
    if (keys.includes('player.playbackRate')) startUpdateTimeout()
  }

  const handleScreenStateChanged: Parameters<typeof onScreenStateChange>[0] = (state) => {
    isScreenOn = state == 'ON'
    if (isScreenOn) {
      if (playerState.isPlay) startUpdateTimeout()
    } else clearUpdateTimeout()
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
  // global.app_event.on(eventPlayerNames.restorePlay, handleRestorePlay)
  // global.app_event.on('playerLoadeddata', handleLoadeddata)
  // global.app_event.on('playerCanplay', handleCanplay)
  // global.app_event.on('playerWaiting', handleWating)
  // global.app_event.on('playerEmptied', handleEmpied)
  global.app_event.on('musicToggled', handleSetPlayInfo)
  global.state_event.on('configUpdated', handleConfigUpdated)

  onScreenStateChange(handleScreenStateChanged)
}
