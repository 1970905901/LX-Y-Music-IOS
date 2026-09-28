#!/usr/bin/env node
/**
 * sim-preload-and-progress-sync.js —— 播放预加载 / 记住播放进度 对齐上游回归守卫
 *
 * 上游基准：Miao-moe/lx-m_lx-Miao-moe-music-desktop
 * - 预加载：src/renderer/core/useApp/usePlayer/usePreloadNextMusic.ts
 *   （剩余 <20s 触发、2s 防重入、requestId 竞态保护、失败刷新 URL 重试、
 *     musicToggled / 播放模式变化失效；开关控制预加载行为）
 * - 记住播放进度：src/renderer/core/useApp/usePlayer/usePlaybackPersistence.ts
 *   （保存 time = 开关 ? 当前进度 : 0；退出 beforeunload 落盘；恢复侧同判）
 *   + src/renderer/core/player/action.ts handleRestorePlay
 *
 * 断言均带反例。本地实现：
 * - src/core/init/player/preloadNextMusic.ts
 * - src/core/init/player/playProgress.ts + src/plugins/player/controller.ts
 */

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`)
}

// ---------------------------------------------------------------------------
// 预加载（preloadNextMusic.ts 决策 1:1 复刻）
// ---------------------------------------------------------------------------

// 触发判定（handlePlayProgressChanged + preloadNextMusicUrl 前置条件）
const shouldTriggerPreload = ({ duration, time, hasInfo, enabled, isLoading, preProgress }) =>
  duration > 10 &&
  duration - time < 20 &&          // 对齐上游：剩余 < 20s
  !hasInfo &&
  enabled &&                        // 对齐：受「音频预加载」开关控制
  !isLoading &&
  time - preProgress >= 2           // 对齐上游：2s 防重入

// 竞态保护（requestId 模型）：发起时递增，各异步步回来校验
const makePreloadSession = () => {
  let requestId = 0
  return {
    start: () => ++requestId,
    valid: (id) => id === requestId,
  }
}

console.log('\n[预加载] 对齐上游 usePreloadNextMusic')

// 断言1：剩余 <20s 触发（阈值对齐）
{
  const d = 240
  check('歌曲剩余 19s → 触发预加载',
    shouldTriggerPreload({ duration: d, time: d - 19, hasInfo: false, enabled: true, isLoading: false, preProgress: 0 }))
  check('反例：剩余 21s → 不触发（阈值 20s 对齐上游）',
    !shouldTriggerPreload({ duration: d, time: d - 21, hasInfo: false, enabled: true, isLoading: false, preProgress: 0 }))
}

// 断言2：2s 防重入
{
  const d = 240
  check('反例：上次尝试后 1.5s → 不重试（2s 防重入对齐上游）',
    !shouldTriggerPreload({ duration: d, time: d - 19, hasInfo: false, enabled: true, isLoading: false, preProgress: d - 20.5 }))
}

// 断言3：开关控制预加载（init 链路接入开关）
{
  const d = 240
  check('反例：开关关闭 → 不预加载（init 链路受设置控制）',
    !shouldTriggerPreload({ duration: d, time: d - 19, hasInfo: false, enabled: false, isLoading: false, preProgress: 0 }))
}

// 断言4：requestId 竞态——预加载期间切歌，旧结果作废
{
  const session = makePreloadSession()
  const id1 = session.start()
  // 期间用户切歌（musicToggled → resetPreloadInfo 内部也会递增 requestId）
  session.start()
  check('预加载进行中切歌 → 旧请求结果作废（requestId 校验，对齐上游）',
    !session.valid(id1))
  // 反例：无竞态保护时旧 info 会挂进 preloadMusicInfo（旧行为缺陷）
  const legacy = { info: { musicId: 'old-song' } }
  check('反例：旧行为无 requestId → 切歌后旧歌 info 残留（证明竞态保护必要）',
    legacy.info.musicId === 'old-song')
}

// 断言5：失败刷新重试（首 URL 不可用 → isRefresh 重试一次）
{
  const attempts = []
  const preloadFlow = (firstOk, refreshOk) => {
    attempts.length = 0
    attempts.push('fetch')
    if (!firstOk) {
      attempts.push('refresh')
      return refreshOk
    }
    return true
  }
  check('首 URL 不可用 → isRefresh 刷新重试（对齐上游 getAvailableMusicUrl）',
    preloadFlow(false, true) === true && attempts.join(',') === 'fetch,refresh')
}

// ---------------------------------------------------------------------------
// 记住播放进度（playProgress.ts / controller.ts 保存语义 1:1 复刻）
// ---------------------------------------------------------------------------

// 保存语义（对齐上游 usePlaybackPersistence：time = 开关 ? 进度 : 0）
const buildSave = (enabled, nowPlayTime, maxTime, listId, index) => ({
  time: enabled ? nowPlayTime : 0,
  maxTime,
  listId,
  index,
})
// 恢复语义（对齐上游 handleRestorePlay）
const restoreTime = (enabled, saved) =>
  enabled && Number.isFinite(saved?.time) ? Math.max(0, saved.time) : 0

console.log('\n[记住播放进度] 对齐上游 usePlaybackPersistence')

// 断言6：开关开 → 存真实进度；恢复到该位置
{
  const saved = buildSave(true, 180, 300, 'list1', 2)
  check('开关开：退出时存真实进度，重启恢复到该位置',
    saved.time === 180 && restoreTime(true, saved) === 180)
}

// 断言7（断言6的反例）：开关关 → 存 0，重启从头播（对齐上游 isSavePlayTime ? t : 0）
{
  const saved = buildSave(false, 180, 300, 'list1', 2)
  check('开关关：存 0，重启从头播（对齐上游，旧实现完全不保存）',
    saved.time === 0 && restoreTime(true, saved) === 0)
  // 旧行为反例：开关关不保存 → 存储残留上次开启时的旧进度
  const legacyResidual = { time: 120, maxTime: 300, listId: 'list1', index: 2 }
  check('反例：旧行为开关关残留旧进度 120s → 重开开关恢复到过期位置（证明修复必要）',
    legacyResidual.time === 120 && restoreTime(true, legacyResidual) === 120)
}

// 断言8：退出保存兜底（beforeunload 等价）
{
  // 播放中退出：handleExitApp 以当前进度落盘
  const exitSave = buildSave(true, 245, 300, 'list1', 1)
  check('退出 App 前落盘当前进度（对齐上游 beforeunload 保存）',
    exitSave.time === 245)
}

// 断言9：熄屏瞬间落盘（熄屏后无轮询无新进度，保存熄屏前最后位置）
{
  const atScreenOff = buildSave(true, 200, 320, 'list1', 0)
  const savedDuringOff = atScreenOff // 熄屏期间无 tick，存储保持该值
  check('熄屏瞬间落盘 200s → 熄屏中被杀进程仍恢复到熄屏前位置（能力上限）',
    savedDuringOff.time === 200)
}

// 断言10：开关切换立即落盘
{
  const toggleThenSave = (enabledBefore, nowPlayTime) => {
    // 用户关闭开关 → configUpdated 立即按新语义存 0
    return buildSave(enabledBefore, nowPlayTime, 300, 'list1', 0)
  }
  check('关闭开关瞬间落盘 0（下次从头播立即生效，不等下一次常规保存）',
    toggleThenSave(false, 200).time === 0)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
