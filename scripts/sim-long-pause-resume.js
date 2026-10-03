/**
 * sim-long-pause-resume.js
 *
 * 「暂停久了再播放，歌词与音频不同步」契约（2026-10-03 用户反馈）。
 *
 * 成因：暂停够久后引擎的缓冲/连接被系统回收，恢复出声时「引擎报告位置」与
 * 「实际可听位置」可能出现固定偏移（与在线源 seek 落点偏差同一类）。而所有自愈网
 * （1s 慢校准 / 4Hz 快路径 / 行级探针）都以**报告位置**为真值——它们只能把歌词
 * 对齐到偏移后的位置，永远修不回「歌词 ↔ 可听内容」。项目对这类偏差的既有解法是
 * 「出声回拉」：把音频重新精确 seek 到意图位置（seek 已补零容差 + 偏离>0.2s 重试，
 * 落点即出声点）。
 *
 * 修法（src/core/init/player/playProgress.ts）：
 *   ① 真实暂停（engine state=paused 且 driver=trackPlayer）时记录暂停位置为恢复意图；
 *      buffering 引发的 pause 不记（缓冲卡点由 mediaBuffer 机制负责）；
 *   ② 恢复出声（playing）时若暂停 ≥ LONG_PAUSE_RESUME_MIN_MS，把音频精确拉回暂停位置
 *      一次；nativeFlac（位置=帧累加「已播」语义）与本地文件跳过；
 *   ③ 意图在每次出声时消费（不够久/不适用也丢弃，绝不留到后续 buffering→playing
 *      的迟到事件——否则会在播放中途凭空把音频拉回旧位置）；
 *   ④ 用户自己 seek / 切歌停播时即刻作废。
 *
 * 运行：node scripts/sim-long-pause-resume.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const PLAY_PROGRESS = 'src/core/init/player/playProgress.ts'
const real = fs.readFileSync(path.join(ROOT, PLAY_PROGRESS), 'utf8').replace(/\r\n/g, '\n')

/** 取某个函数/分支到下一个锚点之间的窗口（结构断言只关心窗口内是否具备某条件） */
const windowBetween = (src, startAnchor, endAnchor, fallback = 2000) => {
  const start = src.indexOf(startAnchor)
  if (start < 0) return ''
  const end = src.indexOf(endAnchor, start + startAnchor.length)
  return end < 0 ? src.slice(start, start + fallback) : src.slice(start, end)
}

const invariants = (src) => {
  const reasons = []

  const minMatch = src.match(/const LONG_PAUSE_RESUME_MIN_MS = (\d+)/)
  if (!minMatch) {
    reasons.push('缺 LONG_PAUSE_RESUME_MIN_MS（长暂停门槛，短暂停不该多做一次 seek）')
  } else if (Number(minMatch[1]) < 1000) {
    reasons.push(`LONG_PAUSE_RESUME_MIN_MS=${minMatch[1]} 过小（正常暂停恢复也会被当成故障恢复）`)
  }
  if (!/let pauseResumePosition: number \| null = null/.test(src) || !/let pauseResumeAt = 0/.test(src)) {
    reasons.push('缺暂停恢复意图状态（pauseResumePosition / pauseResumeAt）')
  }

  // ① 只认真实暂停（且 trackPlayer 驱动）
  const pausedCase = windowBetween(src, "      case 'paused':", "      case 'buffering':")
  if (!/if \(event\.state === 'paused' && event\.driver == 'trackPlayer'\) \{[\s\S]{0,400}?pauseResumePosition = pausedPosition > 0 \? pausedPosition : null/.test(pausedCase)) {
    reasons.push('暂停意图记录未限定「真实 paused + trackPlayer 驱动」（buffering 卡点/nativeFlac 会误入）')
  }

  // ② 恢复出声：门槛 + 驱动/源类型门控 + 精确 seek，且消费意图
  const playingCase = windowBetween(src, "      case 'playing': {", "      case 'buffering':")
  const recovery = windowBetween(playingCase, 'if (pauseResumePosition != null) {', 'break', 800)
  if (!/const pauseDurationMs = Date\.now\(\) - pauseResumeAt/.test(recovery) ||
      !/pauseResumePosition = null/.test(recovery) ||
      !/pauseDurationMs >= LONG_PAUSE_RESUME_MIN_MS/.test(recovery)) {
    reasons.push('恢复出声缺少「暂停时长门槛 + 消费意图」（可能空转或把意图留给迟到事件）')
  }
  if (!/event\.driver == 'trackPlayer'/.test(recovery) || !/!isLocalTrack/.test(recovery)) {
    reasons.push('长暂停恢复没有排除 nativeFlac / 本地文件（多一次无谓 seek）')
  }
  if (!/void setCurrentTime\(recoveryTime\)/.test(recovery)) {
    reasons.push('长暂停恢复没有把音频精确拉回暂停位置（只锚歌词修不回可听位置）')
  }
  if (!/lastSeekIntentAt = Date\.now\(\)/.test(recovery) || !/pullBackCount = 0/.test(recovery)) {
    reasons.push('长暂停恢复没有刷新 seek 意图基准（缓冲看门狗会把恢复缓冲当卡点探测）')
  }

  // ③ 顺序：先走既有「seek 回拉」，再走长暂停恢复
  const pullBackAt = playingCase.indexOf('const resumeTime = restorePlayTime')
  const recoveryAt = playingCase.indexOf('if (pauseResumePosition != null) {')
  if (pullBackAt < 0 || recoveryAt < 0 || pullBackAt > recoveryAt) {
    reasons.push('长暂停恢复没有排在既有 seek 回拉之后（seek 意图优先，避免互相打架）')
  }

  // ④ 用户 seek / 切歌停播即作废
  const setProgressWindow = windowBetween(src, 'const setProgress = (time: number, maxTime?: number) => {', 'void setCurrentTime(time).then(', 1600)
  if (!/pauseResumePosition = null/.test(setProgressWindow)) {
    reasons.push('用户自己 seek 后没有作废暂停恢复意图（恢复出声会把音频拉回暂停前位置）')
  }
  const stopWindow = windowBetween(src, 'const handleStop = () => {', 'const handleError = () => {', 1600)
  if (!/pauseResumePosition = null/.test(stopWindow)) {
    reasons.push('切歌/停播没有清暂停恢复意图（残留会打到下一首）')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：1:1 复刻实现（记录 / 消费 / 门槛 / 门控）
// ---------------------------------------------------------------------------
const makeState = () => ({ pauseResumePosition: null, pauseResumeAt: 0 })
const recordPause = (state, position, at) => {
  state.pauseResumePosition = position > 0 ? position : null
  state.pauseResumeAt = state.pauseResumePosition == null ? 0 : at
}
const userSeek = (state) => {
  state.pauseResumePosition = null
  state.pauseResumeAt = 0
}
const userStop = (state) => userSeek(state)
const handlePlaying = (state, { now, minMs = 5000, driver = 'trackPlayer', local = false }) => {
  let seek = null
  if (state.pauseResumePosition != null) {
    const recoveryTime = state.pauseResumePosition
    const pauseDurationMs = now - state.pauseResumeAt
    state.pauseResumePosition = null
    state.pauseResumeAt = 0
    if (pauseDurationMs >= minMs && recoveryTime > 0 && driver === 'trackPlayer' && !local) seek = recoveryTime
  }
  return seek
}

const models = []
{
  const state = makeState()
  recordPause(state, 120, 1000)
  const seek = handlePlaying(state, { now: 4000 })
  models.push([
    '短暂停（3s）→ 不触发恢复 seek，且意图被消费（不会留给迟到的 playing）',
    seek === null && state.pauseResumePosition === null,
  ])
}
{
  const state = makeState()
  recordPause(state, 120, 1000)
  const first = handlePlaying(state, { now: 31000 })
  const second = handlePlaying(state, { now: 31200 })
  models.push([
    '长暂停（30s）→ 恢复出声时精确 seek 回暂停位置一次，之后的 playing 不再重复',
    first === 120 && second === null,
  ])
}
{
  const state = makeState()
  recordPause(state, 120, 1000)
  userSeek(state)
  const seek = handlePlaying(state, { now: 61000 })
  models.push([
    '暂停中用户自己 seek → 意图作废，恢复出声不再拉回旧位置',
    seek === null && state.pauseResumePosition === null,
  ])
}
{
  const state = makeState()
  recordPause(state, 120, 1000)
  const nativeSeek = handlePlaying(state, { now: 61000, driver: 'nativeFlac' })
  const state2 = makeState()
  recordPause(state2, 120, 1000)
  const localSeek = handlePlaying(state2, { now: 61000, local: true })
  models.push([
    'nativeFlac / 本地文件 → 跳过恢复 seek（各自位置语义已正确）',
    nativeSeek === null && localSeek === null && state2.pauseResumePosition === null,
  ])
}
{
  const state = makeState()
  recordPause(state, 120, 1000)
  userStop(state)
  const seek = handlePlaying(state, { now: 61000 })
  models.push(['切歌/停播 → 意图清空，不会打到下一首', seek === null])
}

const failedModels = models.filter(([, ok]) => !ok)

// ---------------------------------------------------------------------------
// 反例自检
// ---------------------------------------------------------------------------
const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.split(find).join(replace)
}
const cases = []
const checkCase = (name, src, expectSubstr) => {
  let reasons = []
  try {
    reasons = invariants(src)
  } catch (err) {
    cases.push([name, false, `抛异常: ${err.message}`])
    return
  }
  const hit = reasons.some((r) => r.includes(expectSubstr))
  cases.push([name, hit, hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）`])
}

checkCase('C1 去掉长暂停门槛（短暂停也强制 seek）',
  tamper(real, 'if (pauseDurationMs >= LONG_PAUSE_RESUME_MIN_MS && recoveryTime > 0', 'if (recoveryTime > 0'),
  '缺少「暂停时长门槛')

checkCase('C2 暂停意图不区分真实暂停/驱动',
  tamper(real, "if (event.state === 'paused' && event.driver == 'trackPlayer') {", 'if (true) {'),
  '未限定「真实 paused')

checkCase('C3 意图不消费（留给后续 playing）',
  tamper(real, '          pauseResumePosition = null\n          pauseResumeAt = 0\n          const currentMusicInfo', '          const currentMusicInfo'),
  '消费意图')

checkCase('C4 用户 seek 后不作废意图',
  tamper(real, '    // 用户自己 seek 了：暂停恢复意图作废（新落点才是意图位置）\n    pauseResumePosition = null\n    pauseResumeAt = 0\n', ''),
  '用户自己 seek 后没有作废')

const missed = cases.filter(([, ok]) => !ok)

console.log('行为模型（暂停 → 恢复出声）')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of cases) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')

let failed = 0
const realReasons = invariants(real)
if (realReasons.length) {
  console.error(`FAIL  长暂停恢复同步契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
  failed += 1
}
if (failedModels.length) {
  console.error(`FAIL  行为模型未通过（${failedModels.length} 项）`)
  failed += 1
}
if (missed.length) {
  console.error(`FAIL  有反例未被拦下（${missed.length} 项，断言无区分力）`)
  failed += 1
}
if (!failed) {
  console.log(`PASS  长暂停恢复同步契约通过（结构不变量 4 组 + 行为模型 ${models.length} 例 + 反例 ${cases.length} 例）`)
  process.exit(0)
}
process.exit(1)
