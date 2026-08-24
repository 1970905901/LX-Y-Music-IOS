import { httpFetch } from '../../request'
import settingState from '@/store/setting/state'
import { zzcSign } from './utils/crypto'
import { log as errorLog } from '@/utils/log'

const TX_MUSIC_U_FCG = 'https://u.y.qq.com/cgi-bin/musics.fcg'

function getGuid() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

export const getMvUrl = async (vid, retryNum = 0) => {
  if (retryNum > 2) return Promise.reject(new Error('try max num'))

  const cookie = settingState.setting['common.tx_cookie']
  if (!cookie) {
    return Promise.reject(new Error('未配置QQ Cookie'))
  }

  const payload = {
    comm: {
      ct: 24,
      cv: 1800,
    },
    req_0: {
      module: 'music.stream.MvUrlProxy',
      method: 'GetMvUrls',
      param: {
        vids: [vid],
        request_type: 10003,
        guid: getGuid(),
        videoformat: 1,
        format: 265,
        dolby: 1,
        use_new_domain: 1,
        use_ipv6: 1,
      },
    },
  }

  const sign = await zzcSign(JSON.stringify(payload))

  const requestObj = httpFetch(
    `${TX_MUSIC_U_FCG}?sign=${sign}`,
    {
      method: 'POST',
      headers: {
        'User-Agent': 'QQMusic 14090508(android 12)',
        Referer: 'https://y.qq.com/',
        Cookie: cookie,
      },
      body: payload,
    },
  )

  return requestObj.promise.then(({ body, statusCode }) => {
    if (statusCode !== 200 || body.code !== 0 || body.req_0?.code !== 0) {
      return Promise.reject(new Error('获取MV链接失败'))
    }

    const mvData = body.req_0?.data?.[vid]
    if (!mvData) {
      return Promise.reject(new Error('获取MV链接失败'))
    }

    const mp4List = mvData.mp4 || []
    let targetMp4 = null
    for (let i = mp4List.length - 1; i >= 0; i--) {
      if (mp4List[i].code === 0 && mp4List[i].freeflow_url && mp4List[i].freeflow_url.length > 0) {
        targetMp4 = mp4List[i]
        break
      }
    }

    if (!targetMp4) {
      return Promise.reject(new Error('该MV暂无可用链接'))
    }

    const url = targetMp4.freeflow_url.find(u => u.startsWith('https')) || targetMp4.freeflow_url[0]
    return { url }
  }).catch(err => {
    if (retryNum > 2) return Promise.reject(err)
    return getMvUrl(vid, retryNum + 1)
  })
}
