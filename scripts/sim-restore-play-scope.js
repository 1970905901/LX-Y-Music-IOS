/**
 * 「记住播放进度」不得跨歌生效 —— 启动恢复的 seek 时间必须绑定歌曲身份。
 *
 * 用户实锤：听歌中途退出 → 重开 App（自动恢复了上次那首歌的进度，但没起播）→
 * 直接点**另一首**歌 → 新歌从上一首的进度位置开始播放。
 *
 * 根因（src/core/player/player.ts）：
 *   handleRestorePlay() 只把恢复位置写进一个**全局单例** pendingRestoreSeekTime，
 *   等「被恢复那首歌」的 setMusicUrl() 加载 URL 时才消费。用户启动后直接点别的歌时，
 *   那次 setMusicUrl() 会把这个全局值当成自己的起点 → 新歌被 seek 到旧歌位置
 *   （真机表现：新歌不是从头播放，而是从上一首听到的进度处接着放）。
 *
 * 修法：pendingRestoreSeek 带 key（createGettingUrlId = 歌曲 id + 切源 id），
 *   setMusicUrl 只在 key 命中当前这首歌时使用它，其它歌一律 0，并在加载完成时消费掉。
 *
 * 本脚本从源码抽取真实写法做断言，并带反例自检 —— 这类「状态跨歌泄漏」回归
 * tsc/eslint 全无感，只能靠契约绑住。
 * 运行：node scripts/sim-restore-play-scope.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = 'src/core/player/player.ts'
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const real = read(SRC)

const invariants = (src) => {
  const reasons = []

  // ① 全局恢复 seek 必须带歌曲身份（key），不能是裸 number
  if (!/let\s+pendingRestoreSeek\s*:\s*\{\s*key:\s*string,\s*time:\s*number\s*\}\s*\|\s*null\s*=\s*null/.test(src)) {
    reasons.push('pendingRestoreSeek 未带歌曲身份（key）：全局单例会被「下一首加载的歌」消费')
  }

  // ② 写入侧：handleRestorePlay 用当前歌曲身份绑定恢复位置
  //    （在 handleRestorePlay 的窗口里找赋值点，不依赖具体写法，便于反例篡改后仍能判定）
  const restoreAt = src.indexOf('const restoreTime =')
  const writeWindow = restoreAt >= 0 ? src.slice(restoreAt, restoreAt + 400) : ''
  if (!/pendingRestoreSeek\s*=/.test(writeWindow)) {
    reasons.push('handleRestorePlay 未写明 pendingRestoreSeek（恢复位置根本没交给加载路径）')
  } else if (!/key:\s*createGettingUrlId\(\s*musicInfo\s*\)/.test(writeWindow)) {
    reasons.push('handleRestorePlay 写入恢复位置时未绑定当前歌曲 id（缺 key: createGettingUrlId(musicInfo)）')
  }

  // ③ 读取侧：setMusicUrl 必须按 key 判定「是不是被恢复的那首歌」
  if (!/const\s+isRestoredMusic\s*=\s*!isRefresh\s*&&\s*restoreSeek\s*!=\s*null\s*&&\s*restoreSeek\.key\s*===\s*createGettingUrlId\(\s*musicInfo\s*\)/.test(src)) {
    reasons.push('setMusicUrl 未按 key 判定「是不是被恢复的那首歌」（别的歌会沿用恢复位置）')
  }
  if (!/Promise\.resolve\(isRestoredMusic\s*\?\s*restoreSeek\.time\s*:\s*0\)/.test(src)) {
    reasons.push('非 refresh 路径未在 key 未命中时回到 0（新歌仍会从旧歌进度开始）')
  }

  // ④ 一次性消费仍然存在
  if (!/pendingRestoreSeek = null/.test(src)) {
    reasons.push('恢复位置没有一次性消费点（会跨歌残留到更后面）')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型（1:1 复刻上述两条分支）：证明「恢复 A 后直接播 B」不会拿到 A 的位置
// ---------------------------------------------------------------------------

const makeState = () => ({ pending: null })
const restoreInto = (state, key, time) => {
  state.pending = time > 0 ? { key, time } : null
}
const startMusic = (state, key, isRefresh = false) => {
  const restoreSeek = state.pending
  const isRestoredMusic = !isRefresh && restoreSeek != null && restoreSeek.key === key
  const time = isRefresh ? 0 : (isRestoredMusic ? restoreSeek.time : 0)
  state.pending = null // 一次性消费（真实实现：URL 加载完成后清）
  return time
}

const modelChecks = () => {
  const results = []
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail })

  // 场景：恢复 A（进度 100s）→ 用户直接点 B
  const s1 = makeState()
  restoreInto(s1, 'A_', 100)
  const timeB = startMusic(s1, 'B_')
  check('恢复 A(100s) 后直接播 B → B 从 0 开始（用户报告的场景）', timeB === 0, `B 起点=${timeB}s`)

  // 同一个全局值被 B 消费后不得残留
  const s2 = makeState()
  restoreInto(s2, 'A_', 100)
  startMusic(s2, 'B_')
  const timeAAfterB = startMusic(s2, 'A_')
  check('A 的恢复位置被 B 消费后不再残留（随后再播 A 也从 0 开始）', timeAAfterB === 0, `A 起点=${timeAAfterB}s`)

  // 正常恢复：直接播 A（或播放键播放 A）→ 仍精确恢复到 100s
  const s3 = makeState()
  restoreInto(s3, 'A_', 100)
  const timeA = startMusic(s3, 'A_')
  check('正常恢复：被恢复的那首歌仍精确 seek 回保存进度（100s）', timeA === 100, `A 起点=${timeA}s`)

  // 关闭「记住播放进度」→ restoreTime 为 0，不写全局值
  const s4 = makeState()
  restoreInto(s4, 'A_', 0)
  check('关闭「记住播放进度」时不写恢复位置（A 从 0 开始）', s4.pending === null && startMusic(s4, 'A_') === 0, '')

  return results
}

// ---------------------------------------------------------------------------
// 反例（篡改源码后必须被拦下）
// ---------------------------------------------------------------------------

const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.replace(find, replace)
}

const runCounterExamples = () => {
  const results = []
  const check = (name, src, expectSubstr) => {
    let reasons = []
    try {
      reasons = invariants(src)
    } catch (e) {
      results.push({ name, ok: false, detail: `抛异常: ${e.message}` })
      return
    }
    const hit = reasons.some(r => r.includes(expectSubstr))
    results.push({ name, ok: hit, detail: hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）` })
  }

  // R1 回退成裸 number（旧实现）
  check('R1 恢复位置回退成全局裸时间', tamper(real,
    'let pendingRestoreSeek: { key: string, time: number } | null = null',
    'let pendingRestoreSeek: number | null = null'),
  '未带歌曲身份')

  // R2 写入时不绑定歌曲
  check('R2 写入恢复位置不绑定歌曲', tamper(real,
    'pendingRestoreSeek = restoreTime > 0 ? { key: createGettingUrlId(musicInfo), time: restoreTime } : null',
    'pendingRestoreSeek = { key: \'unknown\', time: restoreTime }'),
  '未绑定当前歌曲 id')

  // R3 读取时不比对 key
  check('R3 读取恢复位置不比对 key', tamper(real,
    'const isRestoredMusic = !isRefresh && restoreSeek != null && restoreSeek.key === createGettingUrlId(musicInfo)',
    'const isRestoredMusic = !isRefresh && restoreSeek != null'),
  '未按 key 判定')

  // R4 未命中时仍用恢复位置（新歌被 seek 到旧进度）
  check('R4 key 未命中仍沿用恢复位置', tamper(real,
    'Promise.resolve(isRestoredMusic ? restoreSeek.time : 0)',
    'Promise.resolve(restoreSeek?.time ?? 0)'),
  '未在 key 未命中时回到 0')

  // R5 去掉一次性消费
  check('R5 去掉一次性消费', tamper(real,
    '    // 一次性消费：无论这次加载的是不是被恢复的那首歌，都清掉这个全局值\n    pendingRestoreSeek = null\n',
    ''),
  '没有一次性消费点')

  return results
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const realReasons = invariants(real)
const model = modelChecks()
const ce = runCounterExamples()

console.log('=== sim-restore-play-scope ===\n')
console.log('[源码不变量]')
if (realReasons.length === 0) console.log('  PASS 启动恢复 seek 已按歌曲身份绑定（写入/读取/消费三处齐备）')
else realReasons.forEach(r => console.log('  FAIL ' + r))

console.log('\n[行为模型：恢复 A 后直接播 B]')
model.forEach(r => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? '   [' + r.detail + ']' : ''}`))

console.log('\n[反例自检]')
ce.forEach(r => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name} —— ${r.detail}`))

const failed = realReasons.length + model.filter(r => !r.ok).length + ce.filter(r => !r.ok).length
console.log(`\n结果：${failed ? `有 ${failed} 项失败` : 'ALL PASS'}（不变量 ${realReasons.length === 0 ? '1/1' : '有失败'}；行为模型 ${model.filter(r => r.ok).length}/${model.length}；反例 ${ce.filter(r => r.ok).length}/${ce.length}）`)
process.exit(failed ? 1 : 0)
