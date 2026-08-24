import state, { type InitState } from './state'

export default {
  setAnnouncementInfo(info: Partial<InitState>) {
    if (info.showModal !== undefined) state.showModal = info.showModal
    if (info.announcementInfo !== undefined) state.announcementInfo = info.announcementInfo
    if (info.localAnnouncementId !== undefined) state.localAnnouncementId = info.localAnnouncementId
    if (info.status !== undefined) state.status = info.status
    global.state_event.announcementUpdated({ ...state })
  },
  setShowModal(visible: boolean) {
    state.showModal = visible
  },
  setLocalAnnouncementId(id: string | null) {
    state.localAnnouncementId = id
  },
}
