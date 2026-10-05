/**
 * sim-remote-toggle-resilience.js
 *
 * toggle 在三种时间线下都必须"按压最终生效、且不反转、不补第二次 toggle"：
 *   ① 引擎状态查询快速返回：按引擎真实状态动作（不读滞后的镜像）；
 *   ② 查询挂起：超时按「镜像意图」先动作（不再用滞后的 togglePlay()）；
 *   ③ 兜底后晚到：仅当引擎状态仍指向同一意图（= 兜底是空操作）时，同方向对齐一次。
 *
 * 本脚本转译并加载真实的 src/core/init/player/remoteCommand.ts，用模块桩 + 假定时器
 * 驱动，不是源码文本匹配。
 *
 * 运行：node scripts/sim-remote-toggle-resilience.js
 * 环境变量 LX_REMOTE_COMMAND_PATH 可指向替代源文件（用于对照修复前行为）。
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')
const Module = require('module')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
const SOURCE_PATH = process.env.LX_REMOTE_COMMAND_PATH || path.join(ROOT, 'src/core/init/player/remoteCommand.ts')

const deferred = () => {
  let resolveFn, rejectFn
  const promise = new Promise((resolve, reject) => { resolveFn = resolve; rejectFn = reject })
  return { promise, resolve: resolveFn, reject: rejectFn }
}

const loadModule = (sourcePath, source) => {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
    fileName: sourcePath,
  }).outputText
  const state = { actions: [], logs: [], playerState: { isPlay: false }, handler: null, query: deferred() }
  const stubs = {
    '@/utils/nativeModules/utils': { onRemoteCommand: (handler) => { state.handler = handler; return () => {} } },
    '@/core/player/player': {
      pause: () => state.actions.push('pause'),
      playNext: () => state.actions.push('next'),
      playPrev: () => state.actions.push('prev'),
      requestPlay: () => state.actions.push('play'),
      togglePlay: () => state.actions.push('toggle'),
    },
    '@/core/player/timeoutExit': { markTimeoutExitInteraction: () => {} },
    '@/plugins/player/engine': { getUnifiedPlaybackState: () => state.query.promise },
    '@/store/player/state': state.playerState,
  }
  const mod = new Module(sourcePath, null)
  mod.filename = sourcePath
  mod.paths = Module._nodeModulePaths(path.dirname(sourcePath))
  const originalLoad = Module._load
  Module._load = function(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    mod._compile(output, sourcePath)
  } finally {
    Module._load = originalLoad
  }
  mod.exports.default()
  return state
}

const flush = async() => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

const runCase = async({ source, sourcePath, isPlay, queryMode, lateState }) => {
  const state = loadModule(sourcePath, source)
  state.playerState.isPlay = isPlay
  const timers = []
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  const originalLog = console.log
  global.setTimeout = (cb, ms) => { const timer = { cb, ms, canceled: false }; timers.push(timer); return timer }
  global.clearTimeout = (timer) => { if (timer) timer.canceled = true }
  console.log = (...args) => { state.logs.push(args.join(' ')) }
  try {
    state.handler({ command: 'toggle' })
    if (queryMode === 'fast') {
      state.query.resolve(lateState)
      await flush()
    } else if (queryMode === 'reject') {
      state.query.reject(new Error('simulated query failure'))
      await flush()
    } else {
      for (const timer of timers) {
        if (!timer.canceled) { timer.canceled = true; timer.cb() }
      }
      if (queryMode === 'late') {
        state.query.resolve(lateState)
        await flush()
      }
    }
    for (const timer of timers) {
      if (!timer.canceled) { timer.canceled = true; timer.cb() }
    }
    await flush()
  } finally {
    console.log = originalLog
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
  return state
}

const main = async() => {
  const isDefaultSource = !process.env.LX_REMOTE_COMMAND_PATH
  const source = fs.readFileSync(SOURCE_PATH, 'utf8').replace(/\r\n/g, '\n')
  const results = []
  const check = (name, ok, detail) => results.push([name, ok, detail])
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  // C1 快速路径：镜像=暂停，引擎=在播 → 按引擎动作 pause（不是 play）
  {
    const s = await runCase({ source, sourcePath: SOURCE_PATH, isPlay: false, queryMode: 'fast', lateState: 'playing' })
    check('C1 查询快速返回按引擎状态动作', same(s.actions, ['pause']), `actions=${JSON.stringify(s.actions)}`)
  }

  // C2 查询挂起：超时按镜像意图先动作，且不再出现 togglePlay
  {
    const s = await runCase({ source, sourcePath: SOURCE_PATH, isPlay: true, queryMode: 'hang' })
    check('C2 查询挂起时按镜像意图兜底（pause）', same(s.actions, ['pause']), `actions=${JSON.stringify(s.actions)}`)
    check('C2 兜底不再使用滞后 togglePlay()', !s.actions.includes('toggle'), `actions=${JSON.stringify(s.actions)}`)
  }

  // C3 兜底后晚到且引擎仍相悖：同方向对齐一次（pause 再来一次，绝不反向）
  {
    const s = await runCase({ source, sourcePath: SOURCE_PATH, isPlay: true, queryMode: 'late', lateState: 'playing' })
    check('C3 兜底空操作后同方向对齐一次', same(s.actions, ['pause', 'pause']), `actions=${JSON.stringify(s.actions)}`)
    check('C3 校正不反转、不补 toggle', !s.actions.includes('play') && !s.actions.includes('toggle'), `actions=${JSON.stringify(s.actions)}`)
    check('C3 有可诊断日志', /fallback/.test(s.logs.join('\n')) && /re-apply/.test(s.logs.join('\n')), `logs=${JSON.stringify(s.logs)}`)
  }

  // C4 兜底后晚到但已达目标：不补动作
  {
    const s = await runCase({ source, sourcePath: SOURCE_PATH, isPlay: true, queryMode: 'late', lateState: 'paused' })
    check('C4 已达目标时不做多余动作', same(s.actions, ['pause']), `actions=${JSON.stringify(s.actions)}`)
  }

  // C5 反向滞后（旧实现会丢按）：镜像=暂停，兜底 play，引擎仍是 paused → 再对齐一次 play
  {
    const s = await runCase({ source, sourcePath: SOURCE_PATH, isPlay: false, queryMode: 'late', lateState: 'paused' })
    check('C5 播放未生效时同方向对齐一次', same(s.actions, ['play', 'play']), `actions=${JSON.stringify(s.actions)}`)
  }

  // C6 查询 reject：回退到镜像意图
  {
    const s = await runCase({ source, sourcePath: SOURCE_PATH, isPlay: false, queryMode: 'reject' })
    check('C6 查询失败回退镜像意图（play）', same(s.actions, ['play']), `actions=${JSON.stringify(s.actions)}`)
  }

  // C7 快速路径单次按压只动作一次
  {
    const s = await runCase({ source, sourcePath: SOURCE_PATH, isPlay: true, queryMode: 'fast', lateState: 'paused' })
    check('C7 单次按压只动作一次', same(s.actions, ['play']), `actions=${JSON.stringify(s.actions)}`)
  }

  // 反例自检：去掉晚到校正块，C3 场景必须退化为只有一次动作（仅对默认源断言）
  if (isDefaultSource) {
    const tampered = source.replace(
      /if \(!corrected && fallbackIntent != null && engineIntent === fallbackIntent\) \{[\s\S]*?\n {12}\}\n/,
      'if (false) {\n            }\n',
    )
    if (tampered === source) throw new Error('反例 tamper 锚点未命中')
    const s = await runCase({ source: tampered, sourcePath: SOURCE_PATH, isPlay: true, queryMode: 'late', lateState: 'playing' })
    check('反例：删掉晚到校正后 C3 只动作一次（证明测试有区分力）', same(s.actions, ['pause']), `actions=${JSON.stringify(s.actions)}`)
  }

  // 反例自检：兜底退回 togglePlay()，C2 必须变成 toggle（仅对默认源断言）
  if (isDefaultSource) {
    const tampered = source
      .replace(
        "import { pause, playNext, playPrev, requestPlay } from '@/core/player/player'",
        "import { pause, playNext, playPrev, requestPlay, togglePlay } from '@/core/player/player'",
      )
      .replace(
        'settle(() => { applyToggleIntent(mirrorIntent) })',
        'settle(() => { void togglePlay() })',
      )
    if (tampered === source) throw new Error('反例 tamper 锚点未命中（applyToggleIntent）')
    const s = await runCase({ source: tampered, sourcePath: SOURCE_PATH, isPlay: true, queryMode: 'hang' })
    check('反例：兜底退回 togglePlay 后 C2 变成 toggle（证明判定有效）', same(s.actions, ['toggle']), `actions=${JSON.stringify(s.actions)}`)
  }

  let failed = 0
  for (const [name, ok, detail] of results) {
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  —— ' + detail}`)
  }
  if (failed) {
    console.error(`\nFAIL  toggle 韧性契约未通过（${failed}/${results.length}）`)
    process.exit(1)
  }
  console.log(`\nPASS  toggle 快速路径/超时兜底/晚到同向对齐均生效（${results.length} 例）`)
  process.exit(0)
}

void main()
