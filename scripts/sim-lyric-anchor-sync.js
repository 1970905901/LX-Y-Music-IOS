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
// 本脚本 1:1 复刻锚点更新公式与外推公式，逐条验证 7 个断言（均带反例）。

'use strict';

// ---------------------------------------------------------------------------
// 模型基元
// ---------------------------------------------------------------------------

const RATE = 1;

// 校准链路时序参数（毫秒，典型 RN 桥量级）：up1/down1 = getPosition 去程/回程，
// rtt2 = getPlaybackEngineState 往返，up2 = reanchor 去程 + 主队列排队
const up1 = 75, down1 = 75, rtt2 = 120, up2 = 60;

// 真实播放位置：音频在时刻 t 的真值（线性，速率恒定）
const truePosition = (t0Ms, tMs) => (t0Ms + (tMs - 0) * RATE);

// 歌词时钟状态（复刻 AppDelegate.mm 静态量）
const makeClock = () => ({ anchorElapsedMs: 0, anchorSystemMs: 0, hold: false });

// 复刻 LXReanchorNowPlayingLyric(elapsedMs, snapshotAtMs, ageMs)（修复后）
// - snapshotAtMs > 0：锚点系统时间 = min(snapshotAt, now)（快照时刻精确回放）
// - 否则 ageMs > 0：锚点系统时间 = now − min(ageMs, 1000)（年龄补偿）
// - 都无：锚点系统时间 = now（旧行为——快照位置钉在现在）
const reanchor = (clock, elapsedMs, snapshotAtMs, ageMs, nowMs) => {
  clock.anchorElapsedMs = elapsedMs;
  let anchorSystemMs = nowMs;
  if (snapshotAtMs > 0) {
    anchorSystemMs = Math.min(snapshotAtMs, nowMs);
  } else if (ageMs > 0) {
    anchorSystemMs = nowMs - Math.min(ageMs, 1000);
  }
  clock.anchorSystemMs = anchorSystemMs;
};

// 复刻 tick 的位置计算（hold 冻结语义同原生）
const clockPosition = (clock, nowMs) => (clock.hold
  ? clock.anchorElapsedMs
  : clock.anchorElapsedMs + (nowMs - clock.anchorSystemMs) * RATE);

// 复刻 LXResolveElapsedSnapshotAtMs（元数据发布链路的戳解析）
const resolveSnapshotAt = (payload, nowMs) => {
  if (payload.elapsedTimeSnapshotAt > 0) return Math.min(payload.elapsedTimeSnapshotAt, nowMs);
  if (payload.elapsedTimeAgeMs > 0) return nowMs - Math.min(payload.elapsedTimeAgeMs, 1000);
  return 0;
};

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
  const clock = makeClock();
  clock.anchorElapsedMs = 0;
  clock.anchorSystemMs = 0;
  let maxLead = 0;
  const samples = [];
  for (let t = 0; t <= durationMs; t += 12) {
    if (t > 0 && t % periodMs === 0) {
      const tReq = t - up1 - down1 - rtt2 - up2; // 使 t_apply 落在整点上
      const tSnap = tReq + up1;
      const snapPos = truePosition(0, tSnap);
      if (mode === 'stamped') {
        reanchor(clock, snapPos, tSnap, 0, t);
      } else if (mode === 'age') {
        // JS 侧补偿量：总流逝(up1+down1+rtt2) − stamped.ageMs(up1) = down1 + rtt2
        reanchor(clock, snapPos, 0, down1 + rtt2, t);
      } else {
        reanchor(clock, snapPos, 0, 0, t);
      }
    }
    const lag = truePosition(0, t) - clockPosition(clock, t);
    maxLead = Math.max(maxLead, -lag);
    samples.push(lag);
  }
  // 稳态 = 最后 1/3 样本的中位数（排除启动瞬态）
  const tail = samples.slice(samples.length - Math.floor(samples.length / 3)).sort((a, b) => a - b);
  const steadyLag = tail[Math.floor(tail.length / 2)];
  return { steadyLag, maxLead };
};

// 模拟「换行元数据发布重锚」：JS 在 t_snap 取快照（桥往返 rtt 后发起发布），
// 原生 t_apply 处理 metadata（elapsed + 戳解析），LXRefreshNowPlayingLyricAnchor
// 用 (缓存 elapsed, 缓存戳) 重锚。每 lineEveryMs 一次。带反例（无戳 payload）。
const simulateMetadataReanchor = ({ rtt = 150, lineEveryMs = 5000, durationMs = 30000, withStamp }) => {
  const clock = makeClock();
  let cachedStampAt = 0; // LXNowPlayingElapsedSnapshotAtMs
  const samples = [];
  for (let t = 0; t <= durationMs; t += 12) {
    if (t > 0 && t % lineEveryMs === 0) {
      const tSnap = t - rtt; // 快照产生 → JS 收到 → 发起发布 → 原生 t_apply 处理
      const snapPos = truePosition(0, tSnap);
      // 复刻 LXSetNowPlayingInfo 的 elapsedTime 分支：缓存位置 + 解析戳
      const payload = withStamp
        ? { elapsedTimeSnapshotAt: tSnap }
        : {};
      cachedStampAt = resolveSnapshotAt(payload, t);
      // 复刻 LXRefreshNowPlayingLyricAnchor：从缓存 (elapsed, stamp) 重锚
      reanchor(clock, snapPos, cachedStampAt, 0, t);
    }
    samples.push(truePosition(0, t) - clockPosition(clock, t));
  }
  const tail = samples.slice(samples.length - Math.floor(samples.length / 3)).sort((a, b) => a - b);
  return { steadyLag: tail[Math.floor(tail.length / 2)] };
};

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

console.log('sim-lyric-anchor-sync：灵动岛/控制中心歌词锚点滞后模型\n');

// 断言1（缺陷复现/反例）：旧行为——快照位置被钉在现在，稳态滞后 = 完整快照年龄
// （快照产生于去程结束：t_snap = t_req + up1，年龄 = t_apply − t_snap = 255ms）
{
  const { steadyLag } = simulateCalibration({ mode: 'legacy' });
  const expected = down1 + rtt2 + up2;
  check('旧行为稳态滞后 = 完整快照年龄（缺陷存在）',
    Math.abs(steadyLag - expected) < 5,
    `稳态滞后 ${steadyLag.toFixed(1)}ms，预期 ≈ ${expected}ms`);
}

// 断言2（修复验证，断言1的反例）：原生戳回放 → 滞后归零
{
  const { steadyLag, maxLead } = simulateCalibration({ mode: 'stamped' });
  check('原生戳回放稳态滞后 ≤ 1ms（修复生效，与断言1互为反例）',
    Math.abs(steadyLag) <= 1 && maxLead <= 1,
    `稳态滞后 ${steadyLag.toFixed(3)}ms，最大超前 ${maxLead.toFixed(3)}ms`);
}

// 断言3：AVPlayer 年龄估计 → 残余 = reanchor 去程 up2（对称往返下不可再消），
// 远小于旧行为的完整快照年龄
{
  const { steadyLag, maxLead } = simulateCalibration({ mode: 'age' });
  const expected = up2;
  const legacy = down1 + rtt2 + up2;
  check('年龄估计残余 = reanchor 去程（60ms），远小于旧行为（255ms）',
    Math.abs(steadyLag - expected) < 5 && maxLead <= 1 && steadyLag < legacy / 4,
    `稳态滞后 ${steadyLag.toFixed(1)}ms，预期 ≈ ${expected}ms（旧行为 ${legacy}ms）`);
}

// 断言4（兼容回退）：snapshotAt=0 且 ageMs=0 → 旧行为（老版本 JS 调用不受影响）
{
  const clock = makeClock();
  const t = 5000, tSnap = 4850;
  reanchor(clock, truePosition(0, tSnap), 0, 0, t);
  const lag = truePosition(0, t + 100) - clockPosition(clock, t + 100);
  check('无戳调用回退旧行为（滞后 = 快照年龄，兼容老调用方）',
    Math.abs(lag - (t - tSnap)) < 1,
    `滞后 ${lag.toFixed(1)}ms ≈ 快照年龄 ${t - tSnap}ms`);
}

// 断言5（钳制）：异常未来戳被钳到 now，时钟不超前
{
  const clock = makeClock();
  const t = 5000, tSnap = 4850, future = t + 400;
  reanchor(clock, truePosition(0, tSnap), future, 0, t);
  const lead = clockPosition(clock, t) - truePosition(0, t);
  check('未来戳被钳制到 now（时钟永不超前真实位置）',
    lead <= 0.001,
    `钳制后超前 ${lead.toFixed(3)}ms`);
}

// 断言6（hold 冻结）：hold 时时钟停在锚点位置，重锚只更新停驻点
{
  const clock = makeClock();
  reanchor(clock, 42000, 0, 0, 5000);
  clock.hold = true;
  const p1 = clockPosition(clock, 5100);
  const p2 = clockPosition(clock, 5900);
  check('hold 冻结：时钟停驻锚点位置不外推（暂停/缓冲语义保持）',
    p1 === 42000 && p2 === 42000,
    `t+100ms=${p1}ms，t+900ms=${p2}ms`);
}

// 断言7（换行元数据链路，带反例）：带戳 payload 稳态滞后 0，无戳 payload 滞后 = 快照年龄
{
  const withStamp = simulateMetadataReanchor({ withStamp: true });
  const noStamp = simulateMetadataReanchor({ withStamp: false });
  check('换行元数据带戳 → 稳态滞后 0（换行链路修复生效）',
    Math.abs(withStamp.steadyLag) <= 1,
    `带戳滞后 ${withStamp.steadyLag.toFixed(3)}ms`);
  check('换行元数据无戳（反例）→ 稳态滞后 = 快照年龄（证明戳必要）',
    Math.abs(noStamp.steadyLag - 150) < 5,
    `无戳滞后 ${noStamp.steadyLag.toFixed(1)}ms ≈ 150ms`);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
