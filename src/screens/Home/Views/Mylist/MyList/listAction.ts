import {
  addListMusics,
  getListMusics,
  removeListMusics,
  removeUserList,
  setFetchingListStatus,
  updateListMusics,
} from '@/core/list'
import { confirmDialog, handleReadFile, handleSaveFile, showImportTip, toast } from '@/utils/tools'
import syncSourceList from '@/core/syncSourceList'
import { log } from '@/utils/log'
import { filterFileName, filterMusicList, formatPlayTime2, toNewMusicInfo } from '@/utils'
import { handleImportListPart } from '@/screens/Home/Views/Setting/settings/Backup/actions'
import {readMetadata, scanAudioFiles, type MusicMetadataFull, readPic} from '@/utils/localMediaMetadata'
import settingState from '@/store/setting/state'
import BackgroundTimer from 'react-native-background-timer'
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
      listData.list = filterMusicList(listData.list.map((m) => toNewMusicInfo(m)))
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
const createLocalMusicInfos = async (
  filePaths: string[],
  errorPath: string[]
): Promise<LX.Music.MusicInfoLocal[]> => {
  const list: LX.Music.MusicInfoLocal[] = []
  filePaths = [...filePaths]
  while (filePaths.length) {
    const tasks = [
      filePaths.shift(),
      filePaths.shift(),
      filePaths.shift(),
      filePaths.shift(),
      filePaths.shift(),
    ].filter(Boolean) as string[]

    await Promise.all(
      tasks.map(async (path) => {
        try {
          const info = await readMetadata(path)
          const picPath = await readPic(path).catch(() => null)
          return { path, info, picPath, error: null }
        } catch (err) {
          console.error(`[本地导入] 读取元数据失败: ${path}`, err)
          return { path, info: null, picPath: null, error: err.message || '未知错误' }
        }
      }),
    ).then((res) => {
      for (const { path, info, picPath, error } of res) {
        if (!info) {
          console.log(`[本地导入] 读取失败: ${path.split('/').at(-1)} - ${error || 'readMetadata返回null'}`)
          errorPath.push(path)
          continue
        }
        const musicInfo = buildLocalMusicInfo(path, info, picPath)
        list.push(musicInfo)
      }
    })
  }
  return list
}

const createThrottleAddMusics = (
  add: (listId: string, musicInfos: LX.Music.MusicInfoLocal[]) => Promise<void>,
  remove: (listId: string, errorPath: string[]) => Promise<void>,
  listId: string
) => {
  let timer: number | null = null
  let _musicInfos: LX.Music.MusicInfoLocal[] = []
  let _errorPath: string[] = []
  return (musicInfos: LX.Music.MusicInfoLocal[], errorPath?: string[]) => {
    if (musicInfos.length) _musicInfos = [..._musicInfos, ...musicInfos]
    if (errorPath) _errorPath = [..._errorPath, ...errorPath]
    if (timer) return
    timer = BackgroundTimer.setTimeout(async () => {
      timer = null
      let musicInfos = _musicInfos
      _musicInfos = []
      let errorPath = _errorPath
      _errorPath = []
      if (musicInfos.length) await add(listId, musicInfos)
      if (errorPath.length) await remove(listId, errorPath)
    }, 1000)
  }
}

const handleUpdateMusics = async (
  filePaths: string[],
  throttleUpdateMusics: (musicInfos: LX.Music.MusicInfoLocal[], errorPath?: string[]) => void,
  index: number = -1,
  total: number = 0,
  errorPath: string[] = []
) => {
  console.log(`[本地导入] 开始读取元数据，共 ${filePaths.length} 个文件`)
  if (!total) total = filePaths.length
  const paths = filePaths.slice(index + 1, index + 11)
  console.log(`[本地导入] 当前批次: ${paths.length} 个文件`)
  
  const musicInfos = await createLocalMusicInfos(paths, errorPath)
  console.log(`[本地导入] 本批次成功: ${musicInfos.length} 个，失败: ${paths.length - musicInfos.length} 个`)
  
  if (musicInfos.length) throttleUpdateMusics(musicInfos)
  index += 10
  if (filePaths.length - 1 > index)
    await handleUpdateMusics(filePaths, throttleUpdateMusics, index, total, errorPath)
  else {
    if (errorPath.length) {
      console.log(`[本地导入] 有 ${errorPath.length} 个文件读取元数据失败`)
      console.log(`[本地导入] 失败的文件:`)
      errorPath.forEach((p, i) => {
        console.log(`[本地导入]   ${i + 1}. ${p.split('/').at(-1)}`)
      })
      log.warn('Parse metadata failed:\n' + errorPath.map((p) => p.split('/').at(-1)).join('\n'))
      toast(
        global.i18n.t('list_select_local_file_result_failed_tip', {
          total,
          success: total - errorPath.length,
          failed: errorPath.length,
        }),
        'long'
      )
    } else {
      toast(global.i18n.t('list_select_local_file_result_tip', { total }), 'long')
    }
    throttleUpdateMusics([], errorPath)
  }
}
export const handleImportMediaFile = async (listInfo: LX.List.MyListInfo, path: string) => {
  console.log(`[本地导入] ========== 开始导入 ==========`)
  console.log(`[本地导入] 歌单: ${listInfo.name}`)
  console.log(`[本地导入] 路径: ${path}`)
  
  setFetchingListStatus(listInfo.id, true)
  let importSuccess = false
  let importError = ''
  let importedCount = 0
  
  try {
    console.log(`[本地导入] 扫描音频文件...`)
    const files = await scanAudioFiles(path)
    console.log(`[本地导入] 找到 ${files.length} 个音频文件`)
    
    if (files.length) {
      console.log(`[本地导入] 音频文件列表:`)
      files.forEach((f, i) => {
        console.log(`[本地导入]   ${i + 1}. ${f.name} (${f.mimeType || '未知类型'})`)
      })
      
      const throttleUpdateMusics = createThrottleAddMusics(
        async (listId, musicInfos) => {
          return updateListMusics(musicInfos.map((info) => ({ id: listId, musicInfo: info })))
        },
        async (listId, errorPath) => {
          return removeListMusics(listId, errorPath)
        },
        listInfo.id
      )
      await addListMusics(
        listInfo.id,
        files.map(buildLocalMusicInfoByFilePath),
        settingState.setting['list.addMusicLocationType']
      )
      importedCount = files.length
      console.log(`[本地导入] 成功添加 ${files.length} 首歌曲到歌单`)
      toast(global.i18n.t('list_select_local_file_temp_add_tip', { total: files.length }), 'long')
      await handleUpdateMusics(
        files.map((f) => f.path),
        throttleUpdateMusics
      )
      importSuccess = true
    } else {
      console.log(`[本地导入] 未找到音频文件`)
      toast(global.i18n.t('list_select_local_file_empty_tip'), 'long')
      importError = '未找到音频文件'
    }
  } catch (error) {
    console.error(`[本地导入] 导入失败:`, error)
    importError = error.message || '未知错误'
    toast(`导入失败: ${error.message}`, 'long')
  } finally {
    setFetchingListStatus(listInfo.id, false)
    console.log(`[本地导入] ========== 导入完成 ==========`)
    if (importSuccess) {
      console.log(`[本地导入] 最终结果: 成功导入 ${importedCount} 首歌曲`)
    } else {
      console.log(`[本地导入] 最终结果: 失败`)
      console.log(`[本地导入] 失败原因: ${importError}`)
    }
  }
}
