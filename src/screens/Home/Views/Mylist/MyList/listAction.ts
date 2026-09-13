import {
  getListMusics,
  removeUserList,
} from '@/core/list'
import { confirmDialog, handleReadFile, handleSaveFile, showImportTip, toast } from '@/utils/tools'
import syncSourceList from '@/core/syncSourceList'
import { log } from '@/utils/log'
import { filterFileName, filterMusicList, formatPlayTime2, toNewMusicInfo } from '@/utils'
import { handleImportListPart } from '@/screens/Home/Views/Setting/settings/Backup/actions'
import { type MusicMetadataFull } from '@/utils/localMediaMetadata'
import { type FileType } from '@/utils/fs'

export const handleRemove = (listInfo: LX.List.UserListInfo) => {
  void confirmDialog({
    message: global.i18n.t('list_remove_tip', { name: listInfo.name }),
    confirmButtonText: global.i18n.t('list_remove_tip_button'),
  }).then((isRemove) => {
    if (!isRemove) return
    void removeUserList([listInfo.id])
  })
}

const readListData = async (path: string) => {
  let configData: any
  try {
    configData = await handleReadFile(path)
  } catch (error: any) {
    log.error(error.stack)
    throw error
  }
  let listData: LX.ConfigFile.MyListInfoPart['data']
  switch (configData.type) {
    case 'playListPart':
      listData = configData.data
      listData.list = filterMusicList(listData.list.map((m) => toNewMusicInfo(m)) as LX.Music.MusicInfo[])
      break
    case 'playListPart_v2':
      listData = configData.data
      break
    default:
      showImportTip(configData.type as string)
      return null
  }
  return listData
}

export const handleImport = (path: string, position: number) => {
  toast(global.i18n.t('setting_backup_part_import_list_tip_unzip'))
  void readListData(path)
    .then(async (listData) => {
      if (listData == null) return
      void handleImportListPart(listData, position)
    })
    .catch((err) => {
      log.error(err)
      toast(global.i18n.t('setting_backup_part_import_list_tip_error'))
    })
}

const exportList = async (listInfo: LX.List.MyListInfo, path: string) => {
  const data = JSON.parse(
    JSON.stringify({
      type: 'playListPart_v2',
      data: {
        ...listInfo,
        list: await getListMusics(listInfo.id),
      },
    })
  )
  try {
    await handleSaveFile(`${path}/lx_list_part_${filterFileName(listInfo.name)}.lxmc`, data)
  } catch (error: any) {
    log.error(error.stack)
  }
}

// iOS 导出：写入指定文件并返回其路径（供系统分享面板使用）
export const exportListToFile = async (listInfo: LX.List.MyListInfo, dirPath: string): Promise<string> => {
  const data = JSON.parse(
    JSON.stringify({
      type: 'playListPart_v2',
      data: {
        ...listInfo,
        list: await getListMusics(listInfo.id),
      },
    })
  )
  const fileName = `lx_list_part_${filterFileName(listInfo.name)}.lxmc`
  const filePath = dirPath.endsWith('/') ? `${dirPath}${fileName}` : `${dirPath}/${fileName}`
  try {
    await handleSaveFile(filePath, data)
  } catch (error: any) {
    log.error(error.stack)
    throw error
  }
  return filePath
}
export const handleExport = (listInfo: LX.List.MyListInfo, path: string) => {
  toast(global.i18n.t('setting_backup_part_export_list_tip_zip'))
  exportList(listInfo, path)
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

export const handleSync = (listInfo: LX.List.UserListInfo) => {
  void confirmDialog({
    message: global.i18n.t('list_sync_confirm_tip', { name: listInfo.name }),
    confirmButtonText: global.i18n.t('list_remove_tip_button'),
  }).then((isSync) => {
    if (!isSync) return
    void syncSourceList(listInfo)
      .then(() => {
        toast(global.i18n.t('list_update_success', { name: listInfo.name }))
      })
      .catch(() => {
        toast(global.i18n.t('list_update_error', { name: listInfo.name }))
      })
  })
}

export const buildLocalMusicInfoByFilePath = (file: FileType): LX.Music.MusicInfoLocal => {
  const index = file.name.lastIndexOf('.')
  return {
    id: file.path,
    name: file.name.substring(0, index),
    singer: '',
    source: 'local',
    interval: null,
    meta: {
      albumName: '',
      filePath: file.path,
      songId: file.path,
      picUrl: '',
      ext: file.name.substring(index + 1),
    },
  }
}
export const buildLocalMusicInfo = (
  filePath: string,
  metadata: MusicMetadataFull,
  picUrl?: string | null
): LX.Music.MusicInfoLocal => {
  return {
    id: filePath,
    name: metadata.name,
    singer: metadata.singer,
    source: 'local',
    interval: formatPlayTime2(metadata.interval),
    meta: {
      albumName: metadata.albumName,
      filePath,
      songId: filePath,
      picUrl: picUrl ?? '',
      ext: metadata.ext,
    },
  }
}
