import { LIST_IDS } from '@/config/constant'
import listAction from '@/store/list/action'
import listState from '@/store/list/state'
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
export const playOnlineList = async (listId: string, list: LX.Music.MusicInfoOnline[], index: number, isSkipPlay: boolean = false) => {
  const targetMusic = list[index];
  if (targetMusic) {
    console.log('[playOnlineList] === 播放歌曲信息诊断 ===', {
      listId,
      index,
      musicId: targetMusic.id,
      musicName: targetMusic.name,
      musicSource: targetMusic.source,
      musicSongmid: targetMusic.songmid,
      metaSongmid: targetMusic.meta?.songmid,
      metaSongId: targetMusic.meta?.songId,
      metaId: targetMusic.meta?.id,
      metaKeys: targetMusic.meta ? Object.keys(targetMusic.meta) : [],
    });
  }
  
  await overwriteListMusics(LIST_IDS.TEMP, [...list])
  await setTempList(listId, list)
  clearPlayedList()
  setActiveList(LIST_IDS.TEMP)
  if (!isSkipPlay) void playList(LIST_IDS.TEMP, index)
}


/**
 * Overwrite all list data
 * @param data
 */
export const overwriteListFull = async (data: LX.List.ListActionDataOverwrite) => {
  await global.list_event.list_data_overwrite(data)
}

/**
 * Add user list
 */
export const createUserList = async (position: number, listInfos: LX.List.UserListInfo[]) => {
  await global.list_event.list_create(position, listInfos)
}

/**
 * Remove user list and songs in the list
 */
export const removeUserList = async (ids: string[]) => {
  await global.list_event.list_remove(ids)
}

/**
 * Update user list
 */
export const updateUserList = async (listInfos: LX.List.UserListInfo[]) => {
  await global.list_event.list_update(listInfos)
}

/**
 * Batch move user list positions
 */
export const updateUserListPosition = async (position: number, ids: string[]) => {
  await global.list_event.list_update_position(position, ids)
}

/**
 * Batch add songs to list
 */
export const addListMusics = async (
  id: string,
  musicInfos: LX.Music.MusicInfo[],
  addMusicLocationType: LX.AddMusicLocationType
) => {
  await global.list_event.list_music_add(id, musicInfos, addMusicLocationType)
}

/**
 * Batch move songs across lists
 */
export const moveListMusics = async (
  fromId: string,
  toId: string,
  musicInfos: LX.Music.MusicInfo[],
  addMusicLocationType: LX.AddMusicLocationType
) => {
  await global.list_event.list_music_move(fromId, toId, musicInfos, addMusicLocationType)
}

/**
 * Batch delete songs in list
 */
export const removeListMusics = async (listId: string, ids: string[]) => {
  await global.list_event.list_music_remove(listId, ids)
}

/**
 * Batch update songs in list
 */
export const updateListMusics = async (
  infos: Array<{ id: string; musicInfo: LX.Music.MusicInfo }>
) => {
  await global.list_event.list_music_update(infos)
}

/**
 * Batch move positions of songs in list
 */
export const updateListMusicPosition = async (listId: string, position: number, ids: string[]) => {
  await global.list_event.list_music_update_position(listId, position, ids)
}

/**
 * Overwrite songs in list
 */
export const overwriteListMusics = async (listId: string, musicInfos: LX.Music.MusicInfo[]) => {
  await global.list_event.list_music_overwrite(listId, musicInfos)
}

/**
 * Clear songs in list
 */
export const clearListMusics = async (ids: string[]) => {
  await global.list_event.list_music_clear(ids)
}

/**
 * Overwrite a single list
 * @param listInfo
 * @param musics
 */
export const overwriteList = async (
  listInfoFull:
    | LX.List.MyDefaultListInfoFull
    | LX.List.MyLoveListInfoFull
    | LX.List.UserListInfoFull
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
    listInfoFull.list.map((m) => fixNewMusicInfoQuality(m))
  )
}
/**
 * Overwrite a single list
 * @param listInfo
 * @param musics
 */
export const createList = async ({
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
export const setTempList = async (id: string, list: LX.Music.MusicInfoOnline[]) => {
  await overwriteListMusics(LIST_IDS.TEMP, list)
  listAction.setTempListMeta({ id })
}

export const setFetchingListStatus = (id: string, status: boolean) => {
  listAction.setFetchingListStatus(id, status)
}

export { getUserLists, getListMusics } from '@/utils/listManage'
