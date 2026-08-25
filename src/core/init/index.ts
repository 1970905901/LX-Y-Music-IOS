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
 * - 若设置中无 download.path，则预创建默认下载目录，确保「文件」App 中可见。
 * - iOS 上若用户仍使用旧默认路径 `${Documents}/LX-Y Music`，则迁移到 Documents 根目录，
 *   避免「文件」App 中出现两层同名 LX-Y Music 目录且外层为空的困惑。
 */
const initDownloadPath = async (setting: LX.AppSetting) => {
  const currentPath = setting['download.path']
  const defaultPath = getDefaultDownloadPath()

  // 预创建默认下载目录（无论当前是否使用默认路径，都确保其存在）。
  try {
    await mkdir(defaultPath)
  } catch (err) {
    console.error('[Download Path] Failed to create default download directory:', err)
  }

  // iOS：迁移旧默认子目录路径到新默认路径（Documents 根目录）。
  if (Platform.OS === 'ios' && currentPath) {
    const oldDefaultPath = `${RNFS.DocumentDirectoryPath}/LX-Y Music`
    if (currentPath === oldDefaultPath || currentPath.startsWith(`${oldDefaultPath}/`)) {
      try {
        const exists = await existsFile(oldDefaultPath)
        if (exists) {
          const items = await readDir(oldDefaultPath)
          for (const item of items) {
            if (item.isFile) {
              const targetPath = `${RNFS.DocumentDirectoryPath}/${item.name}`
              try {
                await moveFile(item.path, targetPath)
              } catch (moveErr) {
                console.warn(`[Download Path] Failed to move ${item.path} to ${targetPath}:`, moveErr)
              }
            }
          }
        }
        updateSetting({ 'download.path': '' })
        console.log('[Download Path] Migrated old default download directory to Documents root.')
      } catch (err) {
        console.error('[Download Path] Failed to migrate old download directory:', err)
      }
    }
  }
}
