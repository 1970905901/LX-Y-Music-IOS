// import needle from 'needle'
// import progress from 'request-progress'
import BackgroundTimer from 'react-native-background-timer'
import { requestMsg } from './message'
import { bHh } from './musicSdk/options'
import { deflateRaw } from 'pako'
import settingState from '@/store/setting/state'

const defaultHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
}
// var proxyUrl = "http://" + user + ":" + password + "@" + host + ":" + port;
// var proxiedRequest = request.defaults({'proxy': proxyUrl});

/**
 * Automatic retry on request timeout
 * @param {*} url
 * @param {*} options
 */
export const httpFetch = (url, options = { method: 'get' }) => {
  const requestObj = fetchData(url, options)
  return {
    promise: requestObj.request.catch((err) => {
      console.log('出错', err.message)
      switch (err.message) {
        case 'socket hang up':
          return Promise.reject(new Error(requestMsg.unachievable))
        case 'Aborted':
          return Promise.reject(new Error(requestMsg.timeout))
        case 'Network request failed':
          return Promise.reject(new Error(requestMsg.notConnectNetwork))
        default:
          return Promise.reject(err)
      }
    }),
    cancelHttp() {
      requestObj.abort()
    },
  }
}

/**
 * HTTP GET request
 * @param {*} url URL address
 * @param {*} options options
 * @param {*} callback callback
 * @return {Number} index for canceling request
 */
export const httpGet = (url, options, callback) => {
  if (typeof options === 'function') {
    callback = options
    options = {}
  }
  const requestObj = fetchData(url, { ...options, method: 'get' })
  requestObj.request
    .then((resp) => {
      callback(null, resp, resp.body)
    })
    .catch((err) => {
      // debugRequest && console.log(JSON.stringify(err))
      callback(err, null, null)
    })

  return () => {
    requestObj.abort()
  }
}

/*
const fetchWithTimeout = (resource, options) => {
  const { timeout = 8000 } = options

  const controller = new global.AbortController()
  const id = BackgroundTimer.setTimeout(() => controller.abort(), timeout)

  return {
    request: global.fetch(resource, {
      ...options,
      signal: controller.signal,
    }).then(response => {
      BackgroundTimer.clearTimeout(id)
      return response
    }),
    abort() {
      controller.abort()
    },
  }
} */

const handleDeflateRaw = (data) =>
  new Promise((resolve, _reject) => {
    resolve(Buffer.from(deflateRaw(data)))
    // deflateRaw(data, (err, buf) => {
    //   if (err) return reject(err)
    //   resolve(buf)
    // })
  })

const regx = /(?:\d\w)+/g

/**
 * 登录 Cookie 的**唯一**放行判定。
 *
 * 历史坑（2026-10 安全评审）：此前用 `url.includes('y.qq.com')` 判归属，于是
 *   ① `http://c.y.qq.com/...` 这类明文端点也会带上完整会话 Cookie（同网段可嗅探）；
 *   ② 任何 host 里只要出现这段子串（如 `y.qq.com.attacker.test`）也会带走凭据。
 * 因此必须**解析** URL 后同时校验：协议为 https、hostname 是目标域或目标域的真子域。
 * 解析失败一律不放行（宁可请求失败，也不泄露凭据）。
 *
 * 导出供回归契约脚本直接断言，不要在别处复制这段判断。
 */
export const getCredentialScope = (url) => {
  if (typeof url !== 'string') return null
  // 手写解析而不是用 URL 构造器：RN 的 URL 是部分 polyfill，行为随版本变化，
  // 安全判定不能依赖它。这里只接受 `https://<authority>...`，其余一律拒绝。
  const match = /^https:\/\/([^/?#\\]+)/i.exec(url.trim())
  if (!match) return null
  // 去掉 userinfo 与端口，再小写化（`https://qq.com@evil.test/` 的 host 是 evil.test）
  const authority = match[1]
  const hostWithPort = authority.slice(authority.lastIndexOf('@') + 1)
  const hostname = hostWithPort.replace(/:\d*$/, '').toLowerCase()
  if (!hostname) return null
  const matches = (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  if (matches('music.163.com')) return 'wy'
  if (matches('qq.com')) return 'tx'
  return null
}

const handleRequestData = async(
  url,
  { method = 'get', headers = {}, format: _format = 'json', cache = 'no-store', params, ...options },
) => {
  // console.log(url, options)
  headers = Object.assign(
    {
      Accept: 'application/json',
    },
    headers,
  )
  // 凭据只在「https + 精确域名」下附带，判定见 getCredentialScope（含反例说明）
  const credentialScope = getCredentialScope(url)
  if (credentialScope === 'wy') {
    headers.cookie = settingState.setting['common.wy_cookie']
  } else if (credentialScope === 'tx') {
    headers.cookie = settingState.setting['common.tx_cookie']
    console.log('[TX] req:', options.method || 'get', url.substring(0, 80))
  }
  options.cache = cache

  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.append(key, value)
      }
    }
    const queryString = searchParams.toString()
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString
    }
  }

  if (method.toLocaleLowerCase() === 'post' && !headers['Content-Type']) {
    if (options.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      const formBody = []
      for (let [key, value] of Object.entries(options.form)) {
        let encodedKey = encodeURIComponent(key)
        let encodedValue = encodeURIComponent(value)
        formBody.push(`${encodedKey}=${encodedValue}`)
      }
      options.body = formBody.join('&')
      delete options.form
    } else if (options.formData) {
      headers['Content-Type'] = 'multipart/form-data'
      const formBody = []
      for (let [key, value] of Object.entries(options.formData)) {
        let encodedKey = encodeURIComponent(key)
        let encodedValue = encodeURIComponent(value)
        formBody.push(`${encodedKey}=${encodedValue}`)
      }
      options.body = options.formData
      delete options.formData
    } else {
      headers['Content-Type'] = 'application/json'
    }
  }
  if (headers['Content-Type'] === 'application/json' && options.body) {
    options.body = JSON.stringify(options.body)
  }
  if (headers[bHh]) {
    let s = Buffer.from(bHh, 'hex').toString()
    s = s.replace(s.substr(-1), '')
    s = Buffer.from(s, 'base64').toString()
    const v = process.versions.app
      .split('-')[0]
      .split('.')
      .map((n) => (n.length < 3 ? n.padStart(3, '0') : n))
      .join('')
    const v2 = process.versions.app.split('-')[1] || ''
    headers[s] =
      !s ||
      `${(await handleDeflateRaw(Buffer.from(JSON.stringify(`${url}${v}`.match(regx), null, 1).concat(v)).toString('base64'))).toString('hex')}&${parseInt(v)}${v2}`
    delete headers[bHh]
  }

  const finalOptions = {
    ...options,
    method,
    headers: Object.assign({}, defaultHeaders, headers),
    url,
  }

  if (credentialScope === 'tx') {
    console.log('[TX] req:', finalOptions.method, finalOptions.url.slice(0, 60))
  }

  return finalOptions
}

// https://stackoverflow.com/a/64945178
const blobToBuffer = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new global.FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const data = reader.result.slice(reader.result.indexOf('base64,') + 7)
      resolve(Buffer.from(data, 'base64'))
    }
    reader.readAsDataURL(blob)
  })
}

const fetchData = (url, { timeout = 15000, ...options }) => {
  const controller = new global.AbortController()
  let id = BackgroundTimer.setTimeout(() => {
    id = null
    controller.abort()
  }, timeout)

  return {
    request: handleRequestData(url, options).then((processedOptions) => {
      const finalUrl = processedOptions.url || url
      delete processedOptions.url
      console.log(`[HTTP] ${processedOptions.method || 'GET'} ${finalUrl}`)
      if (processedOptions.body) {
        const bodyPreview = typeof processedOptions.body === 'string'
          ? processedOptions.body.substring(0, 200)
          : JSON.stringify(processedOptions.body).substring(0, 200)
        console.log(`[HTTP] Body: ${bodyPreview}`)
      }
      return global
        .fetch(finalUrl, {
          ...processedOptions,
          signal: controller.signal,
        })
        .then((resp) => {
          return (options.binary ? resp.blob() : resp.text()).then((text) => {
            return {
              headers: resp.headers.map,
              body: text,
              statusCode: resp.status,
              statusMessage: resp.statusText,
              url: resp.url,
              ok: resp.ok,
            }
          })
        })
        .then((resp) => {
          if (options.binary) {
            return blobToBuffer(resp.body).then((buffer) => {
              resp.body = buffer
              return resp
            })
          } else {
            try {
              const parsedBody = JSON.parse(resp.body)
              if (parsedBody?.code === 301 && getCredentialScope(url) === 'wy') {
                throw new Error('登录状态已过期')
              }
              resp.body = parsedBody
            } catch (e) {
              if (e.message.startsWith('登录状态已过期')) throw e
            }
            return resp
          }
        })
        .catch((err) => {
          // console.log(err, err.code, err.message)
          return Promise.reject(err)
        })
        .finally(() => {
          if (id == null) return
          BackgroundTimer.clearTimeout(id)
        })
    }),
    abort() {
      controller.abort()
    },
  }
}

export const checkUrl = async(url, options = {}) => {
  return fetchData(url, { method: 'head', ...options }).request.then((resp) => {
    if (resp.statusCode === 200) {
      return Promise.resolve()
    } else {
      throw new Error(resp.statusCode)
    }
  })
}
