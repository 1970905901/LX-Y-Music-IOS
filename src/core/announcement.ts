import { getAnnouncementInfo, DEBUG_MODE } from '@/utils/announcement'
import announcementActions from '@/store/announcement/action'
import announcementState from '@/store/announcement/state'
import {
  getLocalAnnouncementId,
  saveLocalAnnouncementId,
} from '@/utils/data'
import { showAnnouncementModal } from '@/navigation'
import { Navigation } from 'react-native-navigation'

const logger = (msg: string, ...args: any[]) => {
  console.log(`[Announcement] ${msg}`, ...args)
}

export const showModal = async () => {
  logger('展示弹窗 - 当前状态:', announcementState.showModal)
  if (announcementState.showModal) {
    logger('弹窗已展示，跳过')
    return
  }
  // 弹窗展示时立即保存 ID
  if (announcementState.announcementInfo) {
    const id = announcementState.announcementInfo.announcementId
    logger('弹窗展示，立即保存 ID:', id)
    saveLocalAnnouncementId(id)
    announcementActions.setLocalAnnouncementId(id)
    const verifyId = await getLocalAnnouncementId()
    logger('ID 已保存，验证读取:', verifyId)
  }
  announcementActions.setShowModal(true)
  logger('调用 showAnnouncementModal')
  showAnnouncementModal()
}

export const hideModal = (componentId: string) => {
  logger('关闭弹窗')
  if (!announcementState.showModal) return
  announcementActions.setShowModal(false)
  void Navigation.dismissOverlay(componentId)
}

export const checkAnnouncement = async (silent = false) => {
  logger('========== 开始检查公告 ==========')
  logger('DEBUG_MODE:', DEBUG_MODE)
  logger('silent:', silent)
  announcementActions.setAnnouncementInfo({ status: 'checking' })

  try {
    const announcementInfo = await getAnnouncementInfo()
    logger('获取到远程公告信息')
    logger('- 远程 ID:', announcementInfo?.announcementId)
    logger('- 标题:', announcementInfo?.title)

    // ID 为空、null、undefined、false 时，完全禁用公告，不做任何处理
    if (!announcementInfo || !announcementInfo.announcementId || announcementInfo.announcementId === 'false') {
      logger('announcementId 为空或 "false"，公告功能已禁用')
      announcementActions.setAnnouncementInfo({ status: 'idle' })
      return
    }

    // 调试模式：直接弹出，忽略ID检查
    if (DEBUG_MODE) {
      logger('调试模式：强制展示弹窗（忽略 ID 检查）')
      announcementActions.setAnnouncementInfo({
        announcementInfo,
        status: 'idle',
      })
      if (!silent) {
        await showModal()
      }
      return
    }

    // 正常模式：检查ID是否变化
    const localId = await getLocalAnnouncementId()
    logger('本地 ID:', localId)
    logger('远程 ID:', announcementInfo.announcementId)

    if (localId !== announcementInfo.announcementId) {
      logger('ID 不一致 → 需要展示弹窗')
      logger('执行 ID 更换:', localId, '→', announcementInfo.announcementId)
      announcementActions.setAnnouncementInfo({
        announcementInfo,
        status: 'idle',
      })

      if (!silent) {
        await showModal()
      }
    } else {
      logger('ID 一致 → 跳过，不展示弹窗')
      announcementActions.setAnnouncementInfo({ status: 'idle' })
    }
  } catch (err) {
    console.error('[Announcement] 检查失败:', err)
    announcementActions.setAnnouncementInfo({ status: 'error' })
  }
  logger('========== 公告检查完成 ==========')
}

export const dismissAnnouncement = async () => {
  logger('dismissAnnouncement 被调用')
  logger('announcementState.announcementInfo:', announcementState.announcementInfo)
  if (announcementState.announcementInfo) {
    const oldId = announcementState.announcementInfo.announcementId
    logger('关闭弹窗并保存 ID:', oldId)
    saveLocalAnnouncementId(oldId)
    announcementActions.setLocalAnnouncementId(oldId)
    const verifyId = await getLocalAnnouncementId()
    logger('ID 已保存，验证读取:', verifyId)
  } else {
    logger('announcementInfo 为空，无法保存 ID')
  }
}

// 测试用：清除本地公告ID，下次启动会重新弹出
export const resetAnnouncementForTest = () => {
  saveLocalAnnouncementId(null)
  announcementActions.setLocalAnnouncementId(null)
  logger('本地 ID 已重置（测试用）')
}

// 测试用：强制显示公告弹窗（不检查ID）
export const forceShowAnnouncement = async () => {
  logger('强制展示公告弹窗')
  try {
    const announcementInfo = await getAnnouncementInfo()
    if (announcementInfo) {
      logger('获取到公告:', announcementInfo.announcementId)
      announcementActions.setAnnouncementInfo({
        announcementInfo,
        status: 'idle',
      })
      // 先重置状态，再显示
      announcementActions.setShowModal(false)
      showModal()
    }
  } catch (err) {
    console.error('[Announcement] 强制展示失败:', err)
  }
}

// 测试用：重新检查公告（可多次调用）
export const recheckAnnouncement = async () => {
  logger('重新检查公告')
  // 先重置 showModal 状态
  announcementActions.setShowModal(false)
  await checkAnnouncement(false)
}
