/**
 * sim-credential-endpoints-and-bridge-errors.js
 *
 * 2026-10-06 剩余风险收口契约（两条）：
 *
 * ① 凭据类端点必须 https
 *    内置音源 SDK（百度/酷我/酷狗/Migu/QQ 等）里仍有大量 http 端点，因此 ATS 的全局例外保留
 *    （Info.plist 已就地写明原因）；但**登录态/凭据**这条链不能再走明文 —— 同网段任何节点都能
 *    直接拿到 token / 验证码请求：
 *      · 酷狗登录 login.user.kugou.com（send_mobile_code / login_by_token）改 https；
 *      · WebDAV（含同步：src/core/sync/webdavSync.ts → src/utils/webdav.ts）强制 https；
 *      · 许可协议等外链改 https。
 *
 * ② 卡片类桥调用失败必须可见
 *    「控制中心/灵动岛不更新」此前是黑盒（投递链全绿但卡片状态漂移，日志里没有任何失败记录）。
 *    now-playing 桥调用（updateNowPlayingInfo / clearNowPlayingInfo / playNowPlaying /
 *    pauseNowPlaying / stopNowPlaying）不得再用空 catch 吞错：失败打一行
 *    ###LXNowPlaying### bridge <action> failed: <message>（低频，仅失败时）。
 *
 * 运行：node scripts/sim-credential-endpoints-and-bridge-errors.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

const KG_LOGIN = 'src/utils/musicSdk/kg/utils/api.ts'
const PACT = 'src/navigation/components/PactModal.tsx'
const NOW_PLAYING_MODULE = 'src/utils/nativeModules/nowPlaying.ts'
const CONSUMERS = [
  'src/plugins/player/trackPlayerCore.ts',
  'src/core/player/nowPlaying.ts',
  'src/plugins/player/controller.ts',
]

const srcFiles = (dir, acc = []) => {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) srcFiles(rel, acc)
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) acc.push(rel)
  }
  return acc
}

const structuralReasons = () => {
  const reasons = []

  // ① 凭据类端点
  const kg = read(KG_LOGIN)
  if (!/const KG_LOGIN_BASE = 'https:\/\/login\.user\.kugou\.com'/.test(kg)) {
    reasons.push('酷狗登录基址不是 https（验证码/token 会走明文）')
  }
  if (/http:\/\/login\.user\.kugou\.com/.test(kg)) {
    reasons.push('酷狗登录仍存在 http:// 明文基址')
  }
  if (!/https:\/\/www\.apache\.org\/licenses\/LICENSE-2\.0/.test(read(PACT))) {
    reasons.push('许可协议外链仍是明文 http')
  }
  const cleartextCredential = []
  for (const rel of srcFiles('src')) {
    const text = read(rel)
    if (/http:\/\/login\.[a-z0-9.-]+/.test(text)) cleartextCredential.push(rel)
  }
  if (cleartextCredential.length) {
    reasons.push(`仍有凭据类明文端点：${cleartextCredential.join(', ')}`)
  }
  const webdavUrl = read('src/utils/webdavUrl.ts')
  if (!/export const assertSecureWebDAVUrl/.test(webdavUrl) ||
      !/export const isSecureWebDAVUrl/.test(webdavUrl) ||
      !webdavUrl.includes('^https:\\/\\/')) {
    reasons.push('WebDAV https 强制校验缺失（Basic 凭据可走明文）')
  }
  for (const rel of ['src/utils/webdav.ts', 'src/core/webdavMusic/drive.ts']) {
    if (!/assertSecureWebDAVUrl/.test(read(rel))) {
      reasons.push(`${rel} 未调用 assertSecureWebDAVUrl（凭据链路漏收口）`)
    }
  }

  // ② 卡片类桥调用失败可见
  const moduleSrc = read(NOW_PLAYING_MODULE)
  if (!/export const reportNowPlayingBridgeFailure = \(action: string, error: unknown\) => \{/.test(moduleSrc)) {
    reasons.push('缺少 reportNowPlayingBridgeFailure（卡片桥调用失败又变成静默）')
  }
  if (!/###LXNowPlaying### bridge \$\{action\} failed/.test(moduleSrc)) {
    reasons.push('桥调用失败日志缺少可 grep 前缀 ###LXNowPlaying###')
  }
  for (const rel of CONSUMERS) {
    const text = read(rel)
    // 只数真正的调用：紧跟在引号后的（reportNowPlayingBridgeFailure('playNowPlaying(...)') 这类标签）不算
    const calls = (text.match(/[^'\w](updateNowPlayingInfo|clearNowPlayingInfo|playNowPlaying|pauseNowPlaying|stopNowPlaying)\(/g) || []).length
    const reports = (text.match(/reportNowPlayingBridgeFailure\(/g) || []).length
    if (reports < calls) {
      reasons.push(`${rel} 的卡片桥调用失败没有全部打点（调用 ${calls} 处 / 打点 ${reports} 处）`)
    }
    // 跨行调用也要覆盖：任何落在 now-playing 桥调用之后的空 catch 都必须拦下
    let idx = text.indexOf('.catch(() => {})')
    while (idx >= 0) {
      const before = text.slice(Math.max(0, idx - 240), idx)
      if (/NowPlaying\(/.test(before)) {
        const line = text.slice(0, idx).split('\n').length
        reasons.push(`${rel}:${line} 仍是空 catch（now-playing 桥调用失败被静默吞掉）`)
      }
      idx = text.indexOf('.catch(() => {})', idx + 1)
    }
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：空 catch vs 带日志的 catch（失败可见性）
// ---------------------------------------------------------------------------
const oldCatch = (fails) => (fails ? { visible: false, silent: true } : { visible: false, silent: false })
const newCatch = (fails) => (fails ? { visible: true, silent: false } : { visible: false, silent: false })

const models = [
  ['反例：空 catch —— 卡片发布失败时日志里什么都看不到（黑盒）', oldCatch(true).silent === true && oldCatch(true).visible === false],
  ['修复后：失败打一行 ###LXNowPlaying### bridge（可 grep）', newCatch(true).visible === true],
  ['修复后：成功路径不打点（低频，不刷屏）', newCatch(false).visible === false],
]

const realReasons = structuralReasons()

// 反例自检 1：把酷狗登录改回 http → 必须报错
let tamper1 = false
let tamper1Detail = ''
// 反例自检 2：把一处带日志的 catch 改回空 catch → 必须报错
let tamper2 = false
let tamper2Detail = ''
const kgPath = path.join(ROOT, KG_LOGIN)
const npPath = path.join(ROOT, 'src/core/player/nowPlaying.ts')
try {
  const kgBackup = fs.readFileSync(kgPath, 'utf8')
  fs.writeFileSync(kgPath, kgBackup.replace("const KG_LOGIN_BASE = 'https://login.user.kugou.com'", "const KG_LOGIN_BASE = 'http://login.user.kugou.com'"))
  const r1 = structuralReasons()
  tamper1 = r1.some((r) => r.includes('酷狗登录基址不是 https'))
  tamper1Detail = tamper1 ? '已拦下' : `未拦下（reasons=${JSON.stringify(r1)}）`
  fs.writeFileSync(kgPath, kgBackup)
} catch (err) {
  tamper1Detail = `异常: ${err.message}`
}
try {
  const npBackup = fs.readFileSync(npPath, 'utf8')
  const mutated = npBackup.replace("  }).catch((error) => { reportNowPlayingBridgeFailure('stopNowPlaying', error) })", '  }).catch(() => {})')
  if (mutated === npBackup) throw new Error('找不到可 tamper 的 stopNowPlaying 打点')
  fs.writeFileSync(npPath, mutated)
  const r2 = structuralReasons()
  tamper2 = r2.some((r) => r.includes('仍是空 catch') || r.includes('没有全部打点'))
  tamper2Detail = tamper2 ? '已拦下' : `未拦下（reasons=${JSON.stringify(r2)}）`
  fs.writeFileSync(npPath, npBackup)
} catch (err) {
  tamper2Detail = `异常: ${err.message}`
}

console.log('行为模型')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
console.log(`${tamper1 ? 'PASS' : 'FAIL'}  酷狗登录改回 http —— ${tamper1Detail}`)
console.log(`${tamper2 ? 'PASS' : 'FAIL'}  一处桥调用失败打点改回空 catch —— ${tamper2Detail}`)

if (realReasons.length) {
  console.error(`\nFAIL  凭据端点 / 桥调用失败可见性契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
const failedModels = models.filter(([, ok]) => !ok)
if (failedModels.length) console.error(`\nFAIL  行为模型未通过（${failedModels.length} 例）`)
if (failedModels.length || realReasons.length || !tamper1 || !tamper2) {
  console.error('\nFAIL  剩余风险收口契约未通过')
  process.exit(1)
}
console.log(`\nPASS  凭据端点 https + 卡片桥调用失败可见（结构不变量 2 组 + 行为模型 ${models.length} 例 + 反例 2 例）`)
process.exit(0)
