// import { generateKeyPair } from 'crypto'
import { gzipString, unGzipString } from '@/utils/fs'
import { SYNC_CODE } from '../constants'

export const request = async(
  url: string,
  { timeout = 10000, ...options }: RequestInit & { timeout?: number } = {},
) => {
  const controller = new AbortController()
  // 普通 setTimeout：这里只是请求超时后的 abort 兜底，不需要在 App 被挂起时唤醒；
  // 用 BackgroundTimer 会为整段请求申请后台任务断言（阻止挂起 = 净耗电）。
  let id: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    id = null
    controller.abort()
  }, timeout)
  return fetch(url, {
    ...options,
    signal: controller.signal,
  })
    .then(async(response) => {
      const text = await response.text()
      return {
        text,
        code: response.status,
      }
    })
    .catch((err) => {
      // console.log(err, err.code, err.message)
      throw err
    })
    .finally(() => {
      if (id == null) return
      clearTimeout(id)
    })
}

// export const aesEncrypt = (text: string, key: string, iv: string) => {
//   const cipher = createCipheriv('aes-128-cbc', Buffer.from(key, 'base64'), Buffer.from(iv, 'base64'))
//   return Buffer.concat([cipher.update(Buffer.from(text)), cipher.final()]).toString('base64')
// }

// export const aesDecrypt = (text: string, key: string, iv: string) => {
//   const decipher = createDecipheriv('aes-128-cbc', Buffer.from(key, 'base64'), Buffer.from(iv, 'base64'))
//   return Buffer.concat([decipher.update(Buffer.from(text, 'base64')), decipher.final()]).toString()
// }

export { generateRsaKey } from '@/utils/nativeModules/crypto'
// export const generateRsaKey = async() => new Promise<{ publicKey: string, privateKey: string }>((resolve, reject) => {
//   generateKeyPair(
//     'rsa',
//     {
//       modulusLength: 2048, // It holds a number. It is the key size in bits and is applicable for RSA, and DSA algorithm only.
//       publicKeyEncoding: {
//         type: 'spki', // Note the type is pkcs1 not spki
//         format: 'pem',
//       },
//       privateKeyEncoding: {
//         type: 'pkcs8', // Note again the type is set to pkcs1
//         format: 'pem',
//         // cipher: "aes-256-cbc", //Optional
//         // passphrase: "", //Optional
//       },
//     },
//     (err, publicKey, privateKey) => {
//       if (err) {
//         reject(err)
//         return
//       }
//       resolve({
//         publicKey,
//         privateKey,
//       })
//     },
//   )
// })

export const encryptMsg = async(keyInfo: LX.Sync.KeyInfo, msg: string): Promise<string> => {
  return msg.length > 1024 ? 'cg_' + (await gzipString(msg)) : msg
  // if (!keyInfo) return ''
  // return aesEncrypt(msg, keyInfo.key, keyInfo.iv)
}

export const decryptMsg = async(keyInfo: LX.Sync.KeyInfo, enMsg: string): Promise<string> => {
  return enMsg.substring(0, 3) == 'cg_' ? unGzipString(enMsg.replace('cg_', '')) : enMsg
  // if (!keyInfo) return ''
  // let msg = ''
  // try {
  //   msg = aesDecrypt(enMsg, keyInfo.key, keyInfo.iv)
  // } catch (err) {
  //   console.log(err)
  // }
  // return msg
}

/**
 * 同步服务地址规范化（用户真机反馈：照着电脑端显示的「IP:端口」填进去连不上）。
 *
 * 手机键盘上真正常见的三类输入，统一收敛成同一个规范形态：
 *   ① 协议被自动大写/大小写混写：`Http://192.168.1.5:23332` —— iOS 键盘默认首字母大写，
 *      而旧解析是大小写敏感的（`/^https:/` 与 `replace('http://')` 都只认小写），会拼出
 *      `http://Http://192.168.1.5:23332/hello` 这种必然失败的地址；
 *   ② 不带协议：`192.168.1.5:23332`（电脑端「同步服务地址」就是 IP:端口）—— 旧实现在输入框
 *      阶段直接拒绝并清空输入，用户看到的就是「填了地址却连不上」；
 *   ③ 全角标点 / 首尾空白 / 零宽字符（中文键盘的 `：／．`、复制粘贴带进来的不可见字符）。
 * 返回空串表示这个输入无法当作地址（调用方给提示，不要静默失败）。
 */
export const normalizeSyncHost = (input: string): string => {
  if (typeof input !== 'string') return ''
  let text = input
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .trim()
  if (!text) return ''
  text = text.replace(/^\/+/, '').replace(/\/+$/, '')
  // 缺协议自动补 http://（同步服务是明文局域网服务，要 https 时须用户显式写）
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'http://' + text
  const matched = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)(.*)$/i.exec(text)
  if (!matched) return ''
  const scheme = /^https$/i.test(matched[1]) ? 'https' : 'http'
  const host = matched[2]
  // 主机名只接受 ASCII 主机名 / IPv4 / [IPv6]（拦掉中文、emoji 这类明显不是地址的输入）
  if (!/^[a-z0-9._-]+(:\d{1,5})?$/i.test(host) && !/^\[[0-9a-f:.]+\](:\d{1,5})?$/i.test(host)) return ''
  return `${scheme}://${host}${matched[3]}`
}

export const parseUrl = (href: string): LX.Sync.UrlInfo => {
  // 解析前先规范化：历史地址、冷启动自动连接读到的旧值也走这里，
  // 避免 `Http://` / 缺协议 / 全角冒号再拼出无效 URL
  const normalized = normalizeSyncHost(href)
  if (!normalized) throw new Error(SYNC_CODE.unknownServiceAddress)
  const httpProtocol = normalized.startsWith('https://') ? 'https:' : 'http:'
  const hostPath = normalized.slice(httpProtocol.length + 2)
  console.log('sync host:', normalized)
  return {
    wsProtocol: httpProtocol == 'https:' ? 'wss:' : 'ws:',
    httpProtocol,
    hostPath,
    href: normalized,
  }
}

export const sendStatus = (_status: LX.Sync.Status) => {
  // syncLog.log(JSON.stringify(status))
}
