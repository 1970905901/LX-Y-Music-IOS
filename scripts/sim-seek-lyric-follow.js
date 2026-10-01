#!/usr/bin/env node
/**
 * sim-seek-lyric-follow.js —— seek 后「歌词跟随正在出声的音频」守卫
 *
 * 背景（对齐上游 lx-m 桌面版 seek→歌词时序）：
 * - 上游 setProgress 不碰歌词；audio 元素 seek 后 `waiting`→lrc.pause()（歌词冻在
 *   当前行）、真正从落点出声时 `playing`→lrc.play(引擎绝对时间)（歌词跳到落点行）。
 *   歌词永远跟「正在出声的位置」，从不在音频之前跳。
 * - 旧实现（回归版）在 seek 瞬间 syncLyric(目标)+hold(目标)：引擎还在放旧内容/
 *   静音缓冲的整个窗口里（nativeFlac 重新解码可达数秒），App 内歌词已显示目标行
 *   ——「快进/快退后歌词与音频不同步」。
 * - 新实现：seek 只立即跳进度条（nowPlayTime），歌词时钟不干涉；setCurrentTime
 *   resolve 后按引擎状态分派（playing→立即重锚落点 / buffering|paused→自冻结当前
 *   行）；轮询缓冲期按时钟锚点分派——已有锚点自冻结（nativeFlac 缓冲期 position
 *   回报的是 seek 目标，直接 hold(position) 会把行提前拽到目标行），无锚点（恢复
 *   进度起播）保持 hold(引擎位置) 旧行为。
 *
 * 每条关键断言用旧模型跑出反例（旧行为必须使断言失败），验证脚本区分力。
 */
'use strict'

// ---------------------------------------------------------------------------
// 模型组件（1:1 复刻 src/core 侧语义，时间单位：模型内 ms）
// ---------------------------------------------------------------------------

/** AudioClock 复刻（src/core/player/audioClock.ts） */
function createClock() {
  return {
    anchorPositionMs: 0,
    anchorSystemMs: 0,
    rate: 1,
    playing: false,
    holding: false,
    holdMs: 0,
    get hasAnchor() { return this.anchorSystemMs > 0 },
    setAnchor(positionMs, rate = 1, playing = true) {
      this.anchorPositionMs = positionMs
      this.anchorSystemMs = nowMs
      this.rate = rate
      this.playing = playing
      this.holding = false
    },
    hold(ms) {
      this.holding = true
      this.holdMs = ms
    },
    getTime() {
      if (this.holding) return this.holdMs
      if (!this.playing) return this.anchorPositionMs
      return this.anchorPositionMs + (nowMs - this.anchorSystemMs) * this.rate
    },
  }
}

/** 歌词行引擎复刻（times 秒升序；findLineIndexByTime 语义） */
function createLyric(timesSec) {
  return {
    times: timesSec.map(s => s * 1000),
    line: -1,
    lineAt(ms) {
      const ts = this.times
      if (!ts.length || ms <= ts[0]) return 0
      let lo = 0
      let hi = ts.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (ts[mid] <= ms) lo = mid + 1
        else hi = mid
      }
      return ts[lo] > ms ? lo - 1 : lo
    },
    syncTo(ms) {
      const next = this.lineAt(ms)
      if (next !== this.line) this.line = next
    },
  }
}

/** 引擎复刻：可编排的 state/position（nativeFlac seek 后 position 立即=目标） */
function createEngine() {
  return {
    state: 'playing',
    pos: 0,
    seekResolvePosition: null,
    getPosition() { return this.pos },
    getState() { return this.state },
  }
}

// 虚拟时钟：setTimeout 以「待办队列 + 推进」模拟
let nowMs = 0
const timers = []
function after(ms, fn) { timers.push({ at: nowMs + ms, fn }) }
function runUntil(untilMs) {
  for (;;) {
    timers.sort((a, b) => a.at - b.at)
    const next = timers[0]
    if (!next || next.at > untilMs) {
      nowMs = Math.max(nowMs, untilMs)
      return
    }
    timers.shift()
    nowMs = next.at
    next.fn()
  }
}

/**
 * 播放进度状态机复刻（playProgress.ts 的 seek 相关子集）。
 * variant='old' = 回归前行为；variant='new' = 对齐上游后行为。
 */
function createProgress({ variant, lyric, clock, engine, isPlayRef }) {
  let seekTargetPosition = null
  let seekHoldUntil = 0

  const state = { uiNowPlayTime: 0, recoveredPublishes: 0 }

  const setNowPlayTime = (t) => { state.uiNowPlayTime = t }
  const syncLyric = (time) => { lyric.syncTo(time * 1000) }

  const getCurrentTime = () => {
    const position = engine.getPosition()
    // seek 生效窗口
    if (seekTargetPosition != null && nowMs < seekHoldUntil) {
      if (Math.abs(position - seekTargetPosition) >= 1.5) {
        if (variant === 'old') clock.hold(seekTargetPosition * 1000) // 旧：冻到目标行
        return // 新：只拦 UI 发布，不干涉歌词时钟
      }
      seekTargetPosition = null
      seekHoldUntil = 0
    }
    setNowPlayTime(position)
    const engineState = engine.getState()
    const isBuffering = engineState === 'buffering' || engineState === 'loading'
    if (!isPlayRef.value) return
    if (isBuffering) {
      // 缓冲分支：旧=hold(引擎位置)；新=有时钟锚点自冻结 / 无锚点锚引擎位置
      if (variant === 'old') {
        clock.hold(position * 1000)
      } else {
        clock.hold((clock.hasAnchor ? clock.getTime() : position) * 1000)
      }
      return
    }
    clock.setAnchor(position * 1000, 1, isPlayRef.value)
    lyric.syncTo(position * 1000)
    state.recoveredPublishes++
  }

  const scheduleFastResync = () => {
    after(300, () => { getCurrentTime() })
  }

  const setProgress = (time) => {
    setNowPlayTime(time)
    if (variant === 'old') {
      // 旧：立即冻时钟到目标 + 歌词跳目标行（回归行为）
      clock.hold(time * 1000)
      syncLyric(time)
    }
    // 新：不碰时钟、不碰歌词。两版共用：seek 窗口（拦旧位置进 UI）
    seekTargetPosition = time
    seekHoldUntil = nowMs + 2000

    // setCurrentTime(time).then(targetPosition => ...)
    after(20, () => {
      const targetPosition = engine.seekResolvePosition != null ? engine.seekResolvePosition : time
      setNowPlayTime(targetPosition)
      seekTargetPosition = targetPosition
      seekHoldUntil = nowMs + 2000
      // 引擎状态分派（new；旧版在此无条件 hold(落点)+syncLyric(落点)）
      if (variant === 'new') {
        after(30, () => {
          if (engine.getState() === 'playing' && isPlayRef.value) {
            clock.hold(targetPosition * 1000)
            syncLyric(targetPosition)
          } else {
            clock.hold(clock.getTime())
          }
        })
      } else {
        clock.hold(targetPosition * 1000)
        syncLyric(targetPosition)
      }
      scheduleFastResync()
    })
  }

  return { setProgress, getCurrentTime, state }
}

// ---------------------------------------------------------------------------
// 断言框架
// ---------------------------------------------------------------------------
let passCount = 0
let failCount = 0
function check(name, fn) {
  try {
    fn()
    passCount++
    console.log(`  PASS  ${name}`)
  } catch (err) {
    failCount++
    console.log(`  FAIL  ${name}\n        ${err.message}`)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg) }

/**
 * 场景 A：nativeFlac 型 seek——seekTo 同步置 buffering、position 立即=目标，
 * 解码数秒后才出声。时间线：t=0 seek → t=20 resolve → t=50 状态分派 →
 * t=350 快路径 → t=2000 出声前最后一查 → t=2010 出声 → t=2020 出声确认。
 */
function runNativeFlacSeek(variant) {
  nowMs = 0
  timers.length = 0
  const lyric = createLyric([0, 10, 20, 30, 40, 50])
  const clock = createClock()
  const engine = createEngine()
  const isPlayRef = { value: true }
  engine.pos = 5
  clock.setAnchor(5000, 1, true) // 正在播放 5s 处
  lyric.syncTo(5000)
  engine.seekResolvePosition = 35
  const progress = createProgress({ variant, lyric, clock, engine, isPlayRef })

  progress.setProgress(35)
  const atSeek = { ui: progress.state.uiNowPlayTime, line: lyric.line }

  engine.state = 'buffering' // nativeFlac seekTo 同步置 buffering
  engine.pos = 35 // position 模型立即=目标
  runUntil(100)
  const afterDispatch = { line: lyric.line, engineState: engine.getState() }

  runUntil(2000) // 350ms 快路径 + 缓冲期（模拟多轮轮询：手动 tick）
  progress.getCurrentTime(); progress.getCurrentTime()
  const duringBuffering = { line: lyric.line }

  engine.state = 'playing' // 解码完成，从落点出声
  engine.pos = 35.4
  progress.getCurrentTime()
  const afterSound = { line: lyric.line, ui: progress.state.uiNowPlayTime }

  return {
    atSeek,
    afterDispatch,
    duringBuffering,
    afterSound,
    targetLine: lyric.lineAt(35000),
    oldLine: lyric.lineAt(5300),
  }
}

/** 场景 B：AVPlayer 秒落——seekTo 稳定确认后才 resolve，resolve 时已 playing */
function runAvPlayerInstantSeek() {
  nowMs = 0
  timers.length = 0
  const lyric = createLyric([0, 10, 20, 30, 40, 50])
  const clock = createClock()
  const engine = createEngine()
  const isPlayRef = { value: true }
  engine.pos = 5
  clock.setAnchor(5000, 1, true)
  lyric.syncTo(5000)
  engine.seekResolvePosition = 35.2
  engine.state = 'playing'
  const progress = createProgress({ variant: 'new', lyric, clock, engine, isPlayRef })

  progress.setProgress(35)
  runUntil(100) // resolve(20) + 状态分派(50) 完成，快路径(350)未到
  const afterDispatch = { line: lyric.line }

  engine.pos = 35.3
  runUntil(400)
  const afterFastResync = { line: lyric.line, ui: progress.state.uiNowPlayTime }
  return { afterDispatch, afterFastResync, targetLine: lyric.lineAt(35200) }
}

/** 场景 C：暂停态 seek——歌词不动，恢复播放且出声后跳落点 */
function runPausedSeek(variant) {
  nowMs = 0
  timers.length = 0
  const lyric = createLyric([0, 10, 20, 30, 40, 50])
  const clock = createClock()
  const engine = createEngine()
  const isPlayRef = { value: false }
  engine.pos = 5
  clock.setAnchor(5000, 1, false)
  lyric.syncTo(5000)
  engine.seekResolvePosition = 35
  const progress = createProgress({ variant, lyric, clock, engine, isPlayRef })

  progress.setProgress(35)
  runUntil(100)
  const pausedAfterSeek = { line: lyric.line }

  isPlayRef.value = true
  engine.state = 'playing'
  engine.pos = 35.2
  progress.getCurrentTime()
  const afterResume = { line: lyric.line }
  return { pausedAfterSeek, afterResume, targetLine: lyric.lineAt(35000), oldLine: lyric.lineAt(5000) }
}

/** 场景 D：setProgress 与 setCurrentTime resolve 之间引擎仍报旧位置（seek 未生效） */
function runStaleWindow(variant) {
  nowMs = 0
  timers.length = 0
  const lyric = createLyric([0, 10, 20, 30, 40, 50])
  const clock = createClock()
  const engine = createEngine()
  const isPlayRef = { value: true }
  engine.pos = 5
  clock.setAnchor(5000, 1, true)
  lyric.syncTo(5000)
  engine.seekResolvePosition = 35
  const progress = createProgress({ variant, lyric, clock, engine, isPlayRef })

  progress.setProgress(35)
  // 此时（resolve 前）轮询：引擎还在放旧内容（6s 处继续出声）
  engine.pos = 6
  progress.getCurrentTime()
  return { ui: progress.state.uiNowPlayTime, line: lyric.line, targetLine: lyric.lineAt(35000), oldLine: lyric.lineAt(6000) }
}

/** 场景 E：非 seek 的恢复进度起播缓冲——时钟无锚点，缓冲期仍锚到引擎位置 */
function runRestoreBuffering(variant) {
  nowMs = 0
  timers.length = 0
  const lyric = createLyric([0, 10, 20, 30, 40, 50])
  const clock = createClock() // 全新时钟，无锚点
  const engine = createEngine()
  const isPlayRef = { value: true }
  engine.pos = 120
  engine.state = 'buffering' // 恢复进度起播即缓冲
  const progress = createProgress({ variant, lyric, clock, engine, isPlayRef })

  progress.getCurrentTime() // 起播轮询（无 seek 窗口）
  return { heldMs: clock.getTime() }
}

/** 场景 F：nativeFlac 快退（35s→5s）——方向无关性显式回归守卫 */
function runNativeFlacRewind(variant) {
  nowMs = 0
  timers.length = 0
  const lyric = createLyric([0, 10, 20, 30, 40, 50])
  const clock = createClock()
  const engine = createEngine()
  const isPlayRef = { value: true }
  engine.pos = 35
  clock.setAnchor(35000, 1, true) // 正在播放 35s 处
  lyric.syncTo(35000)
  engine.seekResolvePosition = 5
  const progress = createProgress({ variant, lyric, clock, engine, isPlayRef })

  progress.setProgress(5) // 快退到 5s
  const atSeek = { line: lyric.line }

  engine.state = 'buffering' // seekTo 同步置 buffering
  engine.pos = 5 // position 模型立即=目标（回退方向同样立即回报）
  runUntil(100)
  const afterDispatch = { line: lyric.line }

  runUntil(2000)
  progress.getCurrentTime(); progress.getCurrentTime()
  const duringBuffering = { line: lyric.line }

  engine.state = 'playing' // 回退解码完成，从 5s 出声
  engine.pos = 5.3
  progress.getCurrentTime()
  const afterSound = { line: lyric.line }
  return {
    atSeek,
    afterDispatch,
    duringBuffering,
    afterSound,
    targetLine: lyric.lineAt(5300),
    oldLine: lyric.lineAt(35300),
  }
}

/** 场景 G：nativeFlac seek 缓冲期控制中心原生歌词时钟（AppDelegate.mm LXNowPlayingClockHold）
 *  原生时钟 = 锚点+速率外推；JS 正速率发布解冻并重锚（「见正 playbackRate 即解除」）。
 *  nativeFlac 的 emitState 只发 JS 桥，原生时钟收不到生命周期事件 → 冻结只能由
 *  seekTo 显式置位（新模型）；旧行为不置位 = 整个重解码缓冲期从旧位置继续外推。
 *  时间线：t=0 锚在 8s 播放中 → t=1000 快退 seek(目标 5s) → 缓冲解码 →
 *  t=3600 出声 → t=3900 JS 确认 playing 发布正速率+带戳真实位置 5.3s。 */
function runNativeClockDuringSeek({ holdOnSeek }) {
  nowMs = 0
  const lyric = createLyric([0, 10, 20, 30, 40, 50])
  const nc = {
    anchorMs: 8000,
    anchorSys: 0,
    rate: 1,
    hold: false,
    line: -1,
    position(ms) { return this.hold ? this.anchorMs : this.anchorMs + (ms - this.anchorSys) * this.rate },
    sync() { const i = lyric.lineAt(this.position(nowMs)); if (i !== this.line) this.line = i },
  }
  nc.sync() // 播放中：时钟锚在 8s，外推
  nowMs = 1000
  if (holdOnSeek) nc.hold = true // 新：seekTo 置 LXNowPlayingClockHold=YES
  nowMs = 3500 // 缓冲解码 2.5s（无任何 JS 正速率发布：在App时钟冻结 → 无行变化元数据）
  nc.sync()
  const duringBuffering = { line: nc.line, posMs: Math.round(nc.position(3500)) }
  nowMs = 3900 // 出声后 JS 发布：正速率 + 带戳真实落点 5.3s
  nc.anchorMs = 5600; nc.anchorSys = 3900; nc.rate = 1
  if (nc.rate > 0) nc.hold = false // 「见正 playbackRate 即解除」
  nc.sync()
  const afterSound = { line: nc.line }
  return { duringBuffering, afterSound, atSeekLine: lyric.lineAt(8000), driftedLine: lyric.lineAt(10500), targetLine: lyric.lineAt(5600) }
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------
console.log('sim-seek-lyric-follow：seek 后歌词跟随正在出声的音频（对齐上游 waiting→冻结 / playing→重锚）\n')

console.log('[场景 A] nativeFlac 型 seek（缓冲期 position 已=目标）')
const newA = runNativeFlacSeek('new')
const oldA = runNativeFlacSeek('old')
check('A1 新模型：seek 瞬间进度条 UI 立即跳目标（上游 audio.currentTime 语义）', () => {
  assert(newA.atSeek.ui === 35, `ui=${newA.atSeek.ui} 应=35`)
})
check('A2 新模型：seek 瞬间歌词行不跳（仍停在正在出声的旧行）', () => {
  assert(newA.atSeek.line === newA.oldLine, `line=${newA.atSeek.line} 应=${newA.oldLine}`)
})
check('A2x 反例：旧模型 seek 瞬间歌词行已跳到目标行（回归行为可被 A2 捕获）', () => {
  assert(oldA.atSeek.line === oldA.targetLine, `旧模型 line=${oldA.atSeek.line} 预期=回归行为目标行 ${oldA.targetLine}（若不等则脚本无区分力）`)
})
check('A3 新模型：resolve 后引擎 buffering，状态分派自冻结，歌词行不跳', () => {
  assert(newA.afterDispatch.engineState === 'buffering', `state=${newA.afterDispatch.engineState}`)
  assert(newA.afterDispatch.line === newA.oldLine, `line=${newA.afterDispatch.line} 应=${newA.oldLine}`)
})
check('A4 新模型：缓冲解码期多轮轮询（引擎报目标 35、窗口已关）歌词行仍不提前跳', () => {
  assert(newA.duringBuffering.line === newA.oldLine, `line=${newA.duringBuffering.line} 应=${newA.oldLine}（窗口关闭后缓冲轮询 hold(position) 会把行拽到目标行）`)
})
check('A4x 反例：旧模型缓冲期歌词行已在目标行（回归行为可被 A4 捕获）', () => {
  assert(oldA.duringBuffering.line === oldA.targetLine, `旧模型 line=${oldA.duringBuffering.line} 预期=回归行为目标行 ${oldA.targetLine}（若不等则脚本无区分力）`)
})
check('A5 新模型：引擎从落点出声后歌词行跳到落点行（playing→重锚）', () => {
  assert(newA.afterSound.line === newA.targetLine, `line=${newA.afterSound.line} 应=${newA.targetLine}`)
  assert(newA.afterSound.ui >= 35, `ui=${newA.afterSound.ui} 应≥35`)
})

console.log('\n[场景 B] AVPlayer 秒落（resolve 时已 playing）')
const newB = runAvPlayerInstantSeek()
check('B1 新模型：resolve 状态分派立即重锚到落点行（~50ms，不等轮询）', () => {
  assert(newB.afterDispatch.line === newB.targetLine, `line=${newB.afterDispatch.line} 应=${newB.targetLine}`)
})
check('B2 新模型：快路径后行保持落点行、UI 在落点', () => {
  assert(newB.afterFastResync.line === newB.targetLine, `line=${newB.afterFastResync.line}`)
  assert(newB.afterFastResync.ui >= 35, `ui=${newB.afterFastResync.ui} 应≥35`)
})

console.log('\n[场景 C] 暂停态 seek')
const newC = runPausedSeek('new')
check('C1 新模型：暂停态 seek 歌词行不动（上游 paused 不重锚）', () => {
  assert(newC.pausedAfterSeek.line === newC.oldLine, `line=${newC.pausedAfterSeek.line} 应=${newC.oldLine}`)
})
check('C2 新模型：恢复播放且引擎出声后行跳到落点行', () => {
  assert(newC.afterResume.line === newC.targetLine, `line=${newC.afterResume.line} 应=${newC.targetLine}`)
})

console.log('\n[场景 D] resolve 前引擎仍报旧位置（seek 未生效）')
const newD = runStaleWindow('new')
const oldD = runStaleWindow('old')
check('D1 新模型：窗口内旧位置不刷进进度条 UI（防抽帧保护保留）', () => {
  assert(newD.ui === 35, `ui=${newD.ui} 应=35`)
})
check('D2 新模型：窗口内不干涉歌词时钟（歌词跟随正在出声的旧音频）', () => {
  assert(newD.line === newD.oldLine, `line=${newD.line} 应=${newD.oldLine}（旧侧），不得=目标行 ${newD.targetLine}`)
})
check('D2x 反例：旧模型窗口内歌词行已在目标行（回归行为可被 D2 捕获）', () => {
  assert(oldD.line === oldD.targetLine, `旧模型 line=${oldD.line} 预期=回归行为目标行 ${oldD.targetLine}（若不等则脚本无区分力）`)
})

console.log('\n[场景 E] 非 seek 恢复进度起播缓冲（旧行为保留）')
const newE = runRestoreBuffering('new')
const oldE = runRestoreBuffering('old')
check('E1 新模型：时钟无锚点时缓冲期锚到引擎位置（恢复进度的行同步依赖它）', () => {
  assert(Math.abs(newE.heldMs - 120000) < 1, `heldMs=${newE.heldMs} 应=120000`)
})
check('E1x 反例：旧模型同场景行为一致（确认此路径两版等价、非回归点）', () => {
  assert(Math.abs(oldE.heldMs - 120000) < 1, `heldMs=${oldE.heldMs}`)
})

console.log('\n[场景 F] nativeFlac 快退（35s→5s，方向无关性）')
const newF = runNativeFlacRewind('new')
const oldF = runNativeFlacRewind('old')
check('F1 新模型：快退瞬间歌词行不跳（仍停在 35s 正在出声的行）', () => {
  assert(newF.atSeek.line === newF.oldLine, `line=${newF.atSeek.line} 应=${newF.oldLine}`)
})
check('F2 新模型：回退重解码缓冲期（position 已报目标 5s）歌词行不提前跳', () => {
  assert(newF.afterDispatch.line === newF.oldLine, `dispatch line=${newF.afterDispatch.line}`)
  assert(newF.duringBuffering.line === newF.oldLine, `buffering line=${newF.duringBuffering.line}（hold(position=5) 会把行提前拽回 5s）`)
})
check('F3 新模型：回退出声后歌词行跳到 5s 落点行（playing→重锚）', () => {
  assert(newF.afterSound.line === newF.targetLine, `line=${newF.afterSound.line} 应=${newF.targetLine}`)
})
check('F3x 反例：旧模型快退缓冲期歌词行已在目标行（回归行为可被 F2 捕获）', () => {
  assert(oldF.duringBuffering.line === oldF.targetLine, `旧模型 line=${oldF.duringBuffering.line} 预期=回归行为目标行 ${oldF.targetLine}（若不等则脚本无区分力）`)
})

console.log('\n[场景 G] nativeFlac seek 缓冲期控制中心原生歌词时钟（LXNowPlayingClockHold）')
const newG = runNativeClockDuringSeek({ holdOnSeek: true })
const oldG = runNativeClockDuringSeek({ holdOnSeek: false })
check('G1 新模型：seek 置 hold 后，缓冲期原生时钟冻结，控制中心歌词行停在旧行', () => {
  assert(newG.duringBuffering.line === newG.atSeekLine, `line=${newG.duringBuffering.line} 应=${newG.atSeekLine}`)
  assert(newG.duringBuffering.posMs === 8000, `pos=${newG.duringBuffering.posMs} 应冻结在 8000`)
})
check('G1x 反例：旧模型（seekTo 不置 hold）缓冲期原生时钟继续外推，行已越过旧行（回归行为可被 G1 捕获）', () => {
  assert(oldG.duringBuffering.posMs > 8000, `pos=${oldG.duringBuffering.posMs} 预期已外推越过 8000（若相等则脚本无区分力）`)
  assert(oldG.duringBuffering.line === oldG.driftedLine, `line=${oldG.duringBuffering.line} 预期=漂移行 ${oldG.driftedLine}`)
})
check('G2 新模型：出声后 JS 正速率发布解冻并重锚，控制中心歌词行跳到落点行', () => {
  assert(newG.afterSound.line === newG.targetLine, `line=${newG.afterSound.line} 应=${newG.targetLine}`)
})

console.log(`\n结果：${passCount} 过 / ${failCount} 败`)
process.exit(failCount ? 1 : 0)
