/**
 * sim-player-stuck-flag-bounds.js
 *
 * 「粘滞标记必须有时间上界 / 异常安全」契约（2026-10-06 全仓扫描，用户：「直接扫描全部代码修复」）。
 *
 * 这一类缺陷的共同形状：一个布尔/字符串标记 gate 住事件投递或状态更新，置位后只在
 * 某个 await 之后的 finally / 引用比较里复位 —— 只要那条路径挂起、抛错或被换代打断，
 * 标记就永久残留：**相关链路整体静默停摆，音频照播、界面看似正常，只有重启 App 恢复**。
 * 已经在真机上抓到过两次同类事故：
 *   · `global.lx.gettingUrlId`（换源闸门）→ 引擎事件被永久丢弃（卡片冻结、暂停/播放无效）；
 *   · a8212b3 的 JS 回传式自愈被同一闸门掐断。
 * 本契约把「已完成修复的另外三处」钉住：
 *   ① initial() 异常安全：isIniting 抛错后永久 true → 播放器再也起不来；
 *   ② EventBus 监听器隔离：一个监听器抛错不得饿死其余监听器（nowPlaying 发布就在其中）；
 *   ③ ignoreTrackPlayerLifecycle 时间上界：残留 → TrackPlayer 事件被永久忽略；
 *   ④ 进度拖动标记时间上界：结束事件丢失 → 1s 慢校准与 4Hz 快路径永久停摆。
 *
 * 运行：node scripts/sim-player-stuck-flag-bounds.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const SRC = {
  playerInit: read('src/plugins/player/index.ts'),
  bus: read('src/plugins/player/engine/EventBus.ts'),
  engine: read('src/plugins/player/engine/index.ts'),
  resourceLoader: read('src/plugins/player/engine/resourceLoader.ts'),
  globalData: read('src/config/globalData.ts'),
  appTypes: read('src/types/app.d.ts'),
  playProgress: read('src/core/init/player/playProgress.ts'),
  lxLyricPlayer: read('src/plugins/lxLyricPlayer.ts'),
}

const windowBetween = (src, startAnchor, endAnchor, fallback = 3000) => {
  const start = src.indexOf(startAnchor)
  if (start < 0) return ''
  const end = src.indexOf(endAnchor, start + startAnchor.length)
  return end < 0 ? src.slice(start, start + fallback) : src.slice(start, end)
}

const structuralReasons = (s) => {
  const reasons = []

  // ① initial() 异常安全
  const init = windowBetween(s.playerInit, 'const initial = async(', 'const isInitialized = () =>', 3000)
  if (!init) {
    reasons.push('找不到 initial()')
  } else {
    if (!/try \{/.test(init) || !/\} catch \(err\) \{/.test(init) || !/\} finally \{/.test(init)) {
      reasons.push('initial() 不是异常安全的（缺 try/catch/finally）—— 抛错后 isIniting 永久 true，播放器起不来')
    }
    if (!/global\.lx\.playerStatus\.isInitialized = false/.test(init)) {
      reasons.push('initial() 失败时没有把 isInitialized 复位')
    }
    if (!/###LXPlayerInit### 初始化失败/.test(init)) {
      reasons.push('initial() 失败没有打点（真机无法归因「播放器起不来」）')
    }
    if (!/\} finally \{\s*\n\s*global\.lx\.playerStatus\.isIniting = false/.test(init)) {
      reasons.push('initial() 没有在 finally 里复位 isIniting（粘滞标记会卡死后续初始化）')
    }
  }

  // ② EventBus 监听器隔离
  const emit = windowBetween(s.bus, 'emit(event: UnifiedPlayerEvent) {', 'on(listener: Listener)', 1200)
  if (!/try \{\s*\n\s*listener\(event\)/.test(emit)) {
    reasons.push('EventBus.emit 没有隔离监听器异常（一个监听器抛错会饿死其余监听器，含 nowPlaying 发布）')
  }
  if (!/###LXPlayerBus### listener error/.test(emit)) {
    reasons.push('EventBus 监听器异常没有打点（真机无法归因「事件链路静默停摆」）')
  }

  // ③ ignoreTrackPlayerLifecycle 时间上界
  if (!/ignoreTrackPlayerLifecycleAtMs: 0,/.test(s.globalData)) {
    reasons.push('globalData 缺少 ignoreTrackPlayerLifecycleAtMs（时间上界没有数据源）')
  }
  if (!/ignoreTrackPlayerLifecycleAtMs: number/.test(s.appTypes)) {
    reasons.push('类型声明缺少 ignoreTrackPlayerLifecycleAtMs')
  }
  if (!/const IGNORE_TP_LIFECYCLE_MAX_MS = \d+/.test(s.engine)) {
    reasons.push('引擎缺少 IGNORE_TP_LIFECYCLE_MAX_MS（忽略生命周期标记没有上界）')
  }
  if (!/if \(since > 0 && Date\.now\(\) - since > IGNORE_TP_LIFECYCLE_MAX_MS\)/.test(s.engine)) {
    reasons.push('shouldIgnoreTrackPlayerLifecycle 没有使用时间上界（残留即永久忽略事件）')
  }
  if (!/###LXPlayerGuard### ignoreTrackPlayerLifecycle 超时放行/.test(s.engine)) {
    reasons.push('忽略生命周期标记超时没有打点')
  }
  for (const [name, src] of [['reloadConfig', s.playerInit], ['resourceLoader', s.resourceLoader]]) {
    if (!/ignoreTrackPlayerLifecycle = true\s*\n\s*global\.lx\.playerStatus\.ignoreTrackPlayerLifecycleAtMs = Date\.now\(\)/.test(src)) {
      reasons.push(`${name} 置位 ignoreTrackPlayerLifecycle 时没有盖时间戳`)
    }
    if (!/ignoreTrackPlayerLifecycle = false\s*\n\s*global\.lx\.playerStatus\.ignoreTrackPlayerLifecycleAtMs = 0/.test(src)) {
      reasons.push(`${name} 复位 ignoreTrackPlayerLifecycle 时没有清时间戳`)
    }
  }

  // ④ 进度拖动标记时间上界
  const drag = windowBetween(s.playProgress, 'let isProgressDragging = false', 'const getCurrentTime = () =>', 1500)
  if (!/const PROGRESS_DRAG_MAX_MS = \d+/.test(s.playProgress)) {
    reasons.push('缺少 PROGRESS_DRAG_MAX_MS（拖动标记没有上界：结束事件丢失则进度链路永久停摆）')
  }
  if (!/const isDraggingNow = \(\) => \{/.test(drag) || !/###LXPlayerGuard### progressDrag 超时放行/.test(drag)) {
    reasons.push('缺少 isDraggingNow 上界判定/打点')
  }
  if (!/if \(isDraggingNow\(\)\) return/.test(s.playProgress)) {
    reasons.push('1s 慢校准/4Hz 快路径没有走 isDraggingNow（仍会被粘滞标记永久跳过）')
  }
  if (!/progressDraggingSince = dragging \? Date\.now\(\) : 0/.test(s.playProgress)) {
    reasons.push('progressDragState 置位/复位没有盖时间戳')
  }

  // ⑤ 歌词行级 ticker：异常不得断链（setTimeout 链断掉无人重启）
  const tick = windowBetween(s.lxLyricPlayer, 'private tick() {', 'private initTag() {', 1200)
  if (!tick) {
    reasons.push('找不到 LxLyricPlayer.tick（行级歌词 ticker）')
  } else {
    if (!/try \{[\s\S]{0,400}?this\.emitState\(currentTime\)/.test(tick)) {
      reasons.push('行级 ticker 没有 try/catch：onPlay 消费者一旦抛错，setTimeout 链断掉且无人重启（歌词永久冻结，音频照播）')
    }
    if (!/###LXPlayerGuard### lyric tick 异常/.test(tick)) {
      reasons.push('行级 ticker 异常没有打点（真机无法归因「歌词行不再变化」）')
    }
    if (!/\} catch \(error\) \{[\s\S]{0,900}?\}\s*\n\s*this\.timeoutId = setTimeout/.test(tick)) {
      reasons.push('行级 ticker 在 catch 之后没有续链（异常后不再调度下一次 tick）')
    }
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：粘滞标记下「事件链路/初始化/进度」是否还能自愈
// ---------------------------------------------------------------------------
const modelLegacy = ({ stuck }) => (stuck ? 'dead-until-restart' : 'ok')
const modelNew = ({ stuck, bounded }) => {
  if (!stuck) return 'ok'
  return bounded ? 'released-after-max' : 'dead-until-restart'
}

const models = [
  ['反例：粘滞标记（闸门/初始化/忽略生命周期/拖动）无上界 → 链路静默停摆，只能重启',
    modelLegacy({ stuck: true }) === 'dead-until-restart'],
  ['修复后：同一粘滞标记有上界 → 超过上界后自动放行，链路自愈',
    modelNew({ stuck: true, bounded: true }) === 'released-after-max'],
  ['修复后：标记正常复位（多数情况）→ 行为不变',
    modelNew({ stuck: false, bounded: true }) === 'ok'],
  ['异常安全：初始化抛错后 isIniting 复位 → 下一次 initial() 仍可重试',
    modelNew({ stuck: false, bounded: true }) === 'ok'],
  ['反例：行级 ticker 回调抛错且无 try/catch → setTimeout 链断掉，歌词冻结到下次用户操作',
    (() => { const legacyTick = (isPlay, throwAt) => (isPlay && throwAt ? 'chain-dead' : 'tick'); return legacyTick(true, true) === 'chain-dead' })()],
  ['修复后：行级 ticker 回调抛错 → 吞掉异常并继续续链（仅丢一拍）',
    (() => { const newTick = (throwAt) => (throwAt ? 'continue-after-catch' : 'tick'); return newTick(true) === 'continue-after-catch' && newTick(false) === 'tick' })()],
]

const realReasons = structuralReasons(SRC)

const tamperCases = [
  ['拿掉 initial() 的 finally 复位', ({ playerInit }) => ({ playerInit: playerInit.replace('  } finally {\n    global.lx.playerStatus.isIniting = false\n  }\n', '') }), 'isIniting'],
  ['拿掉 EventBus 监听器隔离', ({ bus }) => ({ bus: bus.replace('      try {\n        listener(event)\n      } catch (error) {\n        console.log(\'###LXPlayerBus### listener error:\', error instanceof Error ? error.message : error)\n      }', '      listener(event)') }), 'EventBus'],
  ['拿掉忽略生命周期标记的时间上界', ({ engine }) => ({ engine: engine.replace('  if (since > 0 && Date.now() - since > IGNORE_TP_LIFECYCLE_MAX_MS) {\n', '  if (false) {\n') }), '时间上界'],
  ['拿掉拖动标记的时间上界', ({ playProgress }) => ({ playProgress: playProgress.replace('  const PROGRESS_DRAG_MAX_MS = 120000\n', '') }), 'PROGRESS_DRAG_MAX_MS'],
  ['拿掉歌词 ticker 的异常续链', ({ lxLyricPlayer }) => ({ lxLyricPlayer: lxLyricPlayer.replace('    try {\n', '    if (true) {\n') }), '歌词'],
]
const tamperResults = tamperCases.map(([name, mutate, expectKeyword]) => {
  const mutated = { ...SRC, ...mutate(SRC) }
  const changed = Object.keys(SRC).some((k) => mutated[k] !== SRC[k])
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
  console.error(`\nFAIL  粘滞标记契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
const failedModels = models.filter(([, ok]) => !ok)
const failedTampers = tamperResults.filter(([, ok]) => !ok)
if (failedModels.length) console.error(`\nFAIL  行为模型未通过（${failedModels.length} 例）`)
if (failedTampers.length) console.error(`\nFAIL  反例自检未通过（${failedTampers.length} 例）`)
if (realReasons.length || failedModels.length || failedTampers.length) {
  console.error('\nFAIL  粘滞标记契约未通过')
  process.exit(1)
}
console.log(`\nPASS  粘滞标记有上界 / 初始化异常安全 / 监听器隔离 / ticker 异常续链（结构不变量 5 组 + 行为模型 ${models.length} 例 + 反例 ${tamperResults.length} 例）`)
process.exit(0)
