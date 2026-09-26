import { LIST_IDS } from '@/config/constant'
import listAction from '@/store/list/action'
import listState from '@/store/list/state'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { fixNewMusicInfoQuality } from '@/utils'
import { saveListPrevSelectId } from '@/utils/data'
import { playList } from '@/core/player/player'
import { clearPlayedList } from '@/core/player/playedList'

/**
 * Play a temporary online song list
 * @param listId Unique identifier for the list, used to distinguish different temporary lists
 * @param list Array of songs to play
 * @param index Index of the song to start playing
 */
export const playOnlineList = async(listId: string, list: LX.Music.MusicInfoOnline[], index: number, isSkipPlay: boolean = false) => {
  const targetMusic = list[index]
  if (targetMusic) {
    console.log('[playOnlineList] === 播放歌曲信息诊断 ===', {
      listId,
      index,
      musicId: targetMusic.id,
      musicName: targetMusic.name,
      musicSource: targetMusic.source,
      musicSongmid: (targetMusic as any).songmid,
      metaSongmid: (targetMusic.meta as any)?.songmid,
      metaSongId: targetMusic.meta?.songId,
      metaId: (targetMusic.meta as any)?.id,
      metaKeys: targetMusic.meta ? Object.keys(targetMusic.meta) : [],
    })
  }

  await overwriteListMusics(LIST_IDS.TEMP, [...list])
  await setTempList(listId, list)
  clearPlayedList()
  setActiveList(LIST_IDS.TEMP)
  if (!isSkipPlay) void playList(LIST_IDS.TEMP, index)
}

/**
 * 播放一个「可能只加载了一部分」的在线列表，并在后台把临时列表补齐为完整列表。
 *
 * 背景：详情类页面的歌曲列表是分页加载的（歌手详情每页 100 首），页面上只有已加载的
 * 那部分歌；直接把已加载部分写进临时列表，用户看到的「播放全部」就只有前 N 首。
 * 这里先用已有数据立即开播（不阻塞交互），随后调用 loadAll 拉完整列表，若确实更长
 * 且期间用户没有切到别的列表播放，就整体替换临时列表（当前播放歌曲按 id 在新列表里
 * 位置不变，播放下标由 watchList 的 updatePlayIndex 自动重算）。
 *
 * @param listId 临时列表的来源标识（用于判断期间是否切走了）
 * @param curList 页面上已加载的歌曲
 * @param index 从第几首开始播
 * @param loadAll 拉取完整列表；失败或为空时返回 null/空数组，静默跳过补齐（不影响已开始的播放）
 */
export const playOnlineListEnsureAll = async(
  listId: string,
  curList: LX.Music.MusicInfoOnline[],
  index: number,
  loadAll: () => Promise<LX.Music.MusicInfoOnline[] | null>,
) => {
  await playOnlineList(listId, curList, index)
  try {
    const fullList = await loadAll()
    if (!fullList?.length || fullList.length <= curList.length) return
    // 期间用户可能已经点了别的列表的播放全部：只补齐仍是同一个临时列表的情况
    if (listState.tempListMeta.id !== listId) return
    const playingId = playerState.playMusicInfo.musicInfo?.id
    // 完整列表里必须还包含当前播放的歌曲，否则替换后 watchList 会判定“歌曲被移除”而自动切歌
    if (playingId && !fullList.some(m => m.id === playingId)) return
    await setTempList(listId, [...fullList])
  } catch { /* 补齐失败不影响已开始的播放 */ }
}



/**
 * Overwrite all list data
 * @param data
 */
export const overwriteListFull = async(data: LX.List.ListActionDataOverwrite) => {
  await global.list_event.list_data_overwrite(data)
}

/**
 * Add user list
 */
export const createUserList = async(position: number, listInfos: LX.List.UserListInfo[]) => {
  await global.list_event.list_create(position, listInfos)
}

/**
 * Remove user list and songs in the list
 */
export const removeUserList = async(ids: string[]) => {
  await global.list_event.list_remove(ids)
}

/**
 * Update user list
 */
export const updateUserList = async(listInfos: LX.List.UserListInfo[]) => {
  await global.list_event.list_update(listInfos)
}

/**
 * Batch move user list positions
 */
export const updateUserListPosition = async(position: number, ids: string[]) => {
  await global.list_event.list_update_position(position, ids)
}

/**
 * Batch add songs to list
 */
export const addListMusics = async(
  id: string,
  musicInfos: LX.Music.MusicInfo[],
  addMusicLocationType: LX.AddMusicLocationType,
) => {
  await global.list_event.list_music_add(id, musicInfos, addMusicLocationType)
}

/**
 * Batch move songs across lists
 */
export const moveListMusics = async(
  fromId: string,
  toId: string,
  musicInfos: LX.Music.MusicInfo[],
  addMusicLocationType: LX.AddMusicLocationType,
) => {
  await global.list_event.list_music_move(fromId, toId, musicInfos, addMusicLocationType)
}

/**
 * Batch delete songs in list
 */
export const removeListMusics = async(listId: string, ids: string[]) => {
  await global.list_event.list_music_remove(listId, ids)
}

/**
 * Batch update songs in list
 */
export const updateListMusics = async(
  infos: Array<{ id: string, musicInfo: LX.Music.MusicInfo }>,
) => {
  await global.list_event.list_music_update(infos)
}

/**
 * Batch move positions of songs in list
 */
export const updateListMusicPosition = async(listId: string, position: number, ids: string[]) => {
  await global.list_event.list_music_update_position(listId, position, ids)
}

/**
 * Overwrite songs in list
 */
export const overwriteListMusics = async(listId: string, musicInfos: LX.Music.MusicInfo[]) => {
  await global.list_event.list_music_overwrite(listId, musicInfos)
}

/**
 * Clear songs in list
 */
export const clearListMusics = async(ids: string[]) => {
  await global.list_event.list_music_clear(ids)
}

/**
 * Overwrite a single list
 * @param listInfo
 * @param musics
 */
export const overwriteList = async(
  listInfoFull:
  | LX.List.MyDefaultListInfoFull
  | LX.List.MyLoveListInfoFull
  | LX.List.UserListInfoFull,
) => {
  let userListInfo
  switch (listInfoFull.id) {
    case LIST_IDS.DEFAULT:
    case LIST_IDS.LOVE:
      break

    default:
      userListInfo = listInfoFull as LX.List.UserListInfo
      await updateUserList([
        {
          name: userListInfo.name,
          id: userListInfo.id,
          source: userListInfo.source,
          sourceListId: userListInfo.sourceListId,
          locationUpdateTime: userListInfo.locationUpdateTime,
        },
      ])
      break
  }
  await overwriteListMusics(
    listInfoFull.id,
    listInfoFull.list.map((m) => fixNewMusicInfoQuality(m)),
  )
}
/**
 * Overwrite a single list
 * @param listInfo
 * @param musics
 */
export const createList = async({
  name,
  id = `userlist_${Date.now()}`,
  list = [],
  source,
  sourceListId,
  position = -1,
}: {
  name?: string
  id?: string
  list?: LX.Music.MusicInfo[]
  source?: LX.OnlineSource
  sourceListId?: string
  position?: number
}) => {
  await createUserList(position < 0 ? listState.userList.length : position, [
    {
      id,
      name: name ?? 'list',
      source,
      sourceListId,
      locationUpdateTime: position < 0 ? null : Date.now(),
    },
  ])
  if (list) await addListMusics(id, list, settingState.setting['list.addMusicLocationType'])
}

/**
 * Set the currently active song list
 * @param id
 */
export const setActiveList = (id: string) => {
  if (listState.activeListId == id) return
  listAction.setActiveList(id)
  saveListPrevSelectId(id)
}

/**
 * Set song list
 */
export const setUserList = (lists: LX.List.UserListInfo[]) => {
  listAction.setUserLists(lists)
}

/**
 * Set songs in temporary list
 * @param id
 * @param list
 */
export const setTempList = async(id: string, list: LX.Music.MusicInfoOnline[]) => {
  await overwriteListMusics(LIST_IDS.TEMP, list)
  listAction.setTempListMeta({ id })
}

export const setFetchingListStatus = (id: string, status: boolean) => {
  listAction.setFetchingListStatus(id, status)
}

export { getUserLists, getListMusics } from '@/utils/listManage'
