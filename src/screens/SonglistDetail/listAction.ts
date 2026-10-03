import { createList, playTempList, setTempList } from '@/core/list'
import { getListDetail, getListDetailAll } from '@/core/songlist'
import listState from '@/store/list/state'
import syncSourceList from '@/core/syncSourceList'
import { confirmDialog, toMD5, toast } from '@/utils/tools'
import { type Source } from '@/store/songlist/state'

const getListId = (id: string, source: LX.OnlineSource) => `${source}__${id}`

/**
 * 从歌单里点一首歌开始播放。
 *
 * 两个「点了没反应」的历史根因（QQ 2000 首歌单实锤）：
 *  ① 旧实现 await setTempList(...) 之后才 playList —— setTempList 要等整张列表落盘
 *     （2000 首 ≈ 1~2MB）才 resolve，点歌后要等几百 ms~数秒才开始播放；
 *  ② 传进来的下标若超出 list 长度（搜索过滤 / 后台补全期间 store 落后于界面），
 *     getList(listId)[index] 是 undefined，静默什么都没播。
 *
 */
export const handlePlay = async(
  id: string,
  source: Source,
  list?: LX.Music.MusicInfoOnline[],
  index = 0,
) => {
  const listId = getListId(id, source)
  let isPlayingList = false
  if (!list?.length) {
    try {
      list = (await getListDetail(id, source, 1)).list
    } catch (err) {
      console.error('[handlePlay] 获取歌单详情失败:', err)
      toast('获取歌单失败，请稍后重试')
      return
    }
  }
  if (list?.length) {
    // 下标越界（搜索过滤后的显示下标、后台补全期间 store 落后于界面等）时会取到
    // undefined —— 表现就是「点了歌没反应」。这里兜底到第 1 首，保证点击一定有反馈。
    const startIndex = Number.isInteger(index) && index >= 0 && index < list.length ? index : 0
    // 立刻开播，不等整表落盘：playTempList 内部同步写内存 → playList，
    // 落盘与 myListMusicUpdate 在后台继续（见 core/list.ts 注释）。
    playTempList(listId, [...list], startIndex)
    isPlayingList = true
  }
  try {
    const fullList = await getListDetailAll(source, id)
    if (!fullList.length) return
    if (isPlayingList) {
      if (listState.tempListMeta.id == listId && fullList.length > (list?.length ?? 0)) {
        console.log(`[handlePlay] 完整歌单已加载：${fullList.length} 首，更新临时列表`)
        await setTempList(listId, [...fullList])
      }
    } else {
      // 同一条「点了没反应」的坑：全量拉到后仍要立刻开播，不等整表落盘
      const startIndex = Number.isInteger(index) && index >= 0 && index < fullList.length ? index : 0
      playTempList(listId, [...fullList], startIndex)
    }
  } catch (err) {
    console.error('[handlePlay] 获取完整歌单失败:', err)
    if (!isPlayingList) {
      toast('获取歌单失败，请稍后重试')
    }
  }
}

export const handleCollect = async(id: string, source: Source, name: string) => {
  const listId = getListId(id, source)

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

  // 收藏需要拉取完整歌单（逐页请求），耗时可能较长：
  // 点击后立即提示进行中，结束时明确反馈成功/失败，避免长时间无响应的观感
  toast('收藏中...')
  try {
    const list = await getListDetailAll(source, id)
    await createList({
      name,
      id: `${source}_${toMD5(listId)}`,
      list,
      source,
      sourceListId: id,
    })
    toast(global.i18n.t('collect_success'))
  } catch (err: any) {
    toast(`收藏失败：${err?.message || '请稍后重试'}`)
  }
}
