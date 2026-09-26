// 公告数据（本地固定，不联网）
//
// 原实现从 GitHub 远程 announcement.json 拉取，但远程已换成「多页 + 分页按钮」的新格式
// （content 是数组、按钮改用 action 描述行为），与本 App 的单页公告弹窗不兼容；公告内容也
// 不再需要联网下发，因此改为固定维护在本文件里，取数据不再发任何网络请求。
//
// 展示时机：首次安装启动、且用户签署「许可协议」之后弹一次（见 core/init 的注释与
// PactModal 的 scheduleAnnouncementCheckAfterPact）。
// 「只弹一次」由 announcementId 与本地已展示 ID 比对保证（见 core/announcement）。
// 修改内容时请一并修改 announcementId，否则已经看过旧公告的机器不会再弹新内容。

// ===== 调试开关 =====
// DEBUG_MODE = true: 调试模式，忽略「本地已展示 ID」比对，每次启动都弹
// DEBUG_MODE = false: 正常模式，只在本地没有展示过该 announcementId 时弹
export const DEBUG_MODE = false

const localAnnouncement = {
  // 内容有更新时改这里（例如 local-20261001-1），用于让已看过旧公告的机器也能看到新公告
  announcementId: 'local-qqgroup-1013518794',
  title: '🎉 欢迎使用 LX-Y Music',
  content: [
    '加入 QQ 群 **1013518794** 与开发者和音乐爱好者交流，点击下方「复制群号」按钮即可复制群号。',
    '',
    '赞赏支持：若你觉得本软件不错，欢迎赞赏支持开发者。',
  ].join('\n'),
  // 赞赏码用 App 内置图片（src/resources/images/reward-qrcode.jpg），由弹窗直接渲染，
  // 不走图片地址，因此这里不设置 image。
  showRewardQrcode: true,
  buttons: [
    {
      text: '复制群号',
      enabled: true,
      url: 'qq-group:1013518794',
    },
    {
      text: '关闭',
      enabled: true,
      url: '',
    },
  ],
}

export const getAnnouncementInfo = async() => {
  // 每次都返回新对象，避免调用方改到共享数据
  return {
    ...localAnnouncement,
    buttons: localAnnouncement.buttons.map((btn) => ({ ...btn })),
  }
}
