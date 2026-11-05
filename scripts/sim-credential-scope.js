/**
 * sim-credential-scope.js
 *
 * 登录 Cookie 只能发往「https + 精确域名」，备份/同步数据里不得出现任何凭据。
 *
 * 背景（2026-10 安全审计，两条都可在源码里直接证明）：
 *   ① utils/request.js 旧实现用 `url.includes('y.qq.com')` 判归属，于是
 *      `http://c.y.qq.com/...`（评论、旧歌单搜索）会把完整 QQ 会话 Cookie 明文发出去；
 *      `y.qq.com.attacker.test` 这类 host 同样命中。
 *   ② core/sync/syncHelpers.ts 的敏感字段名单漏了 QQ / 酷狗 Cookie，
 *      导出备份与 WebDAV 上传都会把这两个平台的登录态一起交出去。
 *
 * 判定逻辑直接复用生产代码里的 getCredentialScope / isSensitiveSettingKey，
 * 不在这里复制一份「看起来对」的正则 —— 否则两边会悄悄漂移。
 *
 * 运行：node scripts/sim-credential-scope.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
// 结构断言必须只看代码：注释里写着「旧实现用 url.includes(...)」本身不是回归，
// 被注释掉的旧 http:// 端点也不构成明文外泄。
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '')

// ---------------------------------------------------------------------------
// 直接从源码抽出 getCredentialScope 并执行（避免为了一个纯函数引入整条 RN 依赖链）
// ---------------------------------------------------------------------------
const REQUEST_SRC = read('src/utils/request.js')

const extractFunction = (src, name) => {
  const start = src.indexOf(`export const ${name} = `)
  if (start < 0) throw new Error(`找不到 ${name} 的定义`)
  const bodyStart = src.indexOf('=>', start)
  if (bodyStart < 0) throw new Error(`${name} 不是箭头函数`)
  // 从 => 起按大括号配平，取出完整函数体
  const braceStart = src.indexOf('{', bodyStart)
  let depth = 0
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error(`${name} 函数体未闭合`)
}

// 说明：这里用 Function 求值的是**本仓库自己的源码片段**（getCredentialScope），
// 目的是让契约直接复用生产判定、而不是在测试里复制一份会漂移的正则。
// 输入不是外部数据，故 no-new-func 在此文件按设计豁免（见文件顶部 eslint 注释）。
const loadCredentialScope = () => {
  const fnSource = extractFunction(REQUEST_SRC, 'getCredentialScope')
    .replace('export const getCredentialScope = ', '')
  // eslint-disable-next-line no-new-func -- 只求值本仓库源码片段，非外部输入
  const factory = new Function(`return (${fnSource})`)
  return factory()
}

const loadSensitiveKeyPredicate = () => {
  const src = read('src/core/sync/syncHelpers.ts')
  const keysMatch = /const SENSITIVE_SETTING_KEYS[\s\S]*?\]/.exec(src)
  if (!keysMatch) throw new Error('找不到 SENSITIVE_SETTING_KEYS')
  const keys = [...keysMatch[0].matchAll(/'([^']+)'/g)].map((m) => m[1])
  const patternMatch = /const SENSITIVE_KEY_PATTERN = (\/.*\/i)/.exec(src)
  const fragmentMatch = /const SENSITIVE_KEY_FRAGMENT = (\/.*\/i)/.exec(src)
  if (!patternMatch || !fragmentMatch) throw new Error('找不到敏感键兜底规则')
  // eslint-disable-next-line no-new-func -- 同上，只求值本仓库源码里的正则字面量
  const pattern = new Function(`return ${patternMatch[1]}`)()
  // eslint-disable-next-line no-new-func -- 同上
  const fragment = new Function(`return ${fragmentMatch[1]}`)()
  return (key) =>
    keys.includes(key) || pattern.test(key) || fragment.test(key)
}

// ---------------------------------------------------------------------------
// 1) Cookie 归属判定
// ---------------------------------------------------------------------------
const getCredentialScope = loadCredentialScope()

// 必须放行的（真实业务端点，全部 https）
const allowCases = [
  ['https://music.163.com/weapi/song/like', 'wy'],
  ['https://interface.music.163.com/eapi/batch', 'wy'],
  ['https://interface3.music.163.com/eapi/song/lyric/v1', 'wy'],
  ['https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg', 'tx'],
  ['https://u.y.qq.com/cgi-bin/musicu.fcg', 'tx'],
  ['https://y.qq.com/portal/search.html', 'tx'],
  ['https://music.163.com:443/weapi/x', 'wy'],
  ['https://MUSIC.163.COM/weapi/x', 'wy'],
]

// 必须拒绝的：明文、无关域、子串伪装、userinfo 伪装、非 http(s)、畸形
const denyCases = [
  'http://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg',
  'http://music.163.com/weapi/x',
  'https://y.qq.com.attacker.test/steal',
  'https://music.163.com.evil.test/steal',
  'https://evil.test/?next=https://music.163.com/',
  'https://evil.test#https://y.qq.com/',
  'https://qq.com@evil.test/steal',
  'https://evilqq.com/steal',
  'https://notmusic.163.com/steal',
  'ftp://music.163.com/weapi/x',
  'file:///etc/passwd',
  'javascript:alert(1)',
  '',
  'music.163.com/weapi/x',
  'https://',
  'https:///weapi/x',
  null,
  undefined,
  123,
]

// ---------------------------------------------------------------------------
// 2) 备份 / 同步敏感字段
// ---------------------------------------------------------------------------
const isSensitiveSettingKey = loadSensitiveKeyPredicate()

const mustBeSensitive = [
  'common.wy_cookie',
  'common.kg_cookie',
  'common.tx_cookie',
  'common.yt_cookie',
  'common.wy_serpapi_key',
  'sync.webdav.password',
  // 兜底规则覆盖「以后新增但忘记加名单」的情况
  'common.bilibili_cookie',
  'common.newplatform_cookie',
  'common.foo_token',
  'common.foo_secret',
  'common.foo_credentials',
  'player.api_password',
]

const mustNotBeSensitive = [
  'common.allowProgressBarSeek',
  'theme.glassOpacity',
  'download.path',
  'sync.webdav.url',
  'sync.webdav.username',
  'list.isShowAlbumName',
]

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------
const failures = []
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' —— ' + detail : ''}`)
  if (!ok) failures.push(name)
}

console.log('凭据归属（https + 精确域名）')
for (const [url, expect] of allowCases) {
  const actual = getCredentialScope(url)
  check(`放行 ${url}`, actual === expect, actual === expect ? '' : `期望 ${expect}，实际 ${String(actual)}`)
}
for (const url of denyCases) {
  const actual = getCredentialScope(url)
  check(`拒绝 ${JSON.stringify(url)}`, actual === null, actual === null ? '' : `实际 ${String(actual)}`)
}

console.log('')
console.log('备份 / 同步敏感字段')
for (const key of mustBeSensitive) {
  check(`剔除 ${key}`, isSensitiveSettingKey(key))
}
for (const key of mustNotBeSensitive) {
  check(`保留 ${key}`, !isSensitiveSettingKey(key))
}

// ---------------------------------------------------------------------------
// 反例自检：把生产判定改回旧实现，上面的断言必须能把它拦下来
// ---------------------------------------------------------------------------
console.log('')
console.log('反例自检')
const legacyScope = (url) => {
  if (typeof url !== 'string') return null
  if (url.includes('music.163.com')) return 'wy'
  if (url.includes('y.qq.com')) return 'tx'
  return null
}
const legacyLeaks = denyCases.some((url) => legacyScope(url) !== null)
check('旧的 url.includes() 判定会被拦下', legacyLeaks)

const legacyKeys = ['common.wy_cookie', 'common.wy_serpapi_key', 'common.yt_cookie', 'sync.webdav.password']
const legacyMisses = mustBeSensitive.filter((key) => !legacyKeys.includes(key))
check('旧的固定名单会漏掉新增凭据', legacyMisses.length > 0, `漏掉 ${legacyMisses.length} 个`)

// 结构不变量：请求层不得再出现按子串判归属
if (/url\.includes\('(?:music\.163\.com|y\.qq\.com)'\)/.test(stripComments(REQUEST_SRC))) {
  check('请求层不再用 url.includes() 判归属', false, '旧写法回归')
} else {
  check('请求层不再用 url.includes() 判归属', true)
}

// 结构不变量：QQ 的评论 / 旧歌单搜索端点必须走 https
for (const [rel, marker] of [
  ['src/utils/musicSdk/tx/comment.js', 'fcg_global_comment_h5.fcg'],
  ['src/utils/musicSdk/tx/songList.js', 'client_music_search_songlist'],
]) {
  const src = stripComments(read(rel))
  const usesHttp = new RegExp(`http://[^'"\\s]*${marker}`).test(src)
  check(`${rel} 的 ${marker} 走 https`, !usesHttp, usesHttp ? '仍是明文 http://' : '')
}

console.log('')
if (failures.length) {
  console.error(`FAIL  凭据归属契约未通过（${failures.length} 项）`)
  process.exit(1)
}
console.log(`PASS  凭据只发 https 精确域名 + 备份剔除全部凭据（放行 ${allowCases.length} + 拒绝 ${denyCases.length} + 敏感键 ${mustBeSensitive.length} + 反例 ${2}）`)
process.exit(0)
