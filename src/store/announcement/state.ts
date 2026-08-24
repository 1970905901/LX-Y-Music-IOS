export interface AnnouncementButton {
  text: string
  enabled: boolean
  url: string
}

export interface AnnouncementInfo {
  announcementId: string
  title: string
  content: string
  image?: string
  buttons: AnnouncementButton[]
}

export interface InitState {
  showModal: boolean
  announcementInfo: AnnouncementInfo | null
  localAnnouncementId: string | null
  status: 'idle' | 'checking' | 'error'
}

const state: InitState = {
  showModal: false,
  announcementInfo: null,
  localAnnouncementId: null,
  status: 'idle',
}

export default state
