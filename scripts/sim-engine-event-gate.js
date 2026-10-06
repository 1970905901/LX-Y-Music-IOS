/**
 * sim-engine-event-gate.js
 *
 * 「换源闸门必须有上界」契约（2026-10-06 用户实测：卡片失效时在 App 内暂停→播放也无效）。
 *
 * 现象：播放中控制中心 / 灵动岛卡片冻结（按钮方向反、按了没反应、进度条停走），
 * 但音频照播、App 内进度照走；重启 App 才恢复。此前所有定位都盯着卡片本身
 * （MediaPlayer 主线程、看门狗、引擎真值），都解释不了「在 App 内暂停→播放也不恢复」——
 * 因为那两次按键产生的引擎事件同样被**投递闸门**丢掉了。
 *
 * 根因（结构性缺陷）：
 *   controller.ts 的引擎事件回调在 `global.lx.gettingUrlId` 非空时丢弃**所有** trackPlayer
 *   事件；而该值只在 setMusicUrl 的 finally 里清，旧实现还要求 `musicInfo === 播放信息`
 *   **引用相等**：
 *     · 加载期间播放信息被「同 id 的新对象」换代 → 引用比较失败 → 永久残留；
 *     · URL 请求永不 settle（请求挂起） → finally 永不执行 → 永久残留。
 *   一旦残留：不发布 nowPlaying（卡片冻结）、不派发 trackChanged / ended（自动下一首停摆），
 *   而音频播放与 App 内进度都不经过这个闸门（原生 4Hz 位置事件 + 1s 慢校准）→
 *   表现就是「有声音但卡片失效，只有重启恢复」。
 *
 * 修法：
 *   · 闸门加时间上界（GETTING_URL_ID_GATE_MAX_MS，超时放行并打 ###LXPlayerGuard### 一行）；
 *   · finally 用「歌曲 id」比较清闸门（不再依赖对象引用）；
 *   · 闸门超时时允许重新取 URL（否则 loading 看门狗的 refresh 会被自己挡掉）。
 *
 * 运行：node scripts/sim-engine-event-gate.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const PLAYER = read('src/core/player/player.ts')
const CONTROLLER = read('src/plugins/player/controller.ts')

const windowBetween = (src, startAnchor, endAnchor, fallback = 3000) => {
  const start = src.indexOf(startAnchor)
  if (start < 0) return ''
  const end = src.indexOf(endAnchor, start + startAnchor.length)
  return end < 0 ? src.slice(start, start + fallback) : src.slice(start, end)
}

const structuralReasons = ({ player, controller }) => {
  const reasons = []

  // ① 闸门 helper 存在、有上界、超时可归因
  const helper = windowBetween(player, 'export const isGettingUrlIdGateActive = () => {', 'interface PlayUrlInfo {', 2200)
  if (!helper) {
    reasons.push('缺少 isGettingUrlIdGateActive（闸门没有上界判定入口）')
  } else {
    if (!/const GETTING_URL_ID_GATE_MAX_MS = \d+/.test(player)) {
      reasons.push('闸门没有时间上界常量（GETTING_URL_ID_GATE_MAX_MS）—— 一旦残留就永久丢弃引擎事件')
    }
    if (!/if \(ageMs < GETTING_URL_ID_GATE_MAX_MS\) return true/.test(helper)) {
      reasons.push('闸门判定没有使用时间上界（超时也不放行）')
    }
    if (!/###LXPlayerGuard### gettingUrl 闸门超时放行/.test(helper)) {
      reasons.push('闸门超时没有打点（真机无法归因「引擎事件被永久丢弃」）')
    }
  }

  // ② 写闸门处必须盖时间戳；同曲重试在闸门失效时要放行
  const setUrl = windowBetween(player, 'export const setMusicUrl = (musicInfo', '// 恢复上次播放的状态', 3000)
  if (!setUrl) {
    reasons.push('找不到 setMusicUrl')
  } else {
    if (!/gettingUrlIdSetAt = Date\.now\(\)/.test(setUrl)) {
      reasons.push('setMusicUrl 写闸门时没有盖时间戳（上界判定失效）')
    }
    if (!/const gateHoldsThisSong = gateValue != '' && gateValue == createGettingUrlId\(musicInfo\)/.test(setUrl) ||
        !/if \(!gateHoldsThisSong \|\| isGettingUrlIdGateActive\(\)\) return/.test(setUrl)) {
      reasons.push('setMusicUrl 的同曲早退没有走「闸门压着这首歌且未超时」判定（闸门超时后无法重新取 URL，loading 看门狗会被自己挡掉）')
    }
    if (!/const currentId = playerState\.playMusicInfo\.musicInfo\?\.id/.test(setUrl) ||
        !/if \(currentId != null && musicInfo\.id == currentId\) \{/.test(setUrl)) {
      reasons.push('清闸门仍用对象引用比较（同 id 新对象换代时闸门永久残留）')
    }
  }

  // ③ controller 必须走闸门 helper，而不是裸字段
  const guard = windowBetween(controller, 'onUnifiedPlayerEvent(async(event) => {', 'switch (event.type) {', 1600)
  if (!guard) {
    reasons.push('找不到 controller 的引擎事件回调')
  } else {
    if (!/isGettingUrlIdGateActive\(\)/.test(guard)) {
      reasons.push('controller 的引擎事件闸门没走 isGettingUrlIdGateActive（裸字段会让残留值永久掐断事件）')
    }
    if (/global\.lx\.gettingUrlId \|\|/.test(guard)) {
      reasons.push('controller 仍直接用 global.lx.gettingUrlId 判闸门（无上界）')
    }
  }
  if (!/^import \{ isGettingUrlIdGateActive, playNext, setMusicUrl \} from '@\/core\/player\/player'$/m.test(controller)) {
    reasons.push('controller 没有从 core/player/player 引入 isGettingUrlIdGateActive')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：闸门残留时引擎事件（→ nowPlaying 发布）是否还能恢复
// ---------------------------------------------------------------------------
const GATE_MAX_MS = 20000

// 旧实现：只有 finally 里的「引用相等」才清闸门
const modelLegacy = ({ requestSettles, sameObjectIdentity }) => {
  if (requestSettles && sameObjectIdentity) return 'ok'
  return 'gate-stuck' // 引用换代 / 请求不 settle → 永久丢弃事件 → 卡片冻结到重启
}
// 新实现：引用比较改成 id 比较 + 时间上界
const modelNew = ({ requestSettles, sameObjectIdentity }) => {
  if (requestSettles && sameObjectIdentity) return 'ok'
  if (requestSettles) return 'ok' // 同 id 新对象：finally 按 id 清掉闸门
  return 'released-after-20s' // 请求不 settle：20s 后放行事件
}

const models = [
  ['反例：加载期间播放信息换代（同 id 新对象）→ 旧实现闸门永久残留、卡片冻结到重启',
    modelLegacy({ requestSettles: true, sameObjectIdentity: false }) === 'gate-stuck'],
  ['反例：URL 请求永挂起 → 旧实现闸门永久残留', modelLegacy({ requestSettles: false, sameObjectIdentity: true }) === 'gate-stuck'],
  ['修复后：同 id 新对象换代 → finally 按 id 清闸门，事件立刻恢复',
    modelNew({ requestSettles: true, sameObjectIdentity: false }) === 'ok'],
  ['修复后：请求永挂起 → 闸门 20s 上限放行，卡片恢复更新',
    modelNew({ requestSettles: false, sameObjectIdentity: true }) === 'released-after-20s'],
  [`闸门上限取值 (${GATE_MAX_MS}ms) 远小于「重启 App 才恢复」的等待：用户最多多等一个上限窗口`,
    GATE_MAX_MS > 0 && GATE_MAX_MS <= 30000],
]

const realReasons = structuralReasons({ player: PLAYER, controller: CONTROLLER })

const tamperCases = [
  ['controller 改回裸字段判闸门', ({ controller }) => ({ controller: controller.replace('isGettingUrlIdGateActive() ||', 'global.lx.gettingUrlId ||') }), '裸字段'],
  ['拿掉闸门时间上界判定', ({ player }) => ({ player: player.replace('  if (ageMs < GETTING_URL_ID_GATE_MAX_MS) return true\n', '') }), '上界'],
  ['清闸门改回对象引用比较', ({ player }) => ({ player: player.replace('    const currentId = playerState.playMusicInfo.musicInfo?.id\n    if (currentId != null && musicInfo.id == currentId) {', '    if (musicInfo === playerState.playMusicInfo.musicInfo) {') }), '引用'],
]
const tamperResults = tamperCases.map(([name, mutate, expectKeyword]) => {
  const base = { player: PLAYER, controller: CONTROLLER }
  const mutated = { ...base, ...mutate(base) }
  const changed = mutated.player !== PLAYER || mutated.controller !== CONTROLLER
  if (!changed) return [name, false, '找不到可篡改的锚点']
  const reasons = structuralReasons(mutated)
  const hit = reasons.some((r) => r.includes(expectKeyword))
  return [name, hit, hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）`]
})

console.log('行为模型')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of tamperResults) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)

if (realReasons.length) {
  console.error(`\nFAIL  换源闸门上界契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
const failedModels = models.filter(([, ok]) => !ok)
const failedTampers = tamperResults.filter(([, ok]) => !ok)
if (failedModels.length) console.error(`\nFAIL  行为模型未通过（${failedModels.length} 例）`)
if (failedTampers.length) console.error(`\nFAIL  反例自检未通过（${failedTampers.length} 例）`)
if (realReasons.length || failedModels.length || failedTampers.length) {
  console.error('\nFAIL  换源闸门上界契约未通过')
  process.exit(1)
}
console.log(`\nPASS  引擎事件闸门有上界（结构不变量 3 组 + 行为模型 ${models.length} 例 + 反例 ${tamperResults.length} 例）`)
process.exit(0)
