import {
  syncToTime as lrcSyncToTime,
  setLyric as lrcSetLyric,
  pause as lrcPause,
  setPlaybackRate as lrcSetPlaybackRate,
  toggleTranslation as lrcToggleTranslation,
  toggleRoma as lrcToggleRoma,
  init as lrcInit,
} from '@/plugins/lyric'
import {
  playDesktopLyric,
  setDesktopLyric,
  pauseDesktopLyric,
  setDesktopLyricPlaybackRate,
  toggleDesktopLyricTranslation,
  toggleDesktopLyricRoma,
} from '@/core/desktopLyric'
import { getPosition } from '@/plugins/player'
import playerState from '@/store/player/state'
// import settingState from '@/store/setting/state'

/**
 * init lyric
 */
export const init = async () => {
  return lrcInit()
}

/**
 * set lyric
 * @param lyric lyric str
 * @param translation lyric translation
 * @param lxLyric 逐字歌词（lxlyric），有则启用逐字高亮
 */
const handleSetLyric = async (lyric: string, translation = '', romalrc = '', lxLyric = '') => {
  lrcSetLyric(lyric, translation, romalrc, lxLyric)
  await setDesktopLyric(lyric, translation, romalrc)
}

/**
 * play lyric
 * @param time play time
 */
export const handlePlay = (time: number) => {
  lrcSyncToTime(time, true)
  void playDesktopLyric(time)
}

/**
 * pause lyric
 */
export const pause = () => {
  lrcPause()
  void pauseDesktopLyric()
}

/**
 * stop lyric
 */
export const stop = () => {
  void handleSetLyric('')
}

/**
 * set playback rate
 * @param playbackRate playback rate
 */
export const setPlaybackRate = async (playbackRate: number) => {
  lrcSetPlaybackRate(playbackRate)
  await setDesktopLyricPlaybackRate(playbackRate)
  if (playerState.isPlay) {
    setTimeout(() => {
      void getPosition().then((position) => {
        handlePlay(position * 1000)
      })
    })
  }
}

/**
 * toggle show translation
 * @param isShowTranslation is show translation
 */
export const toggleTranslation = async (isShowTranslation: boolean) => {
  lrcToggleTranslation(isShowTranslation)
  await toggleDesktopLyricTranslation(isShowTranslation)
  if (playerState.isPlay) play()
}

/**
 * toggle show roma lyric
 * @param isShowLyricRoma is show roma lyric
 */
export const toggleRoma = async (isShowLyricRoma: boolean) => {
  lrcToggleRoma(isShowLyricRoma)
  await toggleDesktopLyricRoma(isShowLyricRoma)
  if (playerState.isPlay) play()
}

export const play = () => {
  void getPosition().then((position) => {
    handlePlay(position * 1000)
  })
}

export const setLyric = async () => {
  if (!playerState.musicInfo.id) return
  if (playerState.musicInfo.lrc) {
    let tlrc = ''
    let rlrc = ''
    if (playerState.musicInfo.tlrc) tlrc = playerState.musicInfo.tlrc
    if (playerState.musicInfo.rlrc) rlrc = playerState.musicInfo.rlrc
    let lxlrc = ''
    // 逐字歌词（卡拉OK）：除咪咕(mg)与汽水(qs，跨平台播放)外，其余音源均启用
    const source = (playerState.musicInfo as { source?: string }).source
    if (playerState.musicInfo.lxlrc && source != 'mg' && source != 'qs') {
      lxlrc = playerState.musicInfo.lxlrc
    }
    await handleSetLyric(playerState.musicInfo.lrc, tlrc, rlrc, lxlrc)
  }

  if (playerState.isPlay) play()
}
