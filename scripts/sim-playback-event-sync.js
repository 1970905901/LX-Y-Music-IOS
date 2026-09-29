#!/usr/bin/env node
/**
 * 播放链路「事件驱动」架构守卫（对齐上游 lx-m 桌面版 usePlayerEvent 契约）。
 *
 * 模型 1:1 复刻重构后的 JS 同步链路：
 *   引擎状态事件对：buffering/paused → app pause（歌词冻结，≈上游 waiting→lrc.pause）
 *                   playing → 时钟+行级以引擎【带戳绝对位置】重锚（≈上游 playing→lrc.play）
 *   行级歌词由歌词引擎内部 ticker（锚点+外推）自行推进；轮询/快路径不再干涉行级。
 *   syncFromEngine 代际守卫：在途快照返回时若用户已发起新 seek，旧快照丢弃。
 * 同时复刻旧「轮询架构」（5ece00d 及更早）作反例，证明每条断言有区分力。
 *
 * 断言矩阵：
 *   1  nativeFlac 快进长缓冲：缓冲期行冻结在旧行、逐字时钟冻在旧位置（卡拉OK继续唱
 *      旧行的字，绝不提前点亮落点行的字），出声 ≤100ms 行/时钟/逐字 elapsed 落到落点
 *   1x 反例：旧模型出声后时钟仍停在旧锚点（逐字/滚动失真 ≤1s）
 *   2  AVPlayer 远程 seek 状态抖动（resolve 时仍报 playing）：行不提前跳、出声才落
 *   2x 反例：旧模型 resolve 分派把行提前拽到目标行（音频还在旧内容/缓冲）
 *   3  AVPlayer 本地 seek（无状态变化）：快路径 ≤500ms 落行，且不早于出声
 *   4  nativeFlac 快退：行精确落到落点行（允许后退），缓冲期冻结
 *   5  播放中无轮询无 rAF：ticker 按行时间表自行推进（行源=ticker）
 *   5x 反例：旧模型无 rAF/轮询时行永远不动（ticker 被杀）
 *   6  暂停→恢复：时钟/行以引擎位置重锚；6x 反例：旧模型从冻结旧锚点恢复外推
 *   7  熄屏唤醒：ticker 重锚到引擎时间
 *   8  快速双 seek 代际守卫：最终落在第二个落点，旧快照不覆盖新窗口
 *   9  恢复进度起播首帧即缓冲（无锚点）：逐字时钟取引擎位置为基准（不冻在 0）
 *   9x 反例：无兜底时逐字时钟冻在 0（恢复进度起播卡拉OK无高亮基准）
 *  10  事件丢失自愈：seek 长缓冲吞掉 300ms 快路径、出声时不补发 playing 事件——
 *      行级自愈探针（慢校准层）≤1 个校准周期把行拉回落点行（音频侧时钟本就正确）
 *  10x 反例：无探针时行永久冻在旧行（真机实锤的「快进/快退后一直不同步」）
 * 逐字（卡拉OK）链路 = 行级链路的时钟侧：字高亮 elapsed = audioClock − 当前行起点，
 * audioClock 与行级 ticker 由同一批引擎事件锚定/冻结（playing→setAnchor+重锚、
 * buffering→hold），断言 1/3/6/8 的时钟误差即逐字精度上界。
 */
'use strict'

const PASS = []
const FAIL = []
function check(name, fn) {
  try { fn(); PASS.push(name); console.log('  ok  ' + name) } catch (e) {
    FAIL.push(name); console.log('  FAIL ' + name + ' :: ' + e.message)
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed') }

// ---------------------------------------------------------------------------
// 虚拟时间与定时器
// ---------------------------------------------------------------------------
let nowMs = 0
let timers = []
function after(ms, fn) { timers.push({ at: nowMs + ms, fn }) }
function advance(ms) {
  const end = nowMs + ms
  for (;;) {
    timers.sort((a, b) => a.at - b.at)
    const t = timers[0]
    if (!t || t.at > end) break
    nowMs = Math.max(nowMs, t.at)
    timers.shift()
    t.fn()
  }
  nowMs = end
}
function resetWorld() { nowMs = 0; timers = [] }

// ---------------------------------------------------------------------------
// audioClock 复刻（src/core/player/audioClock.ts 同语义）
// ---------------------------------------------------------------------------
function makeClock() {
  return {
    anchorPositionMs: 0, anchorSystemMs: 0, rate: 1, playing: false, holding: false, holdMs: 0,
    reset() { this.anchorPositionMs = 0; this.anchorSystemMs = 0; this.rate = 1; this.playing = false; this.holding = false; this.holdMs = 0 },
    setAnchor(positionMs, rate = this.rate, playing = true) {
      this.anchorPositionMs = positionMs; this.anchorSystemMs = nowMs; this.rate = rate; this.playing = playing; this.holding = false
    },
    hold(ms) { this.holding = true; this.holdMs = ms },
    setPlaying(playing) {
      if (playing === this.playing) return
      const now = this.getTime()
      this.anchorPositionMs = now * 1000; this.anchorSystemMs = nowMs; this.playing = playing
    },
    get hasAnchor() { return this.anchorSystemMs > 0 },
    getTime() {
      if (this.holding) return this.holdMs / 1000
      if (!this.playing) return this.anchorPositionMs / 1000
      return (this.anchorPositionMs + (nowMs - this.anchorSystemMs) * this.rate) / 1000
    },
  }
}

// ---------------------------------------------------------------------------
// 歌词引擎复刻（lrc-file-parser 内部 ticker：锚点+外推+定时链）
// ---------------------------------------------------------------------------
function makeLyric(lineTimes) {
  const lyric = {
    lines: lineTimes, isPlay: false, anchorMs: 0, sysMs: 0, curLine: -1,
    lineChanges: [], // { at, line }
    lineAt(tMs) {
      let idx = 0
      for (let i = 0; i < this.lines.length; i++) if (this.lines[i] <= tMs) idx = i
      return idx
    },
    play(curTimeMs = 0) {
      this.pause()
      this.isPlay = true
      this.anchorMs = curTimeMs; this.sysMs = nowMs
      this.emit()
      this.schedule()
    },
    pause() { this.isPlay = false },
    emit() {
      const i = this.lineAt(this.anchorMs + (nowMs - this.sysMs))
      if (i !== this.curLine) { this.curLine = i; this.lineChanges.push({ at: nowMs, line: i }) }
    },
    schedule() {
      after(50, () => { if (!this.isPlay) return; this.emit(); this.schedule() })
    },
  }
  return lyric
}

// ---------------------------------------------------------------------------
// 引擎复刻（nativeFlac / AVPlayer 共用行为面：state 事件 + pos + seekTo）
// ---------------------------------------------------------------------------
function makeEngine({ lineTimes }) {
  const e = {
    state: 'playing', anchorPos: 0, anchorT: 0, rate: 1, reportPos: null, _seekGen: 0, listeners: [],
    duration: lineTimes[lineTimes.length - 1] + 10000,
    pos(t = nowMs) {
      if (this.state === 'playing') return this.anchorPos + (t - this.anchorT) * this.rate
      return this.reportPos != null ? this.reportPos : this.anchorPos
    },
    emitState() { for (const l of this.listeners) l({ type: 'state', state: this.state }) },
    setState(s) { this.state = s; this.anchorT = nowMs; this.emitState() },
    playFrom(pos) { this.anchorPos = pos; this.anchorT = nowMs; this.reportPos = null; this.setState('playing') },
    pause() { this.anchorPos = this.pos(nowMs); this.anchorT = nowMs; this.reportPos = null; this.setState('paused') },
    /** seekTo：可配置生效延迟 / 是否经历 buffering / buffering 期位置回报语义。
     *  真实播放器语义：第二次 seekTo 取消尚未生效的前一次 seek（代际守卫）。 */
    seekTo(target, { applyAfter = 0, buffering = false, reportTargetDuringBuffering = true, emitPlayingOnApply = true, stateFlapMs = 0, silentResume = false } = {}) {
      const gen = ++this._seekGen
      const apply = () => {
        if (gen !== this._seekGen) return // 已被更新的 seek 取消
        this.anchorPos = target; this.anchorT = nowMs; this.reportPos = null
        if (this.state === 'buffering') {
          // silentResume：出声但不发 playing 事件（真机「事件丢失」模型——AVPlayer 对
          // 无状态变化 seek 不发事件 / 事件被守卫丢弃时的引擎侧等价物）
          if (silentResume) { this.state = 'playing' } 
          else this.setState('playing')
        }
        else if (emitPlayingOnApply) this.emitState() // 无状态变化也补发 playing（HTMLMediaElement 语义）
      }
      if (buffering) {
        if (stateFlapMs > 0) {
          // 状态抖动：seekTo 已受理但 state 仍报 playing 一段时间后才切 buffering
          after(stateFlapMs, () => {
            if (gen !== this._seekGen) return
            this.reportPos = reportTargetDuringBuffering ? target : this.pos(nowMs)
            this.setState('buffering')
            after(Math.max(0, applyAfter - stateFlapMs), apply)
          })
        } else {
          this.reportPos = reportTargetDuringBuffering ? target : this.pos(nowMs)
          this.setState('buffering')
          after(applyAfter, apply)
        }
      } else {
        this.anchorPos = this.pos(nowMs); this.anchorT = nowMs
        after(applyAfter, apply)
      }
    },
    stamped() { return { position: this.pos(nowMs), snapshotAt: nowMs, ageMs: 0 } },
  }
  return e
}

// ---------------------------------------------------------------------------
// 新架构系统（重构后 playProgress + controller 事件映射 + core/lyric 接线）
// ---------------------------------------------------------------------------
function createNewSystem(engine, lyric, { pollPhase = 0, eventHoldNoAnchorFallback = true, lineSyncDetector = true } = {}) {
  const clock = makeClock()
  const sys = {
    clock, lyric, engine,
    nowPlayTime: 0, seekTarget: null, seekHoldUntil: 0, seekGen: 0,
    engineConfirmed: false, bufferingHold: false,
    screenOn: true,
    userPlay: true, // ≈ playerState.isPlay（store 标志，用户点播放即 true，与引擎状态无关）
    lineSyncDetector, // 行级自愈探针（verifyLyricLineSync）：慢校准层的第二道网
    ccReanchors: [],
  }
  const isPlay = () => sys.engineConfirmed || engine.state === 'playing'

  // —— controller 事件映射：buffering/paused → app pause；playing → app play ——
  engine.listeners.push((ev) => {
    if (ev.type !== 'state') return
    if (ev.state === 'playing') appPlay()
    else appPause()
  })

  function appPause() {
    lyric.pause()
    clock.setPlaying(false)
    sys.engineConfirmed = false
  }
  function appPlay() {
    clock.setPlaying(true)
    scheduleFastResync(sys.seekGen)
  }

  // —— syncFromEngine（playProgress.ts 1:1；模拟器引擎位置单位=ms，无需秒→毫秒换算）——
  function syncFromEngine(musicId, genAtCall = sys.seekGen) {
    after(5, () => { // getPositionStamped 桥延迟
      if (genAtCall !== sys.seekGen) return
      const stamped = engine.stamped()
      after(5, () => { // getPlaybackEngineState 桥延迟
        if (genAtCall !== sys.seekGen) return
        if (engine.state !== 'playing') return
        sys.seekTarget = null; sys.seekHoldUntil = 0
        sys.engineConfirmed = true; sys.bufferingHold = false
        clock.setAnchor(stamped.position, 1, true)
        sys.nowPlayTime = stamped.position
        lyric.play(stamped.position) // handlePlay：行级 ticker 从引擎绝对时间重启
        sys.ccReanchors.push({ at: nowMs, position: stamped.position })
      })
    })
  }
  function scheduleFastResync(gen) {
    after(300, () => { if (engine.state === 'playing' || engine.state === 'buffering') syncFromEngine('m', gen) })
  }

  // —— 引擎状态事件订阅 ——
  engine.listeners.push((ev) => {
    if (ev.type !== 'state') return
    switch (ev.state) {
      case 'playing': syncFromEngine('m'); break
      case 'buffering':
      case 'loading':
        sys.engineConfirmed = false; sys.bufferingHold = true
        // 1:1 playProgress：有锚点 → 自冻结在当前位置；无锚点（恢复进度起播/新歌
        // 起播首帧即缓冲）→ 取引擎位置为逐字插值基准。迟到复核 bufferingHold/
        // hasAnchor/userPlay/曲 id，playing 先行或用户暂停/切歌则丢弃。
        if (clock.hasAnchor) {
          clock.hold(clock.getTime() * 1000)
        } else if (eventHoldNoAnchorFallback) {
          after(5, () => {
            if (!sys.bufferingHold || clock.hasAnchor || !sys.userPlay) return
            clock.hold(engine.pos(nowMs))
          })
        } else {
          clock.hold(clock.getTime() * 1000) // 修复前缺陷写法：无锚点时冻在 0
        }
        break
      case 'paused': case 'stopped':
        sys.engineConfirmed = false; sys.bufferingHold = false
        break
    }
  })

  // —— setProgress ——
  sys.setProgress = (time) => {
    sys.nowPlayTime = time
    sys.seekTarget = time; sys.seekHoldUntil = nowMs + 2000; sys.seekGen++
    // setCurrentTime：立即 resolve（模拟 AVPlayer/nativeFlac seekTo 语义由场景驱动）
    engine.seekTo && null
    return time
  }
  // 场景显式调用 engine.seekTo 驱动引擎；这里模拟「seek 受理回调」链路：
  sys.seekAccepted = (target) => {
    sys.nowPlayTime = target
    sys.seekTarget = target; sys.seekHoldUntil = nowMs + 2000
    scheduleFastResync(sys.seekGen)
  }

  // —— 1s 慢校准轮询（不含行同步；行级由探针兜底，见下）——
  const poll = () => {
    if (!sys.screenOn) return
    after(1000, () => {
      poll()
      const position = engine.pos(nowMs)
      if (sys.seekTarget != null && nowMs < sys.seekHoldUntil) {
        if (Math.abs(position - sys.seekTarget) >= 1.5) return
        sys.seekTarget = null; sys.seekHoldUntil = 0
      }
      sys.nowPlayTime = position
      if (engine.state === 'buffering') { clock.hold((clock.hasAnchor ? clock.getTime() * 1000 : position)); return }
      clock.setAnchor(position, 1, true)
      // 行级自愈探针（playProgress 慢校准层 1:1）：引擎确认在播（非 buffering 分支）
      // 且不在 seek 窗口，position 即引擎真相；「应有行 ≠ 当前行」只可能是事件丢失。
      if (sys.lineSyncDetector) {
        const expected = lyric.lineAt(position)
        if (expected !== lyric.curLine && !(expected === 0 && lyric.curLine < 0)) lyric.play(position)
      }
    })
  }
  after(pollPhase, poll)

  // —— 熄屏/亮屏 ——
  sys.setScreen = (on) => {
    sys.screenOn = on
    if (on && engine.state === 'playing') {
      // handleScreenStateChanged ON：syncFromEngine + resyncLyricToEngine
      syncFromEngine('m')
      lyric.play(engine.pos(nowMs))
    } else if (!on) {
      lyric.pause() // 模拟熄屏定时器节流：ticker 停摆
    }
  }
  return sys
}

// ---------------------------------------------------------------------------
// 旧架构系统（5ece00d：ticker 被杀 + rAF 每帧推进 + 轮询行同步 + resolve 状态分派）
// ---------------------------------------------------------------------------
function createOldSystem(engine, lyric, { pollPhase = 0 } = {}) {
  const clock = makeClock()
  const sys = {
    clock, lyric, engine,
    nowPlayTime: 0, seekTarget: null, seekHoldUntil: 0,
    engineConfirmed: false, bufferingHold: false, screenOn: true,
  }
  engine.listeners.push((ev) => {
    if (ev.type !== 'state') return
    if (ev.state === 'playing') appPlay()
    else appPause()
  })
  function appPause() { lyric.pause(); clock.setPlaying(false); sys.engineConfirmed = false }
  function appPlay() {
    // core/lyric.play：重锚行 + 立即杀死 ticker（旧行为）
    lyric.play(engine.pos(nowMs))
    lyric.pause()
    clock.setPlaying(true) // 从冻结旧锚点恢复外推（缺陷所在）
    scheduleFastResync()
  }
  function scheduleFastResync() {
    after(300, () => getCurrentTime())
  }
  function getCurrentTime() {
    after(10, () => {
      const position = engine.pos(nowMs)
      if (sys.seekTarget != null && nowMs < sys.seekHoldUntil) {
        if (Math.abs(position - sys.seekTarget) >= 1.5) return
        sys.seekTarget = null; sys.seekHoldUntil = 0
      }
      sys.nowPlayTime = position
      after(10, () => {
        const st = engine.state
        sys.engineConfirmed = st === 'playing'
        if (st === 'buffering') { clock.hold((clock.hasAnchor ? clock.getTime() * 1000 : position)); return }
        clock.setAnchor(position, 1, true)
        // 行同步（旧）：轮询镜像
        mirrorLine(position)
      })
    })
  }
  function mirrorLine(tMs) {
    // syncToTimeFromPosition：带 250ms 回退迟滞的镜像（旧行为，此处简化为直接镜像）
    lyric.play(tMs); lyric.pause()
  }
  // rAF 每帧前向推进（旧行为）：读时钟推行
  const raf = () => {
    after(16, () => {
      if (!sys.screenOn) return
      const t = clock.getTime() * 1000
      const i = lyric.lineAt(t)
      if (i > lyric.curLine) lyric.play(t), lyric.pause()
      raf()
    })
  }
  after(pollPhase, raf)
  after(pollPhase, getCurrentTime)

  sys.setProgress = (time) => {
    sys.nowPlayTime = time
    sys.seekTarget = time; sys.seekHoldUntil = nowMs + 2000
  }
  sys.seekAccepted = (target, engineStateAtResolve) => {
    sys.nowPlayTime = target
    sys.seekTarget = target; sys.seekHoldUntil = nowMs + 2000
    // resolve 分派（旧）：playing → hold(目标)+syncLyric(目标)；否则冻结当前
    after(0, () => {
      if (engineStateAtResolve === 'playing') {
        clock.hold(target)
        lyric.play(target); lyric.pause()
      } else {
        clock.hold(clock.getTime() * 1000)
      }
      scheduleFastResync()
    })
  }
  sys.setScreen = (on) => { sys.screenOn = on }
  return sys
}

// ---------------------------------------------------------------------------
// 场景工具
// ---------------------------------------------------------------------------
const LINES = [0, 10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000]
const lineAt = (tMs) => {
  let idx = 0
  for (let i = 0; i < LINES.length; i++) if (LINES[i] <= tMs) idx = i
  return idx
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

check('1 nativeFlac 快进长缓冲：缓冲期行冻结旧行，出声≤100ms 行+时钟落到落点', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createNewSystem(engine, lyric, { pollPhase: 300 })
  engine.playFrom(25000); lyric.play(25000)
  advance(1000) // 播放至 ~26s
  engine.seekTo(65000, { applyAfter: 2000, buffering: true }) // 立即 buffering，2s 后出声
  sys.seekAccepted(65000)
  advance(1000) // 缓冲中
  assert(lyric.curLine === lineAt(25000 + 1000), `缓冲期行应为旧行(2)，实际 ${lyric.curLine}`)
  assert(lyric.isPlay === false, '缓冲期歌词应冻结（waiting→pause）')
  // 逐字（卡拉OK）链路显式断言：字高亮 elapsed = 逐字时钟 − 当前行起点。
  // 缓冲期时钟冻在旧位置 → 旧行(2)的字停在已唱处继续显示，绝不点亮落点行(6)的字。
  const bufClock = sys.clock.getTime() * 1000
  assert(Math.abs(bufClock - 26000) <= 50, `缓冲期逐字时钟应冻在旧位置(~26s)，实际 ${bufClock.toFixed(0)}ms`)
  assert(bufClock < 30000, '缓冲期逐字时钟不得跳向落点（否则落点行的字提前点亮）')
  advance(1100) // 出声（t≈3100）后 100ms
  assert(lyric.curLine === lineAt(65100), `出声+100ms 行应到落点行(6)，实际 ${lyric.curLine}`)
  const clockErr = Math.abs(sys.clock.getTime() * 1000 - engine.pos(nowMs))
  assert(clockErr <= 100, `出声+100ms 时钟误差应≤100ms，实际 ${clockErr.toFixed(0)}ms`)
  // 出声后逐字 elapsed 与引擎真实 elapsed 同差（行级 ticker 与逐字时钟同一批事件锚定）
  const line = lineAt(engine.pos(nowMs))
  const wordElapsed = sys.clock.getTime() * 1000 - LINES[line]
  const engineElapsed = engine.pos(nowMs) - LINES[line]
  assert(Math.abs(wordElapsed - engineElapsed) <= 100, `逐字 elapsed 误差应≤100ms，实际 ${Math.abs(wordElapsed - engineElapsed).toFixed(0)}ms`)
})

check('1x 反例：旧模型出声+100ms 时钟仍停在旧锚点（≥5s 误差，缺陷可被捕获）', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createOldSystem(engine, lyric, { pollPhase: 300 })
  engine.playFrom(25000); lyric.play(25000)
  advance(1000)
  engine.seekTo(65000, { applyAfter: 2000, buffering: true })
  sys.seekAccepted(65000)
  advance(1000)
  advance(1100) // 出声+100ms
  const clockErr = Math.abs(sys.clock.getTime() * 1000 - engine.pos(nowMs))
  assert(clockErr >= 5000, `旧模型时钟误差应≥5s（缺陷存在），实际 ${clockErr.toFixed(0)}ms`)
})

check('2 AVPlayer 远程 seek 状态抖动：行不提前跳，出声才落到落点行', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createNewSystem(engine, lyric, { pollPhase: 300 })
  engine.playFrom(25000); lyric.play(25000)
  advance(1000)
  // resolve 时 state 还报 playing（150ms 后才切 buffering）→ 旧架构在此提前跳行
  engine.seekTo(65000, { applyAfter: 2300, buffering: true, stateFlapMs: 150 })
  sys.seekAccepted(65000)
  advance(400) // resolve 后 400ms：已进入 buffering（100ms 处），行必须仍在旧行
  assert(lyric.curLine === lineAt(26000), `缓冲期行应冻结旧行(2)，实际 ${lyric.curLine}`)
  advance(2100) // 越过出声点（t≈3400）+ 一拍
  assert(lyric.curLine === lineAt(65500), `出声后行应到落点行(6)，实际 ${lyric.curLine}`)
})

check('2x 反例：旧模型 resolve 分派把行提前拽到目标行（音频还在旧内容）', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createOldSystem(engine, lyric, { pollPhase: 300 })
  engine.playFrom(25000); lyric.play(25000)
  advance(1000)
  engine.seekTo(65000, { applyAfter: 2300, buffering: true, stateFlapMs: 150 })
  sys.seekAccepted(65000, 'playing') // resolve 时 state 查询返回 playing（抖动窗口）
  advance(400)
  assert(lyric.curLine === lineAt(65000), `旧模型行应已提前跳到目标行(6)（缺陷存在），实际 ${lyric.curLine}`)
})

check('3 AVPlayer 本地 seek（无状态变化）：快路径≤500ms 落行且不早于出声', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createNewSystem(engine, lyric, { pollPhase: 300 })
  engine.playFrom(25000); lyric.play(25000)
  advance(1000)
  engine.seekTo(65000, { applyAfter: 150, buffering: false, emitPlayingOnApply: false }) // 无事件
  sys.seekAccepted(65000)
  advance(120) // 快路径尚未触发（300ms），出声已发生（150ms）——行仍应旧行（不提前）
  assert(lyric.curLine === lineAt(26120), `出声前 30ms 行应仍旧行(2)，实际 ${lyric.curLine}`)
  advance(400) // 快路径（seekAccepted+300ms→syncFromEngine≈310ms）已落
  assert(lyric.curLine === lineAt(65520), `快路径落行应为(6)，实际 ${lyric.curLine}`)
  const clockErr = Math.abs(sys.clock.getTime() * 1000 - engine.pos(nowMs))
  assert(clockErr <= 100, `时钟误差应≤100ms，实际 ${clockErr.toFixed(0)}ms`)
})

check('4 nativeFlac 快退：行精确落到落点行（允许后退），缓冲期冻结', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createNewSystem(engine, lyric, { pollPhase: 300 })
  engine.playFrom(65000); lyric.play(65000)
  advance(1000)
  engine.seekTo(8000, { applyAfter: 1800, buffering: true }) // 快退，重解码 1.8s
  sys.seekAccepted(8000)
  advance(1000)
  assert(lyric.curLine === lineAt(66000), `快退缓冲期行应冻结旧行(6)，实际 ${lyric.curLine}`)
  advance(1000) // 出声（t≈2900）
  advance(150)
  assert(lyric.curLine === 0, `出声+150ms 行应回到第 0 行（落点 8s），实际 ${lyric.curLine}`)
  assert(sys.nowPlayTime >= 8000 && sys.nowPlayTime <= 8600, `进度应为落点附近，实际 ${sys.nowPlayTime}`)
})

check('5 播放中无轮询无 rAF：ticker 按行时间表自行推进', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createNewSystem(engine, lyric, { pollPhase: 3600000 }) // 轮询永不触发
  engine.playFrom(5000); lyric.play(5000)
  advance(5500) // 跨过 10s 行界（t≈5.5s→10.5s 歌词时间）
  assert(lyric.curLine === 1, `ticker 应自行推进到行 1，实际 ${lyric.curLine}`)
  advance(10000) // 跨过 20s 行界
  assert(lyric.curLine === 2, `ticker 应自行推进到行 2，实际 ${lyric.curLine}`)
})

check('5x 反例：旧模型无 rAF/轮询时行永远不动（ticker 被杀，缺陷可被捕获）', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createOldSystem(engine, lyric, { pollPhase: 3600000 })
  engine.playFrom(5000); lyric.play(5000)
  advance(15500)
  assert(lyric.curLine === 0, `旧模型行应卡在第 0 行（缺陷存在），实际 ${lyric.curLine}`)
})

check('6 暂停中 seek→恢复：时钟/行以引擎落点重锚（≤120ms 误差≤100ms）', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createNewSystem(engine, lyric, { pollPhase: 300 })
  engine.playFrom(25000); lyric.play(25000)
  advance(2000)
  engine.pause(); lyric.pause(); clockPause(sys)
  advance(500)
  // 暂停中 seek（无任何事件）：音频落点 65s
  engine.seekTo(65000, { applyAfter: 100, buffering: false, emitPlayingOnApply: false })
  advance(500)
  // 用户恢复 → 引擎 playing 事件 → app play + syncFromEngine
  engine.playFrom(engine.pos(nowMs))
  advance(120)
  const clockErr = Math.abs(sys.clock.getTime() * 1000 - engine.pos(nowMs))
  assert(clockErr <= 100, `恢复+120ms 时钟误差应≤100ms，实际 ${clockErr.toFixed(0)}ms`)
  assert(lyric.curLine === lineAt(engine.pos(nowMs)), `行应与引擎位置一致，实际 ${lyric.curLine}`)
})
function clockPause(sys) { sys.clock.setPlaying(false) }

check('6x 反例：旧模型暂停中 seek 后恢复，时钟从 seek 前旧锚点外推（≥3s 误差）', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createOldSystem(engine, lyric, { pollPhase: 300 })
  engine.playFrom(25000); lyric.play(25000)
  advance(2000)
  engine.pause(); lyric.pause(); clockPause(sys)
  advance(500)
  engine.seekTo(65000, { applyAfter: 100, buffering: false, emitPlayingOnApply: false })
  advance(500)
  engine.playFrom(engine.pos(nowMs))
  engine.setState('playing')
  advance(120)
  const clockErr = Math.abs(sys.clock.getTime() * 1000 - engine.pos(nowMs))
  assert(clockErr >= 3000, `旧模型时钟误差应≥3s（缺陷存在），实际 ${clockErr.toFixed(0)}ms`)
})

check('7 熄屏唤醒：行级 ticker 重锚到引擎时间（不再从过期锚点出发）', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createNewSystem(engine, lyric, { pollPhase: 300 })
  engine.playFrom(25000); lyric.play(25000)
  advance(2000)
  sys.setScreen(false)
  advance(15000) // 熄屏 15s（ticker 节流停摆、引擎照常播放，位置已前移 ~15s）
  sys.setScreen(true)
  advance(50)
  const expected = lineAt(engine.pos(nowMs))
  assert(lyric.curLine === expected, `唤醒后行应立即与引擎一致(行 ${expected})，实际 ${lyric.curLine}`)
})

check('8 快速双 seek 代际守卫：最终落在第二个落点，旧快照不覆盖新窗口', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createNewSystem(engine, lyric, { pollPhase: 300 })
  engine.playFrom(25000); lyric.play(25000)
  advance(1000)
  // seek A：快路径已排队（300ms 后触发 syncFromEngine，快照延迟再 10ms）
  engine.seekTo(65000, { applyAfter: 600, buffering: false, emitPlayingOnApply: false })
  sys.seekAccepted(65000)
  advance(50)
  // seek B 在 A 的 syncFromEngine 在途时发起
  engine.seekTo(8000, { applyAfter: 100, buffering: false, emitPlayingOnApply: false })
  sys.seekAccepted(8000)
  advance(1000) // A 的 syncFromEngine（已过期）与 B 的快路径都会跑
  assert(lyric.curLine === 0, `最终行应落在 B 落点（行 0，8s），实际 ${lyric.curLine}`)
  const clockErr = Math.abs(sys.clock.getTime() * 1000 - engine.pos(nowMs))
  assert(clockErr <= 100, `时钟应锚定 B 落点，误差≤100ms，实际 ${clockErr.toFixed(0)}ms`)
})

check('9 恢复进度起播首帧即缓冲（无锚点）：逐字时钟取引擎位置为基准（不冻在 0）', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createNewSystem(engine, lyric, { pollPhase: 300 })
  // 恢复进度起播：用户点播放（userPlay=true），引擎加载记忆进度 120s，首帧即 loading——
  // 此前从未 setAnchor（hasAnchor=false），慢校准（1s）尚未跑过
  sys.userPlay = true
  engine.anchorPos = 120000; engine.anchorT = nowMs; engine.reportPos = 120000
  engine.setState('loading')
  advance(50)
  const t = sys.clock.getTime() * 1000
  assert(Math.abs(t - 120000) <= 100, `缓冲期逐字时钟应以引擎位置(~120s)为基准，实际 ${t.toFixed(0)}ms`)
  assert(t > 60000, '逐字时钟不得冻在 0（否则恢复进度起播的卡拉OK/连续滚动无高亮基准）')
})

check('9x 反例：无兜底时逐字时钟冻在 0（恢复进度起播卡拉OK无基准，缺陷可被捕获）', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createNewSystem(engine, lyric, { pollPhase: 300, eventHoldNoAnchorFallback: false })
  sys.userPlay = true
  engine.anchorPos = 120000; engine.anchorT = nowMs; engine.reportPos = 120000
  engine.setState('loading')
  advance(50)
  assert(sys.clock.getTime() * 1000 === 0, `无兜底时逐字时钟应冻在 0（缺陷存在），实际 ${(sys.clock.getTime() * 1000).toFixed(0)}ms`)
})

check('10 事件丢失自愈：快路径被长缓冲吞掉 + 出声不补发 playing——行级 ≤1 个校准周期自愈', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createNewSystem(engine, lyric, { pollPhase: 300 })
  engine.playFrom(25000); lyric.play(25000)
  advance(1000) // 播至 ~26s，行 2
  assert(lyric.curLine === 2, `前置：应在行 2，实际 ${lyric.curLine}`)
  // seek 长缓冲 2.5s（> 300ms 快路径）→ 快路径 syncFromEngine 被缓冲守卫丢弃；
  // 出声时事件丢失（silentResume）→ 无 playing 事件、无 app_event.play、行级永无事件重锚
  engine.seekTo(65000, { applyAfter: 2500, buffering: true, silentResume: true })
  sys.seekAccepted(65000)
  advance(1500) // t≈2.5s：快路径（1.3s 处）已跑过并被守卫丢弃，仍在缓冲，行应冻结旧行
  assert(lyric.curLine === 2, `缓冲期行应冻结旧行(2)，实际 ${lyric.curLine}`)
  advance(2000) // t≈4.5s：3.5s 处已静默出声（音频在落点正常播放），4.3s 慢校准已自愈
  assert(lyric.curLine === 6, `事件全丢后行级应经探针自愈到落点行(6)，实际 ${lyric.curLine}`)
  const clockErr = Math.abs(sys.clock.getTime() * 1000 - engine.pos(nowMs))
  assert(clockErr <= 100, `音频侧时钟应正常（对照：用户看到的「进度条正常、歌词不动」），误差 ${clockErr.toFixed(0)}ms`)
})

check('10x 反例：无探针时行永久冻在旧行（真机「快进/快退后一直不同步」，缺陷可被捕获）', () => {
  resetWorld()
  const engine = makeEngine({ lineTimes: LINES })
  const lyric = makeLyric(LINES)
  const sys = createNewSystem(engine, lyric, { pollPhase: 300, lineSyncDetector: false })
  engine.playFrom(25000); lyric.play(25000)
  advance(1000)
  engine.seekTo(65000, { applyAfter: 2500, buffering: true, silentResume: true })
  sys.seekAccepted(65000)
  advance(1500)
  advance(2000)
  assert(lyric.curLine === 2, `无探针时行应永久冻在旧行(2)（缺陷存在），实际 ${lyric.curLine}`)
  const clockErr = Math.abs(sys.clock.getTime() * 1000 - engine.pos(nowMs))
  assert(clockErr <= 100, `无探针时时钟仍应正常（证明缺陷只在行级），误差 ${clockErr.toFixed(0)}ms`)
})

// ---------------------------------------------------------------------------
console.log(`\n${PASS.length} passed, ${FAIL.length} failed`)
if (FAIL.length) { console.log('FAILED: ' + FAIL.join(' | ')); process.exit(1) }
