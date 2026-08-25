import { updateListMusics } from '@/core/list'
import { setMaxplayTime, setNowPlayTime } from '@/core/player/progress'
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
import { LIST_IDS } from "@/config/constant.ts"
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

  const getCurrentTime = () => {
    let id = playerState.musicInfo.id
    void getPosition().then((position) => {
      if (!position || id != playerState.musicInfo.id) return
      setNowPlayTime(position)
      updateScrobblePlayTime(position)

      // 用真实播放进度持续校正歌词时钟：歌词解析器内部以墙钟驱动、与音频位置解耦，
      // 若不每拍校正，拖动进度/倍速播放后歌词会错位。
      if (playerState.isPlay) {
        try { lrcPlay(position * 1000) } catch {}
      }

      if (!playerState.isPlay) return
      if (
        settingState.setting['player.isSavePlayTime'] &&
        !playerState.playMusicInfo.isTempPlay &&
        isScreenOn
      ) {
        delaySavePlayInfo()
      }
    })
  }

  const getMaxTime = async () => {
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
    updateTimeout = BackgroundTimer.setInterval(() => {
      getCurrentTime()
    }, 1000 / settingState.setting['player.playbackRate'])
    getCurrentTime()
  }

  const setProgress = (time: number, maxTime?: number) => {
    if (!playerState.musicInfo.id) return
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

  const handlePlay = () => {
    void getMaxTime()
    startUpdateTimeout()
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
      const playMusicInfo = playerState.playMusicInfo;
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
    if (state == 'active' && !isScreenOn) handleScreenStateChanged('ON')
  })

  global.app_event.on('play', handlePlay)
  global.app_event.on('pause', handlePause)
  global.app_event.on('stop', handleStop)
  global.app_event.on('error', handleError)
  global.app_event.on('setProgress', setProgress)
  global.app_event.on('musicToggled', handleSetPlayInfo)
  global.state_event.on('configUpdated', handleConfigUpdated)
  onScreenStateChange(handleScreenStateChanged)
}
