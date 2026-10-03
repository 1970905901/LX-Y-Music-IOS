import { getPlayInfo } from '@/utils/data'
import { getListMusics } from '@/core/list'
import { playList, play } from '@/core/player/player'
import playerState from '@/store/player/state'


export default async(setting: LX.AppSetting) => {
  const info = await getPlayInfo()
  global.lx.restorePlayInfo = null
  if (!info?.listId || info.index < 0) return

  const list = await getListMusics(info.listId)
  if (!list[info.index]) return
  global.lx.restorePlayInfo = info

  await playList(info.listId, info.index)

  // 启动软件自动播放：前提是「软件内有暂停的歌曲」——上面已从持久化信息里恢复出一首
  // 歌，且 playList() 只把它加载成暂停态（不出声）。这里再显式校验一次前提，避免
  // 将来播放链路变化（已自动起播 / 无歌可播）时重复播放或空播。
  if (setting['player.startupAutoPlay']) {
    setTimeout(() => {
      if (playerState.isPlay) return
      if (!playerState.playMusicInfo.musicInfo) return
      play()
    })
  }


  // if (!info.list || !info.list[info.index]) {
  //   const info2 = { ...info }
  //   if (info2.list) {
  //     info2.music = info2.list[info2.index]?.name
  //     info2.list = info2.list.length
  //   }
  //   toast('恢复播放数据失败，请去错误日志查看', 'long')
  //   log.warn('Restore Play Info failed: ', JSON.stringify(info2, null, 2))

  //   return
  // }

  // let setting = store.getState().common.setting
  // global.restorePlayInfo = {
  //   info,
  //   startupAutoPlay: setting.startupAutoPlay,
  // }

  // store.dispatch(playerAction.setList({
  //   list: {
  //     list: info.list,
  //     id: info.listId,
  //   },
  //   index: info.index,
  // }))
}
