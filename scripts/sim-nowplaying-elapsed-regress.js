// 状态机复刻：控制中心「已播放时间」倒退 的根因验证
//
// 机制：iOS 控制中心进度条左侧时间 = MPNowPlayingInfoPropertyElapsedPlaybackTime
//  + 系统按 playbackRate 自行外推。
// 该 elapsedTime 有两个来源：
//   A) JS 发布元数据时携带的 elapsedTime（= 引擎 getStreamingFlacPosition()）
//   B) 原生 currentPlaybackPositionLocked() = playbackAnchorFrame + _renderedFrames
//
// 根因：resetRealtimeRenderStateLocked() 会把 _renderedFrames 清零（line 3131），
// 但它【不清 playbackAnchorFrame】。因此任何「只调 reset 不设 anchor」的路径，
// 都会让 currentPlaybackPositionLocked() 从 (anchor + rendered) 突变到 (anchor + 0)
// = 位置倒退 rendered/sampleRate 秒！
//
// 修法：在 resetRealtimeRenderStateLocked 里做「位置守恒折算」——
//   清零 _renderedFrames 之前，先把 rendered 折进 playbackAnchorFrame，
//   使位置在 reset 前后不变。对 5 个调用方统一安全（见下）。
//
// 本脚本逐一验证 5 条调用路径。

const sampleRate = 44100
const _duration = 240

const makeState = () => ({
  playbackAnchorFrame: 0,
  renderedFrames: 0,
  lastKnownPosition: 0,
  completedFrames: 0,
  sampleRate,
})

const currentPlaybackPosition = (s) => {
  if (s.sampleRate <= 0) return s.lastKnownPosition
  s.completedFrames = s.playbackAnchorFrame + s.renderedFrames
  s.lastKnownPosition = Math.max(0, s.completedFrames / s.sampleRate)
  return s.lastKnownPosition
}

const render = (s, frames) => { s.renderedFrames += frames }

// ---- 旧实现 ----
const resetOld = (s) => { s.renderedFrames = 0 }

// ---- 新实现（位置守恒，仅在流仍有效时折算）----
const resetNew = (s) => {
  const rendered = s.renderedFrames
  if (s.sampleRate > 0 && (s.playbackAnchorFrame !== 0 || rendered !== 0)) {
    const completed = s.playbackAnchorFrame + rendered
    s.completedFrames = completed
    s.playbackAnchorFrame = completed
    s.lastKnownPosition = Math.max(0, completed / s.sampleRate)
  }
  s.renderedFrames = 0
}

let pass = 0; let fail = 0
const check = (name, ok, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`)
  ok ? pass++ : fail++
}

// ============ 路径 ① resetStreamingState（换歌）============
// 真实顺序（AppDelegate.mm:3204+）：
//   ... sampleRate = 0; ... lastKnownPosition = 0; completedFrames = 0;
//   playbackAnchorFrame = 0; → resetRealtimeRenderStateLocked
// 即：sampleRate 与 anchor 都已清零，然后才 reset。此时必须【不】折算，
// 否则会把刚归零的 anchor 又写回旧值，换歌后位置凭空冒出来。
console.log('\n【路径①】resetStreamingState（换歌）— sampleRate/anchor 先归零，再 reset')
{
  const s = makeState()
  render(s, 44100 * 200) // 上一首播到 200s
  // 复刻真实字段清零顺序
  s.sampleRate = 0
  s.lastKnownPosition = 0
  s.completedFrames = 0
  s.playbackAnchorFrame = 0
  resetNew(s)
  const after = currentPlaybackPosition(s)
  check('换歌后位置归零、无残留', after === 0 && s.playbackAnchorFrame === 0,
    `-> ${after.toFixed(1)}s, anchor=${s.playbackAnchorFrame}`)
}

// ============ 路径 ② configureAudioGraphWithSampleRate（首帧配置）============
console.log('\n【路径②】configureAudioGraphWithSampleRate（首帧配置）— anchor/rendered 均为 0')
{
  const s = makeState()
  const before = currentPlaybackPosition(s)
  resetNew(s)
  const after = currentPlaybackPosition(s)
  check('首帧配置无副作用', before === 0 && after === 0, `${before.toFixed(1)}s -> ${after.toFixed(1)}s`)
}

// ============ 路径 ③ applyPendingSeekIfNeeded（seek）============
// reset 之后紧跟着写入 anchor = 目标帧（覆盖折算）
console.log('\n【路径③】applyPendingSeekIfNeeded（seek 到 180s）— reset 后覆盖 anchor')
{
  const s = makeState()
  render(s, 44100 * 60)
  const target = 180
  resetNew(s)
  s.completedFrames = Math.round(target * sampleRate)
  s.playbackAnchorFrame = s.completedFrames // ← 覆盖折算
  s.lastKnownPosition = target
  const after = currentPlaybackPosition(s)
  check('落点正确', Math.abs(after - target) < 0.001, `-> ${after.toFixed(1)}s`)
}

// ============ 路径 ④ seekToPosition（seek）============
console.log('\n【路径④】seekToPosition（seek 到 30s）— reset 后覆盖 anchor')
{
  const s = makeState()
  render(s, 44100 * 120)
  const target = 30
  s.lastKnownPosition = target
  resetNew(s)
  s.completedFrames = Math.round(target * sampleRate)
  s.playbackAnchorFrame = s.completedFrames // ← 覆盖折算
  const after = currentPlaybackPosition(s)
  check('落点正确（允许后退，是用户主动 seek）', Math.abs(after - target) < 0.001, `-> ${after.toFixed(1)}s`)
}

// ============ 路径 ⑤ cleanupAudioGraphLocked（停止）============
// 关键：此前完全没有设置 anchor，是 bug 所在
console.log('\n【路径⑤】cleanupAudioGraphLocked ← stopStreamingInternal（停止）— 核心修复点')
{
  // 旧实现
  const sOld = makeState()
  render(sOld, 44100 * 120)
  const beforeOld = currentPlaybackPosition(sOld)
  resetOld(sOld)
  const afterOld = currentPlaybackPosition(sOld)
  check('旧实现复现倒退', afterOld < beforeOld,
    `${beforeOld.toFixed(1)}s -> ${afterOld.toFixed(1)}s（倒退 ${(beforeOld - afterOld).toFixed(1)}s）`)

  // 新实现
  const sNew = makeState()
  render(sNew, 44100 * 120)
  const beforeNew = currentPlaybackPosition(sNew)
  resetNew(sNew)
  const afterNew = currentPlaybackPosition(sNew)
  check('新实现位置守恒', Math.abs(afterNew - beforeNew) < 0.001,
    `${beforeNew.toFixed(1)}s -> ${afterNew.toFixed(1)}s`)
}

// ============ 回归：多次反复 stop/start 不累积漂移 ============
console.log('\n【回归】反复渲染/清理 10 轮，位置不漂移')
{
  const s = makeState()
  let ok = true
  for (let i = 0; i < 10; i++) {
    render(s, 44100 * 5) // 每轮播 5s
    const before = currentPlaybackPosition(s)
    resetNew(s)
    const after = currentPlaybackPosition(s)
    if (Math.abs(after - before) > 0.001) { ok = false; break }
  }
  const final = currentPlaybackPosition(s)
  check('累计位置 = 50s', ok && Math.abs(final - 50) < 0.001, `-> ${final.toFixed(1)}s`)
}

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
process.exit(fail === 0 ? 0 : 1)
