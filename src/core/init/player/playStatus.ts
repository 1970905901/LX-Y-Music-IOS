// import { LIST_ID_LOVE } from '@/config/constant'

import { updateMetaData } from '@/plugins/player'
import playerState from '@/store/player/state'
import { syncNowPlayingState } from '@/core/player/nowPlaying'

export default () => {
  // const setVisibleDesktopLyric = useCommit('setVisibleDesktopLyric')
  // const setLockDesktopLyric = useCommit('setLockDesktopLyric')

  const buttons = {
    empty: true,
    collect: false,
    play: false,
    prev: true,
    next: true,
    lrc: false,
    lockLrc: false,
  }
  const setButtons = () => {
    // setPlayerAction(buttons)
    if (!playerState.playMusicInfo.musicInfo) return
    // force=true：切歌/恢复播放时控制中心可能保留旧会话或为空，强制刷新一次确保
    // MPNowPlayingInfoCenter 拿到当前歌曲元数据，降低 iPad 控制中心不显示的概率。
    void updateMetaData(playerState.musicInfo, playerState.isPlay, playerState.lastLyric, true)
  }
  // const updateCollectStatus = async() => {
  //   // let status = !!playMusicInfo.musicInfo && await checkListExistMusic(LIST_ID_LOVE, playerState.playMusicInfo.musicInfo.id)
  //   // if (buttons.collect == status) return false
  //   // buttons.collect = status
  //   return true
  // }

  const handlePlay = () => {
    // if (buttons.empty) buttons.empty = false
    if (buttons.play) return
    buttons.play = true
    setButtons()
    // iOS 控制中心 / 锁屏需同步播放状态，否则按钮无播放态
    void syncNowPlayingState('play')
  }
  const handlePause = () => {
    // if (buttons.empty) buttons.empty = false
    if (!buttons.play) return
    buttons.play = false
    setButtons()
    // iOS 控制中心 / 锁屏需同步播放状态，否则按钮无播放态
    void syncNowPlayingState('pause')
  }
  const handleStop = () => {
    if (!buttons.play) return
    buttons.play = false
    setButtons()
    void syncNowPlayingState('stop')
  }
  // const handleStop = () => {
  //   // if (playerState.playMusicInfo.musicInfo != null) return
  //   // if (buttons.collect) buttons.collect = false
  //   // buttons.empty = true
  //   setButtons()
  // }
  // const handleSetPlayInfo = () => {
  //   void updateCollectStatus().then(isExist => {
  //     if (isExist) setButtons()
  //   })
  // }
  // const handleSetTaskbarThumbnailClip = (clip) => {
  //   setTaskbarThumbnailClip(clip)
  // }
  // const throttleListChange = throttle(async listIds => {
  //   if (!listIds.includes(loveList.id)) return
  //   if (await updateCollectStatus()) setButtons()
  // })
  // const updateSetting = () => {
  //   const setting = store.getters.setting
  //   buttons.lrc = setting.desktopLyric.enable
  //   buttons.lockLrc = setting.desktopLyric.isLock
  //   setButtons()
  // }
  global.app_event.on('play', handlePlay)
  global.app_event.on('pause', handlePause)
  global.app_event.on('stop', handleStop)
  // global.app_event.on('musicToggled', handleSetPlayInfo)
  // window.app_event.on(eventTaskbarNames.setTaskbarThumbnailClip, handleSetTaskbarThumbnailClip)
  // window.app_event.on('myListMusicUpdate', throttleListChange)

  return async () => {
    // const setting = store.getters.setting
    // buttons.lrc = setting.desktopLyric.enable
    // buttons.lockLrc = setting.desktopLyric.isLock
    // await updateCollectStatus()
    // if (playMusicInfo.musicInfo != null) buttons.empty = false
    setButtons()
  }
}
