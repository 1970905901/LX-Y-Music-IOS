import { createList, setTempList } from '@/core/list'
import { playList } from '@/core/player/player'
import { getListDetail, getListDetailAll } from '@/core/leaderboard'
import { LIST_IDS } from '@/config/constant'
import listState from '@/store/list/state'
import syncSourceList from '@/core/syncSourceList'
import { confirmDialog, toMD5, toast } from '@/utils/tools'

const getListId = (id: string) => `board__${id}`

/**
 * 榜单点歌：把榜单写进临时列表并从点的那一首开始播。
 *
 * 必须保证「点了一定有响应」：原先直接用入参 index 去 playList，
 * 而榜单切换/刷新期间传进来的 list 与 index 可能不同源（快照为空或是第 1 页、行下标来自另一份数据），
 * index 越界时播放链路会静默返回（找不到歌曲就不播）→ 表现为「点了没反应」，正好是偶发。
 * 现在：以「点的那一首」的身份定位下标、做边界收敛，列表/请求失败时给出提示。
 */
export const handlePlay = async(id: string, list?: LX.Music.MusicInfoOnline[], index = 0) => {
  const listId = getListId(id)
  const targetMusic = list?.[index]
  let currentList: LX.Music.MusicInfoOnline[] | undefined = list?.length ? list : undefined
  if (!currentList) {
    try {
      currentList = (await getListDetail(id, 1)).list
    } catch (err) {
      currentList = undefined
    }
  }
  if (!currentList?.length) {
    // 分页接口拿不到时再尝试整榜，避免一次网络失败就「点了没反应」
    try {
      currentList = await getListDetailAll(id)
    } catch (err) {
      currentList = undefined
    }
  }
  if (!currentList?.length) {
    toast('榜单加载失败，请重试')
    return
  }

  // 以点中的歌曲身份定位下标；定位不到再退回原始下标并收敛到合法范围
  let playIndex = targetMusic ? currentList.findIndex((m) => m.id == targetMusic.id) : -1
  if (playIndex < 0) playIndex = Math.min(Math.max(index, 0), currentList.length - 1)

  await setTempList(listId, [...currentList])
  // playList 内部任何一步失败（播放引擎异常等）都会以 Promise 拒绝收场且无 UI 反馈，
  // 这里补兜底提示，避免表现为「点了没反应」。
  void playList(LIST_IDS.TEMP, playIndex).catch((err: any) => {
    console.log('[Leaderboard handlePlay] playList failed:', err?.message)
    toast('播放失败，请重试')
  })

  // 完整榜单拉全后补全临时列表；正在播的那首按歌曲身份维护位置，不受列表替换影响
  let fullList: LX.Music.MusicInfoOnline[] = []
  try {
    fullList = await getListDetailAll(id)
  } catch (err) {
    fullList = []
  }
  if (fullList.length > currentList.length && listState.tempListMeta.id == listId) {
    console.log(`[Leaderboard handlePlay] 完整榜单已加载：${fullList.length} 首，更新临时列表`)
    await setTempList(listId, [...fullList])
  }
}

export const handleCollect = async(id: string, name: string, source: LX.OnlineSource) => {
  const listId = getListId(id)
  const targetList = listState.userList.find((l) => l.sourceListId == listId)
  if (targetList) {
    const confirm = await confirmDialog({
      message: global.i18n.t('duplicate_list_tip', { name: targetList.name }),
      cancelButtonText: global.i18n.t('list_import_part_button_cancel'),
      confirmButtonText: global.i18n.t('confirm_button_text'),
    })
    if (!confirm) return
    void syncSourceList(targetList)
    return
  }

  const list = await getListDetailAll(id)
  await createList({
    name,
    id: `${source}_${toMD5(listId)}`,
    list,
    source,
    sourceListId: listId,
  })
  toast(global.i18n.t('collect_success'))
}
