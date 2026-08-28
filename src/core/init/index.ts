import { initSetting, showPactModal } from '@/core/common'
import registerPlaybackService from '@/plugins/player/service'
import initTheme from './theme'
import initI18n from './i18n'
import initUserApi from './userApi'
import initPlayer from './player'
import dataInit from './dataInit'
import initSync from './sync'
import initCommonState from './common'
import { initDeeplink } from './deeplink'
import { setApiSource } from '@/core/apiSource'
import commonActions from '@/store/common/action'
import settingState from '@/store/setting/state'
import { bootLog } from '@/utils/bootLog'
import { cheatTip } from '@/utils/tools'
import { checkAnnouncement } from '@/core/announcement'
import * as networkLyric from '@/core/networkLyric'
import initUiMode from './uiMode'
import { Platform } from 'react-native'
import RNFS from 'react-native-fs'
import { mkdir, readDir, moveFile, existsFile } from '@/utils/fs'
import { getDefaultDownloadPath } from '@/utils/downloadPath'
import { updateSetting } from '@/core/common'
import { getDownloadTasks, saveDownloadTasks } from '@/utils/data/download'
import downloadActions from '@/store/download/action'

let isFirstPush = true
const handlePushedHomeScreen = async() => {
  await cheatTip()
  if (settingState.setting['common.isAgreePact']) {
    if (isFirstPush) {
      isFirstPush = false
      void initDeeplink()
    }
  } else {
    if (isFirstPush) isFirstPush = false
    showPactModal()
  }

  // 延迟检查公告，确保导航已就绪（来自安卓分支）
  setTimeout(() => {
    try {
      void checkAnnouncement(false)
    } catch (err) {
      console.error('[Announcement] Error calling checkAnnouncement:', err)
    }
  }, 2000)
  networkLyric.init()
}

let isInited = false
export default async() => {
  if (isInited) return handlePushedHomeScreen
  bootLog('Initing...')
  commonActions.setFontSize(global.lx.fontSize)
  bootLog('Font size changed.')
  const setting = await initSetting()
  bootLog('Setting inited.')
  // console.log(setting)

  await initTheme(setting)
  bootLog('Theme inited.')
  await initI18n(setting)
  bootLog('I18n inited.')

  await initUserApi(setting)
  bootLog('User Api inited.')

  initUiMode()
  bootLog('Ui Mode inited.')

  setApiSource(setting['common.apiSource'])
  bootLog('Api inited.')

  registerPlaybackService()
  bootLog('Playback Service Registered.')
  await initPlayer(setting)
  bootLog('Player inited.')
  await dataInit(setting)
  bootLog('Data inited.')
  await initDownloadPath(setting)
  bootLog('Download path inited.')
  await initCommonState(setting)
  bootLog('Common State inited.')

  void initSync(setting)
  bootLog('Sync inited.')

  // syncSetting()

  isInited ||= true

  return handlePushedHomeScreen
}

/**
 * 初始化下载目录：
 * - 若设置中无 download.path，则预创建默认下载目录「本地」，确保「文件」App 中可见。
 * - iOS 上迁移历史下载文件到「本地」文件夹：
 *   1. 旧默认目录 `${Documents}/LX-Y Music` 内全部文件；
 *   2. 早期版本散落在 Documents 根目录的下载文件（以下载任务记录为准，
 *      连同同名 .lrc 歌词一并移动）。
 *   迁移后同步改写下载任务的 filePath，保证列表内文件继续可播。
 */
const initDownloadPath = async (setting: LX.AppSetting) => {
  const defaultPath = getDefaultDownloadPath()

  // 预创建默认下载目录（无论当前是否使用默认路径，都确保其存在）。
  try {
    await mkdir(defaultPath)
  } catch (err) {
    console.error('[Download Path] Failed to create default download directory:', err)
  }

  if (Platform.OS !== 'ios') return

  const movedPaths = new Map<string, string>()

  // 1) 迁移旧默认目录 `${Documents}/LX-Y Music` 内的全部文件
  const oldDefaultPath = `${RNFS.DocumentDirectoryPath}/LX-Y Music`
  try {
    if (await existsFile(oldDefaultPath)) {
      const items = await readDir(oldDefaultPath)
      for (const item of items) {
        if (!item.isFile()) continue
        const targetPath = `${defaultPath}/${item.name}`
        try {
          await moveFile(item.path, targetPath)
          movedPaths.set(item.path, targetPath)
        } catch (moveErr) {
          console.warn(`[Download Path] Failed to move ${item.path} to ${targetPath}:`, moveErr)
        }
      }
      updateSetting({ 'download.path': '' })
      console.log('[Download Path] Migrated legacy download directory into 本地.')
    }
  } catch (err) {
    console.error('[Download Path] Failed to migrate legacy download directory:', err)
  }

  // 2) 迁移散落在 Documents 根目录的下载文件（按下载任务记录精确移动）
  try {
    const tasks = await getDownloadTasks()
    let changed = false
    for (const task of tasks) {
      const filePath = task.filePath
      if (!filePath || !filePath.startsWith(`${RNFS.DocumentDirectoryPath}/`)) continue
      if (filePath.startsWith(`${defaultPath}/`)) continue
      if (movedPaths.has(filePath)) {
        task.filePath = movedPaths.get(filePath)!
        changed = true
        continue
      }
      const targetPath = `${defaultPath}/${filePath.split('/').pop()}`
      try {
        if (await existsFile(filePath)) {
          await moveFile(filePath, targetPath)
          movedPaths.set(filePath, targetPath)
          // 同名 .lrc 歌词一并迁移
          const lrcPath = filePath.replace(/\.[^/.]+$/, '.lrc')
          if (lrcPath !== filePath && (await existsFile(lrcPath).catch(() => false))) {
            await moveFile(lrcPath, targetPath.replace(/\.[^/.]+$/, '.lrc')).catch(() => {})
          }
        }
        task.filePath = targetPath
        changed = true
      } catch (moveErr) {
        console.warn(`[Download Path] Failed to move ${filePath} to ${targetPath}:`, moveErr)
      }
    }
    if (changed) {
      await saveDownloadTasks(tasks)
      downloadActions.setTasks(await getDownloadTasks())
      console.log('[Download Path] Rewrote download task paths into 本地.')
    }
  } catch (err) {
    console.error('[Download Path] Failed to migrate stray download files:', err)
  }
}
