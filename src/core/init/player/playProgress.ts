import { updateListMusics } from '@/core/list'
import { setMaxplayTime, setNowPlayTime } from '@/core/player/progress'
import { getTimelineDuration } from '@/core/player/timeline'
import { setCurrentTime, getDuration, getPosition, setVolume } from '@/plugins/player/utils'
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
import { setSeekMuting } from '@/core/player/seekMute'

// 需要「冻结 + 静音等待追平」的高码率音质：这些音质在 seek 后音频需要较长缓冲重排，
// 先让歌词跳到目标行并静音，待音频位置追上目标再恢复音量并启动歌词 ticker，保证同步。
const freezeQualities = new Set<LX.Quality>(['master', 'atmos', 'atmos_plus'])

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
      // 用引擎真实落点重锚 UI 时钟，并让歌词跳到同一位置，音频与歌词保持同步。
      audioClock.setAnchor(actualTime * 1000, settingState.setting['player.playbackRate'], playerState.isPlay)

      // 非 iOS 或暂停态：直接用实际落点启动歌词 ticker。
      if (Platform.OS != 'ios' || !playerState.isPlay) {
        global.app_event.seekLyric(actualTime)
        return
      }

      // 仅对高码率音质（臻品母带 master / atmos / atmos_plus）启用「冻结 + 静音等待追平」：
      // 这些音质 seek 后音频需较长缓冲重排，若直接出声会与歌词错位。先让歌词跳到目标行并静音，
      // 待音频位置追上目标后再恢复音量并启动歌词 ticker，实现“歌词先到位、音频随后跟上”。
      if (!freezeQualities.has(playerState.quality ?? '')) {
        global.app_event.seekLyric(actualTime)
        return
      }

      seekGeneration++
      const currentGeneration = seekGeneration

      // 冻结期（仅静音、不冻结歌词）：音频缓冲追赶期间先静音，避免错位/抢跑的声音；
      // 歌词则按音频时钟正常“走字”（实时推进），待音频位置追上歌词当前位置再放出声音，
      // 实现“歌词正常走、音频缓冲追上后同步出声”。
      setSeekMuting(true)
      void setVolume(0)
      global.app_event.seekLyric(time)
      const waitStart = Date.now()
      const catchUp = () => {
        if (seekGeneration !== currentGeneration) return
        void getPosition().then((position) => {
          if (seekGeneration !== currentGeneration) return
          const posMs = (position || 0) * 1000
          // 歌词当前实时位置（音频时钟外推）：音频追上歌词即视为同步。
          const lyricMs = audioClock.getTime() * 1000
          const caught = posMs >= lyricMs - 250
          const timedOut = Date.now() - waitStart > 8000
          if (caught || timedOut) {
            seekGeneration = 0
            setSeekMuting(false)
            // 音频已追上：先恢复音量，再以音频真实落点重新锚定时钟，二者同步发声。
            void setVolume(settingState.setting['player.volume'])
            const start = position > 0 ? position : time
            audioClock.setAnchor(start * 1000, settingState.setting['player.playbackRate'], true)
            // 仅超时时兜底将歌词重新对齐到音频真实落点，避免永久错位。
            if (timedOut) global.app_event.seekLyric(start)
          } else {
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
    // 彻底结束播放：清除可能残留的 seek 冻结态与静音标志，避免下次播放被静音。
    seekGeneration = 0
    setSeekMuting(false)
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
