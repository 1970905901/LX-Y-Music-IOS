import { updateListMusics } from '@/core/list'
import { setMaxplayTime, setNowPlayTime } from '@/core/player/progress'
import { getTimelineDuration } from '@/core/player/timeline'
import { setCurrentTime, getDuration, getPosition, setVolume } from '@/plugins/player/utils'
import { formatPlayTime2 } from '@/utils/common'
import { savePlayInfo } from '@/utils/data'
import { throttleBackgroundTimer } from '@/utils/tools'
import BackgroundTimer from 'react-native-background-timer'
import { syncLyric } from '@/core/lyric'
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

// 音质等级：值越大码率/规格越高。320k 及以下（含 320k）直接同步；高于 320k 的无损及以上
// 音质（flac / flac24bit / hires / dolby / atmos / atmos_plus / master）在 seek 后音频需较长
// 缓冲重排，启用「冻结 + 静音等待追平」：先让歌词跳到目标行并静音，待音频位置追上目标再
// 恢复音量并启动歌词 ticker，保证歌词与音频同步。
const qualityRank: Record<string, number> = {
  '128k': 0, '192k': 1, '320k': 2, 'flac': 3, 'flac24bit': 4,
  'hires': 5, 'dolby': 6, 'atmos': 7, 'atmos_plus': 8, 'master': 9,
}
const isQualityBeyond320k = (quality?: LX.Quality | null) => {
  if (!quality) return false
  return (qualityRank[quality] ?? -1) > qualityRank['320k']
}

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

  // seek 冻结代际：播放态快进/快退后，对高码率音质先锁定歌词在目标行并静音，
  // 待音频缓冲追平目标后再启动 ticker，实现“歌词先到位、音频随后跟上”。
  let seekGeneration = 0

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

      // 处于 seek 冻结期（高码率音质快进/快退）：歌词已锁定在目标行、UI 时钟保持 hold，
      // 此处仅更新进度条与上报，不重锚音频时钟、也不驱动歌词，避免缓冲尚未落点时画面抖动。
      if (seekGeneration > 0) {
        if (!playerState.isPlay) return
        updateScrobblePlayTime(position)
        if (settingState.setting['player.isSavePlayTime'] && !playerState.playMusicInfo.isTempPlay && isScreenOn) {
          delaySavePlayInfo()
        }
        return
      }

      // 用引擎真实位置重新锚定 UI 时钟：外推只在两次校准之间插值，避免长期漂移。
      audioClock.setAnchor(position * 1000, settingState.setting['player.playbackRate'], playerState.isPlay)

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

    // 参考项目对齐的 seek：音频与歌词用同一真实落点，保证普通音质快进/快退后二者同步。
    void setCurrentTime(time).then((targetPosition) => {
      if (!playerState.musicInfo.id) return
      const actualTime = targetPosition > 0 ? targetPosition : time
      if (targetPosition > 0) setNowPlayTime(targetPosition)

      // 非 iOS 或暂停态：用真实落点直接启动歌词 ticker，无静音冻结。
      if (Platform.OS != 'ios' || !playerState.isPlay) {
        audioClock.setAnchor(actualTime * 1000, settingState.setting['player.playbackRate'], playerState.isPlay)
        global.app_event.seekLyric(actualTime)
        return
      }

      // 普通音质（≤320k）：音频与歌词同一真实落点同步，直接启动歌词 ticker。
      if (!isQualityBeyond320k(playerState.quality)) {
        audioClock.setAnchor(actualTime * 1000, settingState.setting['player.playbackRate'], playerState.isPlay)
        global.app_event.seekLyric(actualTime)
        return
      }

      // 高于 320k 的无损及以上音质：快进/快退后歌词冻结不走、音频静音，
      // 等音频网络缓冲追平（从目标位置真正开始播放）后再恢复音量并让歌词同步走字。
      seekGeneration++
      const currentGeneration = seekGeneration
      // 冻结逐字高亮时钟（不推进），与歌词行一致停在原地。
      audioClock.hold(time * 1000)
      void setVolume(0)
      // 歌词纯镜像到目标行（不启动 ticker），停在原地不走字，等待音频缓冲跟上。
      syncLyric(time, false)
      const waitStart = Date.now()
      const catchUp = () => {
        if (seekGeneration !== currentGeneration) return
        void getPosition().then((position) => {
          if (seekGeneration !== currentGeneration) return
          const posMs = (position || 0) * 1000
          // 歌词已冻结在 time；当音频已从目标位置前进（缓冲就绪、真正播放）即视为追平。
          const caught = posMs >= time * 1000 + 300
          const timedOut = Date.now() - waitStart > 8000
          if (caught || timedOut) {
            seekGeneration = 0
            void setVolume(settingState.setting['player.volume'])
            const start = position > 0 ? position : time
            // 音频追上：恢复音量，并以音频真实落点重新锚定时钟与启动歌词 ticker，二者同步发声。
            audioClock.setAnchor(start * 1000, settingState.setting['player.playbackRate'], true)
            global.app_event.seekLyric(start)
          } else {
            // 仍未追上：持续静音，下轮再检查。
            void setVolume(0)
            BackgroundTimer.setTimeout(catchUp, 200)
          }
        })
      }
      catchUp()
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
    // 彻底结束播放：清除可能残留的 seek 冻结代际，避免下次播放被旧轮询干扰。
    seekGeneration = 0
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
