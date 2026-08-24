import { LIST_IDS } from '@/config/constant'
import {
  createList,
  getListMusics,
  overwriteList,
  overwriteListFull,
  overwriteListMusics,
} from '@/core/list'
import { updateSetting } from '@/core/common'
import { filterSensitiveSettingsForSync, getAllDataForSync } from '@/core/sync/syncHelpers'
import { overwriteUserApis } from '@/core/userApi'
import { filterMusicList, fixNewMusicInfoQuality, toNewMusicInfo } from '@/utils'
import { savePlayHistory } from '@/utils/data'
import { normalizeRemoteSyncedDownloadTasks, saveDownloadTasks } from '@/utils/data/download'
import { log } from '@/utils/log'
import { confirmDialog, handleReadFile, handleSaveFile, showImportTip, toast } from '@/utils/tools'
import listState from '@/store/list/state'
import downloadState from '@/store/download/state'

const getAllLists = async () => {
  const lists = []
  lists.push(
    await getListMusics(listState.defaultList.id).then((musics) => ({
      ...listState.defaultList,
      list: musics,
    }))
  )
  lists.push(
    await getListMusics(listState.loveList.id).then((musics) => ({
      ...listState.loveList,
      list: musics,
    }))
  )

  for await (const list of listState.userList) {
    lists.push(await getListMusics(list.id).then((musics) => ({ ...list, list: musics })))
  }

  return lists
}
const importOldListData = async (lists: any[]) => {
  const allLists = await getAllLists()
  for (const list of lists) {
    try {
      const targetList = allLists.find((l) => l.id == list.id)
      if (targetList) {
        targetList.list = filterMusicList((list.list as any[]).map((m) => toNewMusicInfo(m)))
      } else {
        const listInfo = {
          name: list.name,
          id: list.id,
          list: filterMusicList((list.list as any[]).map((m) => toNewMusicInfo(m))),
          source: list.source,
          sourceListId: list.sourceListId,
          locationUpdateTime: list.locationUpdateTime ?? null,
        }
        allLists.push(listInfo as LX.List.UserListInfoFull)
      }
    } catch (err) {
      console.log(err)
    }
  }
  const defaultList = allLists.shift()!.list
  const loveList = allLists.shift()!.list
  await overwriteListFull({
    defaultList,
    loveList,
    userList: allLists as LX.List.UserListInfoFull[],
  })
}
const importNewListData = async (
  lists: Array<
    LX.List.MyDefaultListInfoFull | LX.List.MyLoveListInfoFull | LX.List.UserListInfoFull
  >
) => {
  const allLists = await getAllLists()
  for (const list of lists) {
    try {
      const targetList = allLists.find((l) => l.id == list.id)
      if (targetList) {
        targetList.list = filterMusicList(list.list).map((m) => fixNewMusicInfoQuality(m))
      } else {
        const data = {
          name: list.name,
          id: list.id,
          list: filterMusicList(list.list).map((m) => fixNewMusicInfoQuality(m)),
          source: (list as LX.List.UserListInfoFull).source,
          sourceListId: (list as LX.List.UserListInfoFull).sourceListId,
          locationUpdateTime: (list as LX.List.UserListInfoFull).locationUpdateTime ?? null,
        }
        allLists.push(data as LX.List.UserListInfoFull)
      }
    } catch (err) {
      console.log(err)
    }
  }
  const defaultList = allLists.shift()!.list
  const loveList = allLists.shift()!.list
  await overwriteListFull({
    defaultList,
    loveList,
    userList: allLists as LX.List.UserListInfoFull[],
  })
}

/**
 * Import a single list
 * @param listData
 * @param position
 * @returns
 */
export const handleImportListPart = async (
  listData: LX.ConfigFile.MyListInfoPart['data'],
  position: number = listState.userList.length
) => {
  const targetList = listState.allList.find((l) => l.id === listData.id)
  if (targetList) {
    const confirm = await confirmDialog({
      message: global.i18n.t('list_import_part_confirm', {
        importName: listData.name,
        localName: targetList.name,
      }),
      cancelButtonText: global.i18n.t('list_import_part_button_cancel'),
      confirmButtonText: global.i18n.t('list_import_part_button_confirm'),
      bgClose: false,
    })
    if (confirm) {
      listData.name = targetList.name
      void overwriteList(listData)
        .then(() => {
          toast(global.i18n.t('setting_backup_part_import_list_tip_success'))
        })
        .catch((err) => {
          log.error(err)
          toast(global.i18n.t('setting_backup_part_import_list_tip_error'))
        })
      return
    }
    listData.id += `__${Date.now()}`
  }
  const userList = listData as LX.List.UserListInfoFull
  void createList({
    name: userList.name,
    id: userList.id,
    list: userList.list,
    source: userList.source,
    sourceListId: userList.sourceListId,
    position: Math.max(position, -1),
  })
    .then(() => {
      toast(global.i18n.t('setting_backup_part_import_list_tip_success'))
    })
    .catch((err) => {
      log.error(err)
      toast(global.i18n.t('setting_backup_part_import_list_tip_error'))
    })
}

const showConfirm = async () => {
  return confirmDialog({
    message: global.i18n.t('list_import_part_confirm_tip'),
    cancelButtonText: global.i18n.t('dialog_cancel'),
    confirmButtonText: global.i18n.t('confirm_button_text'),
    bgClose: false,
  })
}

const importBackupData = async (data: LX.ConfigFile.AllDataV3['data']) => {
  if (!(await showConfirm())) return true

  if (data.lists) await overwriteListFull(data.lists)

  if (Array.isArray(data.playHistory)) {
    await savePlayHistory(data.playHistory)
    global.app_event.playHistoryUpdated()
  }

  if (Array.isArray(data.downloadTasks)) {
    const tasks = normalizeRemoteSyncedDownloadTasks(data.downloadTasks)
    downloadState.tasks = tasks
    await saveDownloadTasks(tasks)
    global.app_event.download_list_changed()
  }

  if (data.settings) updateSetting(filterSensitiveSettingsForSync(data.settings))

  if (data.userApis) await overwriteUserApis(data.userApis)
  
  toast('部分设置需要重启后生效')
}

const importPlayList = async (path: string) => {
  let configData: any
  try {
    configData = await handleReadFile(path)
  } catch (error: any) {
    log.error(error.stack)
    throw error
  }

  switch (configData.type) {
    case 'defautlList':
      if (!(await showConfirm())) return true
      await overwriteListMusics(
        LIST_IDS.DEFAULT,
        filterMusicList(
          (configData.data as LX.List.MyDefaultListInfoFull).list.map((m) => toNewMusicInfo(m))
        )
      )
      break
    case 'playList':
      if (!(await showConfirm())) return true
      await importOldListData(configData.data)
      break
    case 'playList_v2':
      if (!(await showConfirm())) return true
      await importNewListData(configData.data)
      break
    case 'allData':
      if (!(await showConfirm())) return true
      if (configData.defaultList)
        await overwriteListMusics(
          LIST_IDS.DEFAULT,
          filterMusicList(
            (configData.defaultList as LX.List.MyDefaultListInfoFull).list.map((m) =>
              toNewMusicInfo(m)
            )
          )
        )
      else await importOldListData(configData.playList)
      break
    case 'allData_v2':
      if (!(await showConfirm())) return true
      await importNewListData(configData.playList)
      break
    case 'allData_v3':
      return importBackupData(configData.data as LX.ConfigFile.AllDataV3['data'])
    case 'playListPart':
      configData.data.list = filterMusicList(
        (configData.data as LX.ConfigFile.MyListInfoPart['data']).list.map((m) => toNewMusicInfo(m))
      )

      void handleImportListPart(configData.data)
      return true
    case 'playListPart_v2':
      configData.data.list = filterMusicList(
        (configData.data as LX.ConfigFile.MyListInfoPart['data']).list
      ).map((m) => fixNewMusicInfoQuality(m))

      void handleImportListPart(configData.data)
      return true

    default:
      showImportTip(configData.type)
  }
}

export const handleImportList = (path: string) => {
  console.log(path)
  toast(global.i18n.t('setting_backup_part_import_list_tip_unzip'))
  void importPlayList(path)
    .then((skipTip) => {
      if (skipTip) return
      toast(global.i18n.t('setting_backup_part_import_list_tip_success'))
    })
    .catch((err) => {
      log.error(err)
      toast(global.i18n.t('setting_backup_part_import_list_tip_error'))
    })
}

const exportAllList = async (path: string) => {
  const data: LX.ConfigFile.AllDataV3 = JSON.parse(
    JSON.stringify({
      type: 'allData_v3',
      data: await getAllDataForSync(),
    })
  )

  try {
    await handleSaveFile(path + '/lx_backup.lxmc', data)
  } catch (error: any) {
    log.error(error.stack)
    throw error
  }
}
export const handleExportList = (path: string) => {
  toast(global.i18n.t('setting_backup_part_export_list_tip_zip'))
  void exportAllList(path)
    .then(() => {
      toast(global.i18n.t('setting_backup_part_export_list_tip_success'))
    })
    .catch((err: any) => {
      log.error(err.message)
      toast(
        global.i18n.t('setting_backup_part_export_list_tip_failed') + ': ' + (err.message as string)
      )
    })
}
