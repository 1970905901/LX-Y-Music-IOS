import { httpGet } from '@/utils/request'

// ===== 调试开关 =====
// DEBUG_MODE = true: 调试模式，每次启动直接弹出公告（忽略ID检查）
// DEBUG_MODE = false: 正常模式，只有ID变化时才弹出公告
export const DEBUG_MODE = false

// ===== 本地测试模式 =====
// 将 TEST_MODE 设为 true 使用本地测试数据
// 将 TEST_MODE 设为 false 使用远程 GitHub 数据
const TEST_MODE = true

const testAnnouncementData = {
  announcementId: 'qqgroup-1013518794',
  title: '🎉 欢迎加入 LX-Y Music 交流群',
  content: '## 加入 QQ 交流群\n\n欢迎加入 LX-Y Music 官方交流群，与开发者和其他用户一起交流：\n\n### 群号\n\n**1013518794**\n\n### 提示\n\n- 点击 **复制群号** 按钮可快速复制群号\n- 打开 QQ → 加群 → 粘贴群号即可加入\n- 有问题、建议或想获取最新版本，都可以在群里交流',
  image: '',
  buttons: [
    {
      text: '复制群号',
      enabled: true,
      url: 'qq-group:1013518794'
    },
    {
      text: '关闭',
      enabled: true,
      url: ''
    }
  ]
}
// ===== 测试模式结束 =====

const address = [
  ['https://gh.llkk.cc/https://raw.githubusercontent.com/WalnutBai/lx-lxwalnut-music-mobile/master/publish/announcement.json', 'direct'],
  ['https://raw.githubusercontent.com/WalnutBai/lx-lxwalnut-music-mobile/master/publish/announcement.json', 'direct'],
  ['https://cdn.jsdelivr.net/gh/WalnutBai/lx-lxwalnut-music-mobile/publish/announcement.json', 'direct'],
  ['https://fastly.jsdelivr.net/gh/WalnutBai/lx-lxwalnut-music-mobile/publish/announcement.json', 'direct'],
  ['https://gcore.jsdelivr.net/gh/WalnutBai/lx-lxwalnut-music-mobile/publish/announcement.json', 'direct'],
]

const request = async (url, retryNum = 0) => {
  return new Promise((resolve, reject) => {
    httpGet(
      url,
      {
        timeout: 10000,
      },
      (err, resp, body) => {
        if (err || resp.statusCode != 200) {
          ++retryNum >= 3
            ? reject(err || new Error(resp.statusMessage || resp.statusCode))
            : request(url, retryNum).then(resolve).catch(reject)
        } else resolve(body)
      }
    )
  })
}

const getDirectInfo = async (url) => {
  return request(url).then((info) => {
    if (!info || !info.announcementId) throw new Error('Invalid announcement data')
    return info
  })
}

export const getAnnouncementInfo = async (index = 0) => {
  // 本地测试模式：直接返回测试数据
  // 每次调用都返回新对象，确保 ID 变化能被检测到
  if (TEST_MODE) {
    console.log('[Announcement] Running in TEST MODE, ID:', testAnnouncementData.announcementId)
    return { ...testAnnouncementData }
  }

  const [url, source] = address[index]
  let promise

  switch (source) {
    case 'direct':
      promise = getDirectInfo(url)
      break
    default:
      promise = getDirectInfo(url)
  }

  return promise.catch(async (err) => {
    index++
    if (index >= address.length) throw err
    return getAnnouncementInfo(index)
  })
}
