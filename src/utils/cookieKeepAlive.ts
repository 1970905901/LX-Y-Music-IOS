import { httpFetch } from '@/utils/request'
import { weapi } from '@/utils/musicSdk/wy/utils/crypto'
import settingState from '@/store/setting/state'

const KEEP_ALIVE_INTERVAL_MS = 12 * 60 * 60 * 1000
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

let keepAliveTimer: ReturnType<typeof setInterval> | null = null

const getResponseCode = (body: string | Blob): number | null => {
  if (typeof body !== 'string') return null
  try {
    const data = JSON.parse(body) as { code?: unknown }
    return typeof data.code === 'number' ? data.code : null
  } catch {
    return null
  }
}

const pingWy = async () => {
  const cookie = settingState.setting['common.wy_cookie']
  if (!cookie) return
  const csrfToken = (cookie.match(/_csrf=([^(;|$)]+)/) || [])[1] || ''
  try {
    const requestObj = httpFetch('https://music.163.com/weapi/nuser/account/get', {
      method: 'post',
      headers: {
        'User-Agent': UA,
        origin: 'https://music.163.com',
        Referer: 'https://music.163.com',
        cookie,
      },
      form: weapi({ csrf_token: csrfToken }),
    })
    const { statusCode, body } = await requestObj.promise
    const responseCode = getResponseCode(body)
    if (statusCode === 200 && responseCode === 200) {
      console.log('[CookieKeepAlive] wy ping ok')
    } else {
      console.warn('[CookieKeepAlive] wy ping unexpected response', { statusCode, code: responseCode })
    }
  } catch (err) {
    console.warn('[CookieKeepAlive] wy ping failed:', err)
  }
}

const pingTx = async () => {
  const cookie = settingState.setting['common.tx_cookie']
  if (!cookie) return
  const uinMatch = cookie.match(/(?:^|;)\s*uin=(\d+|o[A-Za-z0-9_-]+)/)
  if (!uinMatch) return
  try {
    const requestObj = httpFetch('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg', {
      method: 'post',
      headers: {
        'User-Agent': UA,
        Referer: 'https://y.qq.com/',
        Cookie: cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `cid=205360838&userid=${uinMatch[1]}&reqfrom=1`,
    })
    const { statusCode, body } = await requestObj.promise
    const responseCode = getResponseCode(body)
    if (statusCode === 200 && responseCode !== 1000) {
      console.log('[CookieKeepAlive] tx ping ok')
    } else {
      console.warn('[CookieKeepAlive] tx ping unexpected response', { statusCode, code: responseCode })
    }
  } catch (err) {
    console.warn('[CookieKeepAlive] tx ping failed:', err)
  }
}

const runPing = () => {
  void pingWy()
  void pingTx()
}

export const startCookieKeepAlive = () => {
  if (keepAliveTimer) return
  runPing()
  keepAliveTimer = setInterval(runPing, KEEP_ALIVE_INTERVAL_MS)
  console.log('[CookieKeepAlive] started, interval:', KEEP_ALIVE_INTERVAL_MS / 1000 / 60, 'min')
}

export const stopCookieKeepAlive = () => {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer)
    keepAliveTimer = null
    console.log('[CookieKeepAlive] stopped')
  }
}
