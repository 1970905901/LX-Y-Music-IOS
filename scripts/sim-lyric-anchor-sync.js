// 歌词时钟锚点滞后模型复刻：灵动岛/控制中心歌词恒定慢半拍的根因验证
//
// 机制：灵动岛/控制中心/锁屏歌词由原生 GCD 时钟驱动（AppDelegate.mm
// com.lxmusic.nowplaying.lyric 串行队列，0.12s tick）：
//   position = 锚点位置 LXNowPlayingLyricAnchorElapsedMs
//            + (CACurrentMediaTime*1000 − 锚点系统时间) × playbackRate
// 锚点由 JS 周期性回传的「引擎真实位置快照」重置（两条链路）：
//   A) 1s 慢校准：getPosition（桥往返1）→ await getPlaybackEngineState（桥往返2）
//      → reanchorNowPlayingLyric（桥去程3 + 主队列排队）
//   B) 换行元数据发布：getPosition（桥往返1）→ updateNowPlayingInfo（桥去程2）
//      → LXSetNowPlayingInfo → LXRefreshNowPlayingLyricAnchor（从缓存 elapsed 重锚）
//
// 根因：快照位置是「过去时刻」的值，旧逻辑把锚点系统时间钉在「现在」——
//   时钟值 = P(t_snap) + (t − t_apply) × rate = P(t) − (t_apply − t_snap) × rate
// 即歌词时钟恒定回拨一个「快照年龄」（完整桥接往返 ≈ 100~300ms），且每次
// 校准/换行都重新回拨 → 恒定滞后。App 内歌词走原生 4Hz 位置事件（无桥接
// 滞后）→ App 内准、灵动岛/控制中心慢半拍，即「灵动岛歌词不同步」。
//
// 修法（快照时刻回放）：
//   - nativeFlac 路径：新增 StreamingFlacPlayerModule.getPositionStamped，原生在
//     renderQueue 取位置时同拍打 CACurrentMediaTime 毫秒戳；重锚时锚点系统时间
//     = min(snapshotAt, now) → 与真实播放位置零偏差
//   - AVPlayer 路径（TrackPlayerModule 在 node_modules，无法打原生戳）：JS 以
//     「往返一半」估计快照年龄，重锚时锚点系统时间 = now − ageMs → 残余误差
//     ≤ ±往返/4（远小于旧行为的整段往返）
//   - 元数据/播放态发布链路：metadata 携带 elapsedTimeSnapshotAt / elapsedTimeAgeMs
//     （自定义透传键，不进系统 info 字典），LXSetNowPlayingInfo /
//     LXSetNowPlayingPlaybackState 在写入位置缓存时同步解析戳，
//     LXRefreshNowPlayingLyricAnchor 据此回放；无戳时清零防旧戳错配。
//
// 进度条基线（第二批断言）：系统进度条从每次发布的 ElapsedPlaybackTime 基线外推。
// 旧行为把快照时刻的过去值直接写进 info / 缓存，且原生 tick 行变化重发缓存时
// elapsed 仍是上次发布的旧值 → 基线每次发布回拨一个快照年龄（前台 ~150ms，
// 熄屏后 JS 挂起、只剩原生 tick 重发 → 回拨持续增大，进度条后跳、时间倒退）。
// 修法 = 写系统基线时把快照推进到「现在」（LXAdvanceElapsedToNowSec），tick 重发
// 前把基线刷新为时钟外推值；缓存 (值, 戳) 必须成对更新（错配会把歌词时钟推超前）。
//
// 本脚本 1:1 复刻锚点更新公式与外推公式，逐条验证 10 个断言（均带反例）。

'use strict'

// ---------------------------------------------------------------------------
// 模型基元
// ---------------------------------------------------------------------------

const RATE = 1

// 校准链路时序参数（毫秒，典型 RN 桥量级）：up1/down1 = getPosition 去程/回程，
// rtt2 = getPlaybackEngineState 往返，up2 = reanchor 去程 + 主队列排队
const _up1 = 75; const down1 = 75; const rtt2 = 120; const up2 = 60

// 真实播放位置：音频在时刻 t 的真值（线性，速率恒定）
const truePosition = (t0Ms, tMs) => (t0Ms + (tMs - 0) * RATE)

// 歌词时钟状态（复刻 AppDelegate.mm 静态量）
const makeClock = () => ({ anchorElapsedMs: 0, anchorSystemMs: 0, hold: false })

// 复刻 LXReanchorNowPlayingLyric(elapsedMs, snapshotAtMs, ageMs)（修复后）
// - snapshotAtMs > 0：锚点系统时间 = min(snapshotAt, now)（快照时刻精确回放）
// - 否则 ageMs > 0：锚点系统时间 = now − min(ageMs, 1000)（年龄补偿）
// - 都无：锚点系统时间 = now（旧行为——快照位置钉在现在）
const reanchor = (clock, elapsedMs, snapshotAtMs, ageMs, nowMs) => {
  clock.anchorElapsedMs = elapsedMs
  let anchorSystemMs = nowMs
  if (snapshotAtMs > 0) {
    anchorSystemMs = Math.min(snapshotAtMs, nowMs)
  } else if (ageMs > 0) {
    anchorSystemMs = nowMs - Math.min(ageMs, 1000)
  }
  clock.anchorSystemMs = anchorSystemMs
}

// 复刻 tick 的位置计算（hold 冻结语义同原生）
const clockPosition = (clock, nowMs) => (clock.hold
  ? clock.anchorElapsedMs
  : clock.anchorElapsedMs + (nowMs - clock.anchorSystemMs) * RATE)

// 复刻 LXResolveElapsedSnapshotAtMs（元数据发布链路的戳解析）
const resolveSnapshotAt = (payload, nowMs) => {
  if (payload.elapsedTimeSnapshotAt > 0) return Math.min(payload.elapsedTimeSnapshotAt, nowMs)
  if (payload.elapsedTimeAgeMs > 0) return nowMs - Math.min(payload.elapsedTimeAgeMs, 1000)
  return 0
}

// ---------------------------------------------------------------------------
// 场景模拟
// ---------------------------------------------------------------------------

// 模拟「每秒校准」完整时序（与 playProgress 慢路径逐段对应）：
//   t_req      JS 发起 getPositionStamped
//   t_snap     = t_req + up1                    原生 renderQueue 产生快照（up1 = 去程）
//   t_recv     = t_req + up1 + down1            JS 收到（stamped.ageMs = up1，往返对称假设）
//   t_engine   = t_recv + rtt2                  await getPlaybackEngineState 往返
//   t_apply    = t_engine + up2                 reanchor 去程 + 主队列排队，原生消费
// mode: 'legacy'（旧行为）| 'stamped'（原生戳）| 'age'（年龄估计，JS 补偿量 =
// (t_engine − t_req) − stamped.ageMs，即「发起→重锚前」总流逝 − 去程偏移）
const simulateCalibration = ({ up1 = 75, down1 = 75, rtt2 = 120, up2 = 60, periodMs = 1000, durationMs = 30000, mode }) => {
  const clock = makeClock()
  clock.anchorElapsedMs = 0
  clock.anchorSystemMs = 0
  let maxLead = 0
  const samples = []
  for (let t = 0; t <= durationMs; t += 12) {
    if (t > 0 && t % periodMs === 0) {
      const tReq = t - up1 - down1 - rtt2 - up2 // 使 t_apply 落在整点上
      const tSnap = tReq + up1
      const snapPos = truePosition(0, tSnap)
      if (mode === 'stamped') {
        reanchor(clock, snapPos, tSnap, 0, t)
      } else if (mode === 'age') {
        // JS 侧补偿量：总流逝(up1+down1+rtt2) − stamped.ageMs(up1) = down1 + rtt2
        reanchor(clock, snapPos, 0, down1 + rtt2, t)
      } else {
        reanchor(clock, snapPos, 0, 0, t)
      }
    }
    const lag = truePosition(0, t) - clockPosition(clock, t)
    maxLead = Math.max(maxLead, -lag)
    samples.push(lag)
  }
  // 稳态 = 最后 1/3 样本的中位数（排除启动瞬态）
  const tail = samples.slice(samples.length - Math.floor(samples.length / 3)).sort((a, b) => a - b)
  const steadyLag = tail[Math.floor(tail.length / 2)]
  return { steadyLag, maxLead }
}

// 模拟「换行元数据发布重锚」：JS 在 t_snap 取快照（桥往返 rtt 后发起发布），
// 原生 t_apply 处理 metadata（elapsed + 戳解析），LXRefreshNowPlayingLyricAnchor
// 用 (缓存 elapsed, 缓存戳) 重锚。每 lineEveryMs 一次。带反例（无戳 payload）。
const simulateMetadataReanchor = ({ rtt = 150, lineEveryMs = 5000, durationMs = 30000, withStamp }) => {
  const clock = makeClock()
  let cachedStampAt = 0 // LXNowPlayingElapsedSnapshotAtMs
  const samples = []
  for (let t = 0; t <= durationMs; t += 12) {
    if (t > 0 && t % lineEveryMs === 0) {
      const tSnap = t - rtt // 快照产生 → JS 收到 → 发起发布 → 原生 t_apply 处理
      const snapPos = truePosition(0, tSnap)
      // 复刻 LXSetNowPlayingInfo 的 elapsedTime 分支：缓存位置 + 解析戳
      const payload = withStamp
        ? { elapsedTimeSnapshotAt: tSnap }
        : {}
      cachedStampAt = resolveSnapshotAt(payload, t)
      // 复刻 LXRefreshNowPlayingLyricAnchor：从缓存 (elapsed, stamp) 重锚
      reanchor(clock, snapPos, cachedStampAt, 0, t)
    }
    samples.push(truePosition(0, t) - clockPosition(clock, t))
  }
  const tail = samples.slice(samples.length - Math.floor(samples.length / 3)).sort((a, b) => a - b)
  return { steadyLag: tail[Math.floor(tail.length / 2)] }
}

// ---------------------------------------------------------------------------
// 进度条基线模型（控制中心进度条后跳 / 左侧时间倒退）
// ---------------------------------------------------------------------------

// 系统进度条：从最近一次发布的 (elapsedBase, publishAt) 外推。
// republish 返回回拨幅度（旧显示值 − 新基线，> 0 即进度条后跳）。
const makeProgressBar = () => ({ base: 0, publishAt: 0 })
const progressAt = (bar, t) => bar.base + (t - bar.publishAt) * RATE
const republish = (bar, t, elapsedMs) => {
  const before = progressAt(bar, t)
  bar.base = elapsedMs
  bar.publishAt = t
  return before - elapsedMs
}

// 熄屏/后台场景：JS 定时器挂起、不再发布元数据，换行只靠原生 tick 重发缓存。
// 旧行为：缓存 elapsed 是后台前最后一次 JS 发布的快照值，tick 重发即回拨，
// 且随时间持续增大（几秒级——进度条后跳、时间倒退的主害场景）。
// 修复后：tick 重发前把基线刷新为歌词时钟外推的「现在」位置 → 零回拨。
const simulateBackgroundProgress = ({ lineEveryMs = 5000, rtt = 150, durationMs = 60000, mode }) => {
  const bar = makeProgressBar()
  let cachedElapsedMs = 0 // LXNowPlayingInfoCache[ElapsedPlaybackTime]
  let cachedStampAt = 0 // LXNowPlayingElapsedSnapshotAtMs（成对更新语义）
  let maxBackward = 0
  let published = false
  for (let t = 0; t <= durationMs; t += 12) {
    const isLine = t > 0 && t % lineEveryMs === 0
    if (!isLine) continue
    if (!published) {
      // 进后台前最后一次 JS 换行发布：快照产生于 t − rtt
      const tSnap = t - rtt
      const snapPos = truePosition(0, tSnap)
      if (mode === 'legacy') {
        cachedElapsedMs = snapPos // 旧行为：快照值原样进缓存，戳 = 0
        cachedStampAt = 0
      } else {
        // 修复后：LXAdvanceElapsedToNowSec 推进到现在 + 戳成对更新为 now
        cachedElapsedMs = snapPos + Math.min(t - tSnap, 1000) * RATE
        cachedStampAt = t
      }
      published = true
      maxBackward = Math.max(maxBackward, republish(bar, t, cachedElapsedMs))
      continue
    }
    // 原生 tick 行变化重发（行变化只在播放中发生）
    if (mode === 'legacy') {
      // 旧行为：重发缓存旧值 → 基线被拉回后台前的位置
      maxBackward = Math.max(maxBackward, republish(bar, t, cachedElapsedMs))
    } else {
      // 修复后：重发前把基线刷新为时钟外推的「现在」（复刻 tick 的
      // positionMs 刷新），缓存对同步滚动
      const clockNow = cachedElapsedMs + (t - cachedStampAt) * RATE
      maxBackward = Math.max(maxBackward, republish(bar, t, clockNow))
      cachedElapsedMs = clockNow
      cachedStampAt = t
    }
  }
  return { maxBackward }
}

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

let pass = 0; let fail = 0
const check = (name, ok, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`)
  ok ? pass++ : fail++
}

console.log('sim-lyric-anchor-sync：灵动岛/控制中心歌词锚点滞后模型\n')

// 断言1（缺陷复现/反例）：旧行为——快照位置被钉在现在，稳态滞后 = 完整快照年龄
// （快照产生于去程结束：t_snap = t_req + up1，年龄 = t_apply − t_snap = 255ms）
{
  const { steadyLag } = simulateCalibration({ mode: 'legacy' })
  const expected = down1 + rtt2 + up2
  check('旧行为稳态滞后 = 完整快照年龄（缺陷存在）',
    Math.abs(steadyLag - expected) < 5,
    `稳态滞后 ${steadyLag.toFixed(1)}ms，预期 ≈ ${expected}ms`)
}

// 断言2（修复验证，断言1的反例）：原生戳回放 → 滞后归零
{
  const { steadyLag, maxLead } = simulateCalibration({ mode: 'stamped' })
  check('原生戳回放稳态滞后 ≤ 1ms（修复生效，与断言1互为反例）',
    Math.abs(steadyLag) <= 1 && maxLead <= 1,
    `稳态滞后 ${steadyLag.toFixed(3)}ms，最大超前 ${maxLead.toFixed(3)}ms`)
}

// 断言3：AVPlayer 年龄估计 → 残余 = reanchor 去程 up2（对称往返下不可再消），
// 远小于旧行为的完整快照年龄
{
  const { steadyLag, maxLead } = simulateCalibration({ mode: 'age' })
  const expected = up2
  const legacy = down1 + rtt2 + up2
  check('年龄估计残余 = reanchor 去程（60ms），远小于旧行为（255ms）',
    Math.abs(steadyLag - expected) < 5 && maxLead <= 1 && steadyLag < legacy / 4,
    `稳态滞后 ${steadyLag.toFixed(1)}ms，预期 ≈ ${expected}ms（旧行为 ${legacy}ms）`)
}

// 断言4（兼容回退）：snapshotAt=0 且 ageMs=0 → 旧行为（老版本 JS 调用不受影响）
{
  const clock = makeClock()
  const t = 5000; const tSnap = 4850
  reanchor(clock, truePosition(0, tSnap), 0, 0, t)
  const lag = truePosition(0, t + 100) - clockPosition(clock, t + 100)
  check('无戳调用回退旧行为（滞后 = 快照年龄，兼容老调用方）',
    Math.abs(lag - (t - tSnap)) < 1,
    `滞后 ${lag.toFixed(1)}ms ≈ 快照年龄 ${t - tSnap}ms`)
}

// 断言5（钳制）：异常未来戳被钳到 now，时钟不超前
{
  const clock = makeClock()
  const t = 5000; const tSnap = 4850; const future = t + 400
  reanchor(clock, truePosition(0, tSnap), future, 0, t)
  const lead = clockPosition(clock, t) - truePosition(0, t)
  check('未来戳被钳制到 now（时钟永不超前真实位置）',
    lead <= 0.001,
    `钳制后超前 ${lead.toFixed(3)}ms`)
}

// 断言6（hold 冻结）：hold 时时钟停在锚点位置，重锚只更新停驻点
{
  const clock = makeClock()
  reanchor(clock, 42000, 0, 0, 5000)
  clock.hold = true
  const p1 = clockPosition(clock, 5100)
  const p2 = clockPosition(clock, 5900)
  check('hold 冻结：时钟停驻锚点位置不外推（暂停/缓冲语义保持）',
    p1 === 42000 && p2 === 42000,
    `t+100ms=${p1}ms，t+900ms=${p2}ms`)
}

// 断言7（换行元数据链路，带反例）：带戳 payload 稳态滞后 0，无戳 payload 滞后 = 快照年龄
{
  const withStamp = simulateMetadataReanchor({ withStamp: true })
  const noStamp = simulateMetadataReanchor({ withStamp: false })
  check('换行元数据带戳 → 稳态滞后 0（换行链路修复生效）',
    Math.abs(withStamp.steadyLag) <= 1,
    `带戳滞后 ${withStamp.steadyLag.toFixed(3)}ms`)
  check('换行元数据无戳（反例）→ 稳态滞后 = 快照年龄（证明戳必要）',
    Math.abs(noStamp.steadyLag - 150) < 5,
    `无戳滞后 ${noStamp.steadyLag.toFixed(1)}ms ≈ 150ms`)
}

// 断言8（进度条后跳缺陷复现/反例）：熄屏后原生 tick 行变化重发旧缓存 →
// 基线被拉回后台前位置，回拨随时间持续增大（用户报「进度条后跳、时间倒退」）
{
  const { maxBackward } = simulateBackgroundProgress({ mode: 'legacy' })
  check('熄屏旧行为：tick 重发旧缓存 → 回拨 ≥ 5s 且持续增大（缺陷存在）',
    maxBackward > 5000,
    `最大回拨 ${(maxBackward / 1000).toFixed(1)}s`)
}

// 断言9（修复验证，断言8的反例）：tick 重发前刷新基线为时钟外推值 → 零回拨
{
  const { maxBackward } = simulateBackgroundProgress({ mode: 'fixed' })
  check('熄屏修复后：基线随 tick 滚动推进 → 回拨 ≤ 1ms（与断言8互为反例）',
    maxBackward <= 1,
    `最大回拨 ${maxBackward.toFixed(3)}ms`)
}

// 断言10（成对更新防回归）：缓存值推进而戳不推进（错配）→ 歌词时钟超前快照年龄。
// 守护本批进度条修复不得破坏上一批歌词修复：LXRefreshNowPlayingLyricAnchor 读
// 同一缓存对重锚，值/戳必须成对更新
{
  const t0 = 5000; const tSnap = t0 - 150
  const clock = makeClock()
  const advanced = truePosition(0, t0) // 值已推进到「现在」
  reanchor(clock, advanced, tSnap, 0, t0) // 但戳错配仍为快照时刻
  const lead = clockPosition(clock, t0 + 1000) - truePosition(0, t0 + 1000)
  check('值推进而戳不推进（错配反例）→ 歌词时钟超前快照年龄（证明缓存对必须成对更新）',
    Math.abs(lead - 150) < 5,
    `超前 ${lead.toFixed(1)}ms ≈ 快照年龄 150ms`)
}

// ---------------------------------------------------------------------------
// seek 后控制中心进度基线（nativeFlac 路径无 info 发布的缺口）
// ---------------------------------------------------------------------------

// nativeFlac 路径 TrackPlayer 已 reset、无原生 seek 事件：seek 后若不发布 info，
// 控制中心进度条基线停留在 seek 前的位置继续外推 → 与真实位置偏差 = seek 幅度
// （进度条完全不跟 seek）。修复 = seek 落点确认 + 引擎 playing 后发布基线
// （syncNowPlayingState('play')，对齐上游「playing → 重锚 + 广播」范式）。
const simulateSeekBaseline = ({ publishAfterSeek, seekAtMs = 10000, seekTargetSec = 120, rtt = 150, fastResyncMs = 300, observeMs = 5000 }) => {
  let baselineSec = 0; let baselineAtMs = 0
  let published = false
  let maxError = 0
  for (let t = 0; t <= seekAtMs + observeMs; t += 12) {
    if (t >= seekAtMs && publishAfterSeek && !published && t >= seekAtMs + fastResyncMs) {
      // 快路径发布：elapsed 快照产生于发布前 rtt（桥往返），原生推进到现在 →
      // 基线 ≈ 落点 + (fastResyncMs − rtt) 的播放量
      baselineSec = seekTargetSec + Math.max(0, fastResyncMs - rtt) / 1000
      baselineAtMs = t
      published = true
    }
    const truePos = t < seekAtMs ? t / 1000 : seekTargetSec + (t - seekAtMs) / 1000
    const shown = baselineSec + (t - baselineAtMs) / 1000
    // 口径：只统计「基线已定」的误差——发布前窗口（≤300ms）显示旧位置是任何
    // 方案都有的固有发布延迟，不是基线失联（断言11 不发布 = published 恒 false，
    // 全程都在统计，口径一致）
    if (published || !publishAfterSeek) maxError = Math.max(maxError, Math.abs(shown - truePos))
  }
  return { maxError }
}

// 断言11（缺口复现/反例）：nativeFlac seek 后不发布 info → 基线失联
{
  const { maxError } = simulateSeekBaseline({ publishAfterSeek: false })
  check('nativeFlac seek 后不发布基线（旧行为）→ 控制中心进度条偏差 = seek 幅度（缺陷存在）',
    maxError > 100,
    `最大偏差 ${maxError.toFixed(1)}s（seek 幅度 110s）`)
}

// 断言12（修复验证，断言11的反例）：落点确认 + playing 发布基线 → 偏差 ≤ 快照年龄
{
  const { maxError } = simulateSeekBaseline({ publishAfterSeek: true })
  check('nativeFlac seek 后快路径发布基线（修复）→ 偏差 ≤ 快照年龄（与断言11互为反例）',
    maxError <= 0.3,
    `最大偏差 ${(maxError * 1000).toFixed(0)}ms（≈ 快照年龄 150ms）`)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
