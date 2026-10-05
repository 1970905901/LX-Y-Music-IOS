/**
 * sim-webdav-https.js
 *
 * WebDAV 强制 https（策略 A：明文 http 直接拒绝）：
 *   - 合法性：仅 https:// 且带主机名可用；http / 无 scheme / 空值 / 其它协议一律抛错；
 *   - 覆盖所有带凭据的入口：utils/webdav.ts 的 getClient、webdavMusic/drive.ts 的 getClient
 *     与 getWebDAVRemoteUrl（直链下载/歌词/封面共用），且校验必须发生在创建/发请求之前。
 *
 * 运行：node scripts/sim-webdav-https.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')
const Module = require('module')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  url: 'src/utils/webdavUrl.ts',
  sync: 'src/utils/webdav.ts',
  drive: 'src/core/webdavMusic/drive.ts',
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const REAL = Object.fromEntries(Object.entries(FILES).map(([key, rel]) => [key, read(rel)]))

const loadUrlModule = (source) => {
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
    fileName: FILES.url,
  }).outputText
  const mod = new Module(FILES.url, null)
  mod.filename = path.join(ROOT, FILES.url)
  mod.paths = Module._nodeModulePaths(path.dirname(mod.filename))
  mod._compile(out, mod.filename)
  return mod.exports
}

const structuralReasons = (files) => {
  const reasons = []
  const checkAssertBeforeCreate = (src, fnMarker, label) => {
    const start = src.indexOf(fnMarker)
    if (start < 0) {
      reasons.push(`${label}: 找不到 ${fnMarker}`)
      return
    }
    const body = src.slice(start, start + 1200)
    const assertAt = body.indexOf('assertSecureWebDAVUrl(')
    const createAt = body.indexOf('createClient(url')
    if (assertAt < 0) {
      reasons.push(`${label} 没有 https 校验（明文 http 会随 Basic 凭据发出）`)
    } else if (createAt < 0) {
      reasons.push(`${label} 找不到 createClient 调用`)
    } else if (assertAt > createAt) {
      reasons.push(`${label} 的 https 校验在 createClient 之后（形同虚设）`)
    }
  }
  checkAssertBeforeCreate(files.sync, 'function getClient()', 'utils/webdav.ts getClient')
  checkAssertBeforeCreate(files.drive, 'async function getClient()', 'webdavMusic/drive.ts getClient')

  const remoteStart = files.drive.indexOf('const getWebDAVRemoteUrl =')
  const remoteBody = remoteStart < 0 ? '' : files.drive.slice(remoteStart, remoteStart + 1500)
  const remoteAssertAt = remoteBody.indexOf('assertSecureWebDAVUrl(url)')
  const remoteBaseAt = remoteBody.indexOf('const baseUrl')
  if (remoteStart < 0) {
    reasons.push('webdavMusic/drive.ts: 找不到 getWebDAVRemoteUrl')
  } else if (remoteAssertAt < 0) {
    reasons.push('webdavMusic/drive.ts getWebDAVRemoteUrl 没有 https 校验（直链下载/歌词会带 Basic 凭据）')
  } else if (remoteBaseAt >= 0 && remoteAssertAt > remoteBaseAt) {
    reasons.push('webdavMusic/drive.ts getWebDAVRemoteUrl 的 https 校验在拼 URL 之后（形同虚设）')
  }
  return reasons
}

// 行为矩阵：真实 webdavUrl.ts
const urlModule = loadUrlModule(REAL.url)
const assertions = [
  ['C0 https 正常地址放行', () => { urlModule.assertSecureWebDAVUrl('https://dav.example.com/dav/') }],
  ['C0 https 大写协议 + 端口放行', () => { urlModule.assertSecureWebDAVUrl('HTTPS://DAV.EXAMPLE.COM:8443/dav') }],
  ['C1 http 内网地址必须拒绝', () => { urlModule.assertSecureWebDAVUrl('http://192.168.1.10/dav') }, true],
  ['C1 http 域名必须拒绝', () => { urlModule.assertSecureWebDAVUrl('http://dav.example.com') }, true],
  ['C2 缺少 scheme 必须拒绝', () => { urlModule.assertSecureWebDAVUrl('dav.example.com/dav/') }, true],
  ['C2 只有协议头必须拒绝', () => { urlModule.assertSecureWebDAVUrl('https://') }, true],
  ['C2 其它协议必须拒绝', () => { urlModule.assertSecureWebDAVUrl('ftp://dav.example.com') }, true],
  ['C2 空值必须拒绝', () => { urlModule.assertSecureWebDAVUrl('') }, true],
]
const behavior = []
for (const [name, run, shouldThrow] of assertions) {
  let threw = false
  let message = ''
  try {
    run()
  } catch (err) {
    threw = true
    message = err.message
  }
  const ok = shouldThrow ? threw && /https:\/\//.test(message) : !threw
  behavior.push([name, ok, `threw=${threw}${message ? ' msg=' + message : ''}`])
}

// 反例自检：逐个把校验拿掉，结构检查必须报错
const cases = []
const checkCase = (name, mutate, expectSubstr) => {
  let reasons = []
  try {
    reasons = structuralReasons({ ...REAL, ...mutate() })
  } catch (err) {
    cases.push([name, false, err.message])
    return
  }
  const hit = reasons.some((r) => r.includes(expectSubstr))
  cases.push([name, hit, hit ? '已拦下' : `未拦下（${JSON.stringify(reasons)}）`])
}
checkCase('C3 同步侧 getClient 去掉 https 校验', () => ({
  sync: REAL.sync.replace('  assertSecureWebDAVUrl(url)\n', ''),
}), 'utils/webdav.ts getClient')
checkCase('C4 音乐侧 getClient 去掉 https 校验', () => ({
  drive: REAL.drive.replace('  assertSecureWebDAVUrl(url)\n', ''),
}), 'webdavMusic/drive.ts getClient')
checkCase('C5 直链 URL 构造去掉 https 校验', () => ({
  drive: REAL.drive.replace('  // 直链请求同样带 Basic 认证头：这里也要挡 http（下载/歌词/封面都会走本函数构造 URL）\n  assertSecureWebDAVUrl(url)\n', ''),
}), 'getWebDAVRemoteUrl 没有 https 校验')

const models = [
  ['策略 A：http 明文携带 Basic 凭据 → 必须拒绝（不可放行）',
    behavior.filter(([name, ok]) => name.includes('必须拒绝') && !ok).length === 0],
  ['https（含大写协议/端口）→ 放行', behavior.filter(([name, ok]) => name.includes('放行') && !ok).length === 0],
]

const realReasons = structuralReasons(REAL)
const failedModels = models.filter(([, ok]) => !ok)
const failedBehavior = behavior.filter(([, ok]) => !ok)
const missed = cases.filter(([, ok]) => !ok)

console.log('行为矩阵')
for (const [name, ok, detail] of behavior) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  —— ' + detail}`)
console.log('')
console.log('行为模型')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of cases) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')

if (realReasons.length) {
  console.error(`FAIL  WebDAV https 契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
if (realReasons.length || failedBehavior.length || failedModels.length || missed.length) {
  console.error(`\nFAIL  WebDAV https 契约未通过：结构 ${realReasons.length} 项、行为 ${failedBehavior.length} 例、模型 ${failedModels.length} 例、反例漏检 ${missed.length} 例`)
  process.exit(1)
}
console.log(`PASS  WebDAV 仅允许 https，所有带凭据入口均前置校验（行为矩阵 ${behavior.length} 例 + 模型 ${models.length} 例 + 反例 ${cases.length} 例）`)
process.exit(0)
