export interface AnnouncementButton {
  text: string
  enabled: boolean
  url: string
}

export interface AnnouncementInfo {
  announcementId: string
  title: string
  /**
   * 单页 Markdown 文本（弹窗内部会 content.split('\n') 自行渲染）。
   * 公告数据固定在本地的 utils/announcement 里，始终是 string。
   */
  content: string
  /** 远程图片地址；本地固定公告不使用（内置赞赏码走 showRewardQrcode） */
  image?: string
  /** 是否在内容下方渲染 App 内置的赞赏码（src/resources/images/reward-qrcode.jpg） */
  showRewardQrcode?: boolean
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
