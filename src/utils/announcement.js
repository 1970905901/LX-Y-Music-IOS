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
  announcementId: '15111',
  title: '🎉 公告功能测试',
  content: '## 功能说明\n\n这是一个 **本地测试** 公告，用于验证所有 Markdown 功能。\n\n### 文字样式\n\n- **粗体文本**\n- *斜体文本*\n- `行内代码`\n- <color=#FF0000>红色字体</color>\n- <color=#00FF00>绿色字体</color>\n- <color=#0000FF>蓝色字体</color>\n\n---\n\n### 链接测试\n\n点击这里访问 [GitHub 仓库](https://github.com/WalnutBai/lx-lxwalnut-music-mobile)\n\n---\n\n### 图片测试\n\n![React Native Logo](https://reactnative.dev/img/header_logo.svg)\n\n---\n\n### 视频测试\n\n[video](https://tools.mgtv100.com/short/djVWP63oNk)\n\n---\n\n### 代码块测试\n\n```javascript\nconst greeting = "Hello, LX Music!";\nconsole.log(greeting);\n```\n\n---\n\n> 测试所有样式是否正常显示！',
  image: '',
  buttons: [
    {
      text: '网盘下载',
      enabled: true,
      url: 'https://1813811951.share.123pan.cn/123pan/XINlVv-II4TH'
    },
    {
      text: '帮助文档',
      enabled: true,
      url: 'https://github.com/WalnutBai/lx-lxwalnut-music-mobile/blob/master/README.md'
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
