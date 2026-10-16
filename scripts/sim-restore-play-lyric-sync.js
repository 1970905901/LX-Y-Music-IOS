/**
 * sim-restore-play-lyric-sync.js
 *
 * 「记住播放进度 → 重启 App → 再点播放刚才播的那首歌，歌词与音频同步」契约。
 *
 * 根因拆解：
 *   ① 启动恢复与恢复起播未接入 playProgress 的恢复意图（handleRestorePlay）：
 *      - setMusicUrl 消费 pendingRestoreSeek(time > 0) 时未同步登记 restorePlayTime /
 *        isRestorePlayColdStart / lastSeekIntentAt / seekTargetPosition / audioClock；
 *      - AVPlayer（trackPlayer）在未起播冷流上做预加载 seek 时，出声瞬间引擎报告位置可能已
 *        等于目标值（|pos - resumeTime| <= 0.3），但实际可听音频帧存在固定偏移（与长暂停
 *        恢复完全同因）；或首拍 playing 到达时异步 seek 尚未落地（position <= 1），被
 *        syncFromEngine 直接采信清窗、把进度与歌词打回 0s；
 *      - nativeFlac 冷起播从 0 解码到目标位置耗时长达 3~8s，因缺 lastSeekIntentAt 宽限期，
 *        3s 缓冲看门狗会误判卡死并向前跳 3~6s；
 *   ② 列表点击同一首恢复歌曲（playList / playListById）时，setPlayMusicInfo 先把
 *      nowPlayTime 归零并触发 musicToggled 落盘 0，随后 setMusicUrl 又按 pendingRestoreSeek
 *      把音频 seek 到记忆位置，导致 store 进度为 0、音频在记忆位置，core/lyric 的
 *      getReliableLyricPosition 误判为上一首残留位置而把歌词锁在 0s；
 *   ③ plugins/lyric.ts 的 setLyric 与 core/lyric.ts 的 getReliableLyricPosition 在
 *      position <= 1 且 progressPosition >= 2 的恢复窗口内未回退记忆进度，歌词异步到达时
 *      把高亮行重置回第 0 行；
 *   ④ seek.ts（seekToTime）与 nativeFlac.ts（seekNativeFlacPlayback）在从 0s 起播 seek 时，
 *      `currentPosition > 0 ? currentPosition : position` 把未生效的 0 替换成 targetTime，
 *      导致两轮轮询后误判已收敛提前退出。
 *
 * 运行：node scripts/sim-restore-play-lyric-sync.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  player: 'src/core/player/player.ts',
  playProgress: 'src/core/init/player/playProgress.ts',
  coreLyric: 'src/core/lyric.ts',
  pluginLyric: 'src/plugins/lyric.ts',
  seek: 'src/plugins/player/seek.ts',
  nativeFlac: 'src/plugins/player/nativeFlac.ts',
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const REAL = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]))

const invariants = (files) => {
  const reasons = []

  // ① player.ts：列表点播与 setMusicUrl 必须保持恢复进度并触发 seekLyric
  if (!/export const isPendingRestorePlay =/.test(files.player)) {
    reasons.push('player.ts 缺 isPendingRestorePlay 导出（playProgress 无法识别待消费的恢复曲目）')
  }
  if (!/if \(isRestoredMusic && restoreSeek\.time > 0\) \{[\s\S]{0,200}?updatePlayProgress\(restoreSeek\.time[\s\S]{0,120}?global\.app_event\.seekLyric\(restoreSeek\.time\)/.test(files.player)) {
    reasons.push('setMusicUrl 缺少恢复曲目起播前的进度与 seekLyric 同步')
  }
  if (!/if \(currentTime > 0\) \{[\s\S]{0,200}?updatePlayProgress\(currentTime[\s\S]{0,120}?global\.app_event\.seekLyric\(currentTime\)/.test(files.player)) {
    reasons.push('setMusicUrl 在 URL 就绪后未对 currentTime > 0 同步进度与 seekLyric')
  }
  if (!/if \(isRestoredTarget && restoreSeek\.time > 0\) \{[\s\S]{0,200}?updatePlayProgress\(restoreSeek\.time, prevMaxTime\)/.test(files.player)) {
    reasons.push('playList / playListById 在点击被恢复的那首歌时未恢复被 setPlayMusicInfo 归零的进度')
  }

  // ② playProgress.ts：接入 seekLyric → handleRestorePlay + 冷流回拉 + syncFromEngine 0s 守卫
  if (!/let isRestorePlayColdStart = false/.test(files.playProgress)) {
    reasons.push('playProgress.ts 缺 isRestorePlayColdStart 冷起播标记')
  }
  if (!/global\.app_event\.on\('seekLyric',\s*handleRestorePlay\)/.test(files.playProgress)) {
    reasons.push('playProgress.ts 未订阅 seekLyric 到 handleRestorePlay（恢复起播无回拉/宽限/窗口保护）')
  }
  if (!/const handleRestorePlay = \(time: number\) => \{[\s\S]{0,600}?restorePlayTime = time[\s\S]{0,200}?isRestorePlayColdStart = true[\s\S]{0,300}?audioClock\.setAnchor\(/.test(files.playProgress)) {
    reasons.push('handleRestorePlay 未完整登记 restorePlayTime / isRestorePlayColdStart / audioClock 锚点')
  }
  if (!/const forceColdStartPullBack = isRestorePlayColdStart && restorePlayTime != null && event\.driver == 'trackPlayer'/.test(files.playProgress) ||
      !/if \(!\(forceColdStartPullBack && !isLocalTrack\) && Math\.abs\(\(position \|\| 0\) - resumeTime\) <= 0\.3\) return/.test(files.playProgress)) {
    reasons.push('playing 分支未对 trackPlayer 在线冷起播执行强制精确回拉（报告位置≈目标但可听音频偏移无法消除）')
  }
  if (!/stamped\.position <= 1 && seekTargetPosition >= 2/.test(files.playProgress)) {
    reasons.push('syncFromEngine 缺少 seek 窗口内 0s 瞬态位置拦截（起播 seek 未落地前会把进度与歌词打回 0s）')
  }

  // ③ core/lyric.ts 与 plugins/lyric.ts：恢复窗口内 position <= 1 回退记忆进度
  if (!/playerPosition <= 0 \|\| \(playerPosition <= 1 && progressPosition >= 2\)/.test(files.coreLyric)) {
    reasons.push('core/lyric.ts getReliableLyricPosition 未在 playerPosition <= 1 && progressPosition >= 2 时回退记忆进度')
  }
  if (!/else if \(targetPosition <= 1 && progressPosition >= 2\)/.test(files.pluginLyric)) {
    reasons.push('plugins/lyric.ts setLyric 未在引擎位置 <= 1 且有记忆进度时回退记忆进度')
  }

  // ④ seek.ts 与 nativeFlac.ts：从 0s 起播 seek 时不得把 currentPosition == 0 当成已收敛
  if (!/if \(currentPosition > 0 \|\| targetTime <= tolerance\)/.test(files.seek)) {
    reasons.push('seek.ts 在 currentPosition 为 0 时仍会回退成 targetTime 并误判已收敛')
  }
  if (!/if \(currentPosition > 0 \|\| targetTime <= tolerance\)/.test(files.nativeFlac)) {
    reasons.push('nativeFlac.ts 在 currentPosition 为 0 时仍会回退成 targetTime 并误判已收敛')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：复刻「记住播放进度 80s → 重启 App → 点播刚才那首歌」全链路
// ---------------------------------------------------------------------------
const runRestorePlayScenario = ({
  viaListTap = false,
  coldStreamAudioOffsetSec = -6,
  transientZeroBeforeSeekLands = true,
  hasFix = true,
}) => {
  let storeProgress = 80
  let pendingRestore = { key: 'songA_', time: 80 }
  let lyricTimeSec = 80
  let audioReportSec = 0
  let audioAudibleSec = 0
  let restorePlayTime = null
  let isColdStart = false

  const onSeekLyric = (t) => {
    lyricTimeSec = t
    if (hasFix) {
      restorePlayTime = t
      isColdStart = true
    }
  }

  // 用户在列表点击刚才播的那首歌（playList → setPlayMusicInfo 先归零）
  if (viaListTap) {
    const isRestoredTarget = pendingRestore && pendingRestore.key === 'songA_'
    storeProgress = 0
    if (hasFix && isRestoredTarget && pendingRestore.time > 0) {
      storeProgress = pendingRestore.time
      onSeekLyric(pendingRestore.time)
    }
  }

  // setMusicUrl 消费 pendingRestoreSeek
  const currentTime = pendingRestore ? pendingRestore.time : 0
  pendingRestore = null
  if (hasFix && currentTime > 0) {
    storeProgress = currentTime
    onSeekLyric(currentTime)
  }

  // 预加载 seek（冷流）：引擎报告位置到了 80s，但可听音频帧偏移了 -6s（实际听到 74s）
  audioReportSec = currentTime
  audioAudibleSec = currentTime + coldStreamAudioOffsetSec

  // 若首拍 playing 到达时异步 seek 尚在途中（瞬态报 0.05s）
  if (transientZeroBeforeSeekLands) {
    const firstStamp = 0.05
    if (hasFix) {
      // getReliableLyricPosition 与 syncFromEngine 均拦截 <=1s 的瞬态值
      lyricTimeSec = (firstStamp <= 1 && storeProgress >= 2) ? storeProgress : firstStamp
    } else {
      storeProgress = firstStamp
      lyricTimeSec = firstStamp
    }
  }

  // playing 事件触发：检查出声回拉
  if (hasFix && restorePlayTime != null) {
    const resumeTime = restorePlayTime
    const forceCold = isColdStart
    restorePlayTime = null
    isColdStart = false
    if (forceCold || Math.abs(audioReportSec - resumeTime) > 0.3) {
      // 在已就绪的 playing 流上做零容差精确 seek：报告位置与可听位置同时对齐到 resumeTime
      audioReportSec = resumeTime
      audioAudibleSec = resumeTime
      storeProgress = resumeTime
      lyricTimeSec = audioReportSec
    }
  } else {
    // 旧行为：无恢复回拉（或被 |80 - 80| <= 0.3 放过），歌词锚定报告位置，但可听音频仍在 74s
    if (!transientZeroBeforeSeekLands) {
      lyricTimeSec = storeProgress <= 1 && audioReportSec > 5 ? storeProgress : audioReportSec
    }
  }

  return {
    lyricTimeSec,
    audioAudibleSec,
    desyncSec: Math.abs(lyricTimeSec - audioAudibleSec),
  }
}

const models = [
  [
    '修复后（底部播放键恢复起播）：冷流偏移 + 首拍瞬态 0s 下歌词与可听音频 0 偏差',
    runRestorePlayScenario({ viaListTap: false, hasFix: true }).desyncSec === 0,
  ],
  [
    '修复后（列表点击刚才那首歌起播）：store 进度不丢、歌词与可听音频 0 偏差',
    runRestorePlayScenario({ viaListTap: true, hasFix: true }).desyncSec === 0,
  ],
  [
    '反例（旧行为·底部播放键）：冷流偏移与瞬态 0s 导致歌词与音频严重失步',
    runRestorePlayScenario({ viaListTap: false, hasFix: false }).desyncSec > 5,
  ],
  [
    '反例（旧行为·列表点播同曲）：setPlayMusicInfo 归零后歌词从 0s 走、音频从 80s 放',
    runRestorePlayScenario({ viaListTap: true, transientZeroBeforeSeekLands: false, hasFix: false }).desyncSec > 60,
  ],
]

// ---------------------------------------------------------------------------
// 反例自检
// ---------------------------------------------------------------------------
const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.split(find).join(replace)
}

const cases = []
const checkCase = (name, mutated, expectSubstr) => {
  let reasons = []
  try {
    reasons = invariants({ ...REAL, ...mutated })
  } catch (err) {
    cases.push([name, false, `抛异常: ${err.message}`])
    return
  }
  const hit = reasons.some((r) => r.includes(expectSubstr))
  cases.push([name, hit, hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）`])
}

checkCase('C1 playProgress 取消订阅 seekLyric', {
  playProgress: tamper(REAL.playProgress, "  global.app_event.on('seekLyric', handleRestorePlay)", '  // unsubscribed'),
}, '未订阅 seekLyric')

checkCase('C2 playing 分支去掉冷流强制精确回拉', {
  playProgress: tamper(
    REAL.playProgress,
    'if (!(forceColdStartPullBack && !isLocalTrack) && Math.abs((position || 0) - resumeTime) <= 0.3) return',
    'if (Math.abs((position || 0) - resumeTime) <= 0.3) return',
  ),
}, '未对 trackPlayer 在线冷起播执行强制精确回拉')

checkCase('C3 syncFromEngine 去掉 seek 窗口 0s 瞬态拦截', {
  playProgress: tamper(
    REAL.playProgress,
    "if (engineState !== 'playing' || (seekTargetPosition != null && Date.now() < seekHoldUntil && stamped.position <= 1 && seekTargetPosition >= 2)) {",
    "if (engineState !== 'playing') {",
  ),
}, '缺少 seek 窗口内 0s 瞬态位置拦截')

checkCase('C4 seek.ts 回退 currentPosition > 0 假收敛写法', {
  seek: tamper(
    REAL.seek,
    'if (currentPosition > 0 || targetTime <= tolerance) {',
    'if (true) {',
  ),
}, 'seek.ts 在 currentPosition 为 0 时')

checkCase('C5 core/lyric.ts 去掉恢复窗口进度回退', {
  coreLyric: tamper(
    REAL.coreLyric,
    'if (playerPosition <= 0 || (playerPosition <= 1 && progressPosition >= 2)) return progressPosition',
    'if (playerPosition <= 0) return progressPosition',
  ),
}, 'getReliableLyricPosition')

const realReasons = invariants(REAL)
const failedModels = models.filter(([, ok]) => !ok)
const missed = cases.filter(([, ok]) => !ok)

console.log('=== sim-restore-play-lyric-sync ===\n')
console.log('[行为模型]')
for (const [name, ok] of models) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('\n[反例自检]')
for (const [name, ok, detail] of cases) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)

let failed = 0
if (realReasons.length) {
  console.error(`\nFAIL  结构不变量未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`  - ${r}`)
  failed += 1
}
if (failedModels.length) failed += 1
if (missed.length) failed += 1

if (!failed) {
  console.log(`\nPASS  记住播放进度重启恢复歌词同步契约全部通过（结构不变量 4 组 + 行为模型 ${models.length} 例 + 反例 ${cases.length} 例）`)
  process.exit(0)
}
process.exit(1)
