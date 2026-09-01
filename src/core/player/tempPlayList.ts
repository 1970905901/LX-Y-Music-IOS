import playerActions from '@/store/player/action'
import playerState from '@/store/player/state'
import { playNext } from './player'

/**
 * 添加歌曲到稍后播放列表
 * @param list 歌曲列表
 */
export const addTempPlayList = (list: LX.Player.TempPlayListItem[]) => {
  playerActions.addTempPlayList(list)
  if (!playerState.playMusicInfo.musicInfo) void playNext()
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
  void playNext()
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
