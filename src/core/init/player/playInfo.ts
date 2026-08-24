import { getPlayInfo } from '@/utils/data'
import { getListMusics } from '@/core/list'
import { playList, play } from '@/core/player/player'
import {LIST_IDS} from "@/config/constant.ts"
import listAction from '@/store/list/action'

export default async (setting: LX.AppSetting) => {
  const info = await getPlayInfo()
  global.lx.restorePlayInfo = null
  if (!info?.listId || info.index < 0) return

  if (info.listId === LIST_IDS.TEMP && info.tempMeta) {
    listAction.setTempListMeta(info.tempMeta)
  }
  const list = await getListMusics(info.listId)
  if (!list[info.index]) return
  global.lx.restorePlayInfo = info

  await playList(info.listId, info.index)

  if (setting['player.startupAutoPlay']) setTimeout(play)
}
