/**
 * WebDAV 地址校验（2026-10 全仓评审 P2-3，策略 A：明文 http 直接拒绝）。
 *
 * WebDAV 使用 Basic 认证：`Authorization: Basic base64(user:pass)` 等价于明文账号密码。
 * 一旦允许 http://，同一网络中的任何节点都能直接拿到凭据（并可读写云端数据）。
 * 因此所有创建客户端 / 构造直链请求的入口都必须先过这里，只允许 https://。
 */

export const WEBDAV_HTTPS_REQUIRED_MESSAGE = 'WebDAV 地址必须使用 https://（明文 http 会泄露账号密码）'

export const isSecureWebDAVUrl = (url: string): boolean =>
  /^https:\/\/[^\s/]+/i.test(String(url || '').trim())

export const assertSecureWebDAVUrl = (url: string): void => {
  if (!isSecureWebDAVUrl(url)) throw new Error(WEBDAV_HTTPS_REQUIRED_MESSAGE)
}
