import {
  play as lrcPlay,
  setLyric as lrcSetLyric,
  pause as lrcPause,
  onLyricPlay as onPluginLyricPlay,
  setPlaybackRate as lrcSetPlaybackRate,
  toggleTranslation as lrcToggleTranslation,
  toggleRoma as lrcToggleRoma,
  init as lrcInit,
} from '@/plugins/lyric'
import { getPosition } from '@/plugins/player/utils'
import playerState from '@/store/player/state'
// import settingState from '@/store/setting/state'

const getReliableLyricPosition = async() => {
  const progressPosition = Math.max(playerState.progress.nowPlayTime, 0)
  const playerPosition = await getPosition().catch(() => progressPosition)

  // Right after switching songs, progress belongs to the new song and is reset
  // immediately, while native/player position may still transiently report the
  // previous song. In that window, always trust the new track progress.
  if (progressPosition <= 1) {
    if (playerPosition > 5) return progressPosition
    return Math.max(progressPosition, 0)
  }
  // 对齐上游 core/lyric.play()：lrc.play(getCurrentTime()) 无条件信任引擎当前时间。
  // 此前的「|引擎-进度|>2s 时偏好进度」分支会拿 seek 窗口期的 store 目标值覆盖引擎
  // 真实位置，属于旧轮询架构的补丁；重锚由引擎 playing 事件驱动时引擎位置即真相。
  if (playerPosition <= 0) return progressPosition
  return playerPosition
}

/**
 * init lyric
 */
export const init = async() => {
  return lrcInit()
}

/**
 * set lyric
 * @param lyric lyric str
 * @param translation lyric translation
 */
const handleSetLyric = async(lyric: string, translation = '', romalrc = '', lxLyric = '') => {
  // 本项目逐字歌词走独立参数：主歌词始终是标准 LRC，lxlrc 由歌词插件单独解析为
  // 逐字时间轴。参考分支把 lxlrc当作主歌词（它用 LxLyricPlayer 直接播），
  // 若照搬会让 lrc-file-parser 解析出带 <...> 标记的行，逐字与行文本都会错乱。
  lrcSetLyric(lyric, translation, romalrc, lxLyric)
}

/**
 * play lyric
 * @param time play time
 */
export const handlePlay = (time: number) => {
  lrcPlay(time)
}

/**
 * pause lyric
 */
export const pause = () => {
  lrcPause()
}

export const onLyricPlay = onPluginLyricPlay

// 行级同步自愈探针（透传插件层实现，消费方为 playProgress 的慢校准/快路径）
export { verifyLyricLineSync } from '@/plugins/lyric'

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
export const setPlaybackRate = async(playbackRate: number) => {
  lrcSetPlaybackRate(playbackRate)
  if (playerState.isPlay) {
    setTimeout(() => {
      void getReliableLyricPosition().then((position) => {
        handlePlay(position * 1000)
      })
    })
  }
}

/**
 * toggle show translation
 * @param isShowTranslation is show translation
 */
export const toggleTranslation = async(isShowTranslation: boolean) => {
  lrcToggleTranslation(isShowTranslation)
  if (playerState.isPlay) play()
}

/**
 * toggle show roma lyric
 * @param isShowLyricRoma is show roma lyric
 */
export const toggleRoma = async(isShowLyricRoma: boolean) => {
  lrcToggleRoma(isShowLyricRoma)
  if (playerState.isPlay) play()
}

export const play = () => {
  void getReliableLyricPosition().then((position) => {
    handlePlay(position * 1000)
  })
}

export const seek = (time: number) => {
  handlePlay(time * 1000)
  if (!playerState.isPlay) {
    setTimeout(() => {
      pause()
    })
  }
}


export const setLyric = async() => {
  if (!playerState.musicInfo.id) return
  const musicInfo = playerState.musicInfo
  const source = (musicInfo as { source?: string }).source ?? ''
  if (musicInfo.lrc) {
    let tlrc = ''
    let rlrc = ''
    if (musicInfo.tlrc) tlrc = musicInfo.tlrc
    if (musicInfo.rlrc) rlrc = musicInfo.rlrc
    let lxlrc = ''
    // 咪咕/汽水的 lxlrc 格式异常，不进入逐字解析
    if (musicInfo.lxlrc && source != 'mg' && source != 'qs') {
      lxlrc = musicInfo.lxlrc
    }
    await handleSetLyric(musicInfo.lrc, tlrc, rlrc, lxlrc)
  }

  if (playerState.isPlay) play()
}
