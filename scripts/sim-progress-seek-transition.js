#!/usr/bin/env node
/**
 * sim-progress-seek-transition.js —— 播放详情页进度条位置驱动守卫
 *
 * 对齐上游 ProgressBar.vue / usePlayProgress 的行为：
 * - 播放 tick（4Hz timeupdate 等价物）直接落位，无过渡（上游直接改 scaleX，无 transition）
 * - 仅当相邻两次进度跳变 >2s 时（seek / 后台恢复大跳 / 切歌归零），对这一次变更挂
 *   180ms 标准曲线（cubic-bezier(.22,1,.36,1)，上游 --duration-fast × --ease-standard）
 *   过渡滑到目标
 * - ≤2s 的短跳（含短 seek）上游同样直接落位，不动画
 *
 * 区分力反例：本批改前模型（setProgress 事件 800ms 过渡窗 + 窗外 250ms 线性补间）
 * 在普通 tick 上走 250ms 补间（与断言 1 冲突）、在 ≤2s 短 seek 上也挂 200ms 过渡
 * （与断言 3 冲突）——证明脚本能捕获回归。
 */
'use strict'

let nowMs = 0

const SEEK_JUMP_SEC = 2
const SEEK_MS = 180

/** 1:1 复刻新版 progressCore.useSmoothProgressAnim 的动画参数选择 */
function createAnim() {
  let prev = null
  const moves = []
  return {
    moves,
    onProgress(target, durationSec) {
      target = Math.min(1, Math.max(0, target))
      if (prev != null && Math.abs(target - prev) < 0.0001) return
      const deltaSec = prev == null ? 0 : Math.abs(target - prev) * durationSec
      prev = target
      const isJump = deltaSec > SEEK_JUMP_SEC
      moves.push({ at: nowMs, duration: isJump ? SEEK_MS : 0, ease: isJump ? 'bezier(.22,1,.36,1)' : 'none' })
    },
  }
}

/** 本批改前模型：setProgress 事件标记 800ms 过渡窗，窗内 200ms ease-out、窗外 250ms 线性 */
function createPriorAnim() {
  let windowUntil = 0
  const moves = []
  return {
    moves,
    onSetProgress() { windowUntil = nowMs + 800 },
    onProgress(target) {
      void target
      const inWindow = nowMs < windowUntil
      moves.push({ at: nowMs, duration: inWindow ? 200 : 250, ease: inWindow ? 'out-cubic' : 'linear' })
    },
  }
}

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

const DUR = 300 // 歌曲时长 300s（进度 0.01 = 3s）

console.log('sim-progress-seek-transition：进度条位置驱动（对齐上游：tick 直接落位 + >2s 跳变 180ms 过渡）\n')

// -- 新模型行为 --
const a1 = createAnim()
nowMs = 0; a1.onProgress(0.10, DUR) // 起始锚定（prev==null，无动画记录语义同实现：仍会动画一次但从初始值起步）
nowMs = 250; a1.onProgress(0.1008, DUR) // 播放 tick：Δ≈0.24s
nowMs = 500; a1.onProgress(0.1016, DUR)
nowMs = 750; a1.onProgress(0.1024, DUR)

check('1 播放 tick（Δ<2s）直接落位（duration 0、无过渡）', () => {
  const ticks = a1.moves.filter(m => m.at >= 250)
  assert(ticks.length === 3, `tick 数=${ticks.length} 应=3`)
  for (const m of ticks) {
    assert(m.duration === 0, `t=${m.at} duration=${m.duration} 应=0`)
    assert(m.ease === 'none', `t=${m.at} ease=${m.ease}`)
  }
})

const a2 = createAnim()
nowMs = 1000; a2.onProgress(0.10, DUR)
nowMs = 1250; a2.onProgress(0.44, DUR) // seek：Δprogress 0.34 × 300s ≈ 102s > 2s
check('2 跳变 >2s（seek）挂 180ms 标准曲线过渡', () => {
  const m = a2.moves[a2.moves.length - 1]
  assert(m.duration === 180, `duration=${m.duration} 应=180（上游 --duration-fast）`)
  assert(m.ease === 'bezier(.22,1,.36,1)', `ease=${m.ease} 应=bezier(.22,1,.36,1)（上游 --ease-standard）`)
})

const a3 = createAnim()
nowMs = 2000; a3.onProgress(0.20, DUR)
nowMs = 2250; a3.onProgress(0.1967, DUR) // 短快退 1s：Δ≈1s ≤ 2s
nowMs = 2500; a3.onProgress(0.2, DUR) // 短快进回原位
check('3 短跳 ≤2s（含短 seek）直接落位，不动画（对齐上游 watch 阈值）', () => {
  const shorts = a3.moves.filter(m => m.at >= 2250)
  for (const m of shorts) {
    assert(m.duration === 0, `t=${m.at} duration=${m.duration} 应=0`)
  }
})

const a4 = createAnim()
nowMs = 3000; a4.onProgress(0.30, DUR)
nowMs = 30000; a4.onProgress(0.40, DUR) // 后台恢复：位置已前进 30s > 2s（等价上游 visibilityChange 分支）
check('4 后台恢复大跳 >2s 挂 180ms 过渡（上游 visibilityChange 等价）', () => {
  const m = a4.moves[a4.moves.length - 1]
  assert(m.duration === 180 && m.ease === 'bezier(.22,1,.36,1)', JSON.stringify(m))
})

const a5 = createAnim()
nowMs = 4000; a5.onProgress(0.10, 0) // duration 未就绪
nowMs = 4250; a5.onProgress(0.90, 0) // 即使 progress 大变
check('5 时长未就绪（duration=0）永不过渡，一律直接落位', () => {
  for (const m of a5.moves) {
    assert(m.duration === 0, `t=${m.at} duration=${m.duration} 应=0`)
  }
})

const a6 = createAnim()
nowMs = 5000; a6.onProgress(0.50, DUR)
nowMs = 5250; a6.onProgress(0.001, DUR) // 切歌归零：Δ≈150s > 2s
check('6 切歌归零大跳挂 180ms 过渡（上游同规则触发）', () => {
  const m = a6.moves[a6.moves.length - 1]
  assert(m.duration === 180 && m.ease === 'bezier(.22,1,.36,1)', JSON.stringify(m))
})

const a7 = createAnim()
nowMs = 6000; a7.onProgress(0.20, DUR)
nowMs = 6250; a7.onProgress(0.20, DUR) // 重渲染但值未变
nowMs = 6500; a7.onProgress(0.20, DUR)
check('7 相同 progress 的重渲染不重启动画（无桥往返）', () => {
  assert(a7.moves.length === 1, `moves=${a7.moves.length} 应=1（只有首次锚定）`)
})

console.log('\n[反例] 本批改前模型（setProgress 800ms 窗 + 250ms 线性补间）区分力')
const prior = createPriorAnim()
nowMs = 0; prior.onProgress(0.10, DUR)
nowMs = 250; prior.onProgress(0.1008, DUR) // 普通播放 tick
check('x1 旧模型普通 tick 走 250ms 线性补间（与断言 1 冲突，证明脚本可捕获回归）', () => {
  const m = prior.moves[prior.moves.length - 1]
  assert(m.duration === 250 && m.ease === 'linear', `旧模型 ${JSON.stringify(m)}（若不等则脚本无区分力）`)
})
const prior2 = createPriorAnim()
nowMs = 1000; prior2.onProgress(0.20, DUR)
nowMs = 1100; prior2.onSetProgress() // 1s 短 seek（≤2s，上游不动画）
nowMs = 1200; prior2.onProgress(0.1967, DUR)
check('x2 旧模型对 ≤2s 短 seek 也挂 200ms 过渡（与断言 3 冲突，超上游语义）', () => {
  const m = prior2.moves[prior2.moves.length - 1]
  assert(m.duration === 200 && m.ease === 'out-cubic', `旧模型 ${JSON.stringify(m)}（若不等则脚本无区分力）`)
})

console.log(`\n结果：${passCount} 过 / ${failCount} 败`)
process.exit(failCount ? 1 : 0)
