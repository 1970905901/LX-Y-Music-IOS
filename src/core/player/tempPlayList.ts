import playerActions from '@/store/player/action'
import playerState from '@/store/player/state'

// 动态导入 player.ts，避免与 player.ts 形成循环依赖。
// player.ts 会静态导入本模块；如果这里再静态导入 playNext，
// 模块加载时 playNext 会是 undefined，导致调用时抛 "undefined is not a function"。
const runPlayNext = () => {
  void import('./player').then(({ playNext }) => {
    void playNext()
  })
}

/**
 * 添加歌曲到稍后播放列表
 * @param list 歌曲列表
 */
export const addTempPlayList = (list: LX.Player.TempPlayListItem[]) => {
  playerActions.addTempPlayList(list)
  if (!playerState.playMusicInfo.musicInfo) runPlayNext()
}

/**
 * 播放临时列表中指定位置的歌曲
 * 将该位置及之后的歌曲保留在队列中，然后触发 playNext 播放第一首。
 */
export const playTempListAt = (index: number) => {
  const list = playerState.tempPlayList
  if (index < 0 || index >= list.length) return
  const remaining = list.slice(index).map(({ listId, musicInfo }) => ({ listId, musicInfo }))
  playerActions.clearTempPlayeList()
  playerActions.addTempPlayList(remaining)
  runPlayNext()
}
/**
 * 从稍后播放列表移除歌曲
 * @param index 歌曲位置
 */
export const removeTempPlayList = (index: number) => {
  playerActions.removeTempPlayList(index)
}
/**
 * 清空稍后播放列表
 */
export const clearTempPlayeList = () => {
  playerActions.clearTempPlayeList()
}
