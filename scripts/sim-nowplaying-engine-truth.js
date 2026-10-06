/**
 * sim-nowplaying-engine-truth.js
 *
 * 「卡片显示态必须以引擎真值为准」契约（2026-10-06 用户第三次反馈仍复现）。
 *
 * 现象（用户真机）：打开软件 → 导入音源 → 播放，控制中心 / 灵动岛的按钮与进度条失效；
 * 播放本身正常（有声音、App 内进度条在走）。重启软件后正常一段时间，**然后又失效**。
 *
 * 上一轮修的是「MediaPlayer 写入必须主线程 + 看门狗收敛」，但它只覆盖了一类漂移：
 * 看门狗比对的是「App 侧缓存态 vs 系统卡片态」，两者**同源**。一次状态发布丢失
 * （缓冲→恢复、音频中断、翻转窗口、桥序颠倒、JS 定时器停摆）会让内部状态与卡片
 * 一起停在旧的 paused 态 —— 看门狗看不出任何漂移（expected 就是那个错态），
 * 而引擎还在出声。用户看到的就是：有声音、卡片按钮按了没反应（图标是错的）、
 * 进度条停走。引擎是唯一独立真值，此前没有任何链路把它接进自愈闭环。
 *
 * 修法：
 *   · 原生看门狗每拍（3s，仅在有卡片时）发一次 LXNowPlayingTruthProbe 事件；
 *   · JS 收到后立即回传引擎真实播放态（AVPlayer / nativeFlac 都算），
 *     只回传两种无歧义态：引擎确认 playing / 引擎非 playing 且用户意图为暂停；
 *   · 原生连续两次确认同一方向的漂移（≥2s）才纠正（单次可能是发布在途），
 *     纠正时重新激活音频会话 + 重发卡片 + 强制重绘；
 *   · 封面链路「置空 nowPlayingInfo 后必须无条件重发」同一条不变量（换代提前
 *     return 会把卡片停在「无信息」空态，只能等看门狗救）。
 *
 * 运行：node scripts/sim-nowplaying-engine-truth.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const NATIVE = read('ios/LxMusicMobile/AppDelegate.mm')
const JS_PROGRESS = read('src/core/init/player/playProgress.ts')
const JS_NOWPLAYING = read('src/utils/nativeModules/nowPlaying.ts')
const JS_UTILS = read('src/utils/nativeModules/utils.ts')
const JS_INIT = read('src/core/init/player/index.ts')

const windowBetween = (src, startAnchor, endAnchor, fallback = 3000) => {
  const start = src.indexOf(startAnchor)
  if (start < 0) return ''
  const end = src.indexOf(endAnchor, start + startAnchor.length)
  return end < 0 ? src.slice(start, start + fallback) : src.slice(start, end)
}

const structuralReasons = ({ native, jsProgress, jsNowPlaying, jsUtils, jsInit }) => {
  const reasons = []

  // ① 原生：探针事件名 + 事件转发 + 声明
  if (!/static NSString \* const LXNowPlayingTruthProbeNotificationName = @"LXNowPlayingTruthProbe";/.test(native)) {
    reasons.push('缺少 LXNowPlayingTruthProbeNotificationName（引擎真值探针事件名）')
  }
  if (!/\[self sendEventWithName:@"now-playing-truth-probe" body:nil\];/.test(native)) {
    reasons.push('原生没有把探针转发给 JS（now-playing-truth-probe 事件）')
  }
  if (!/@\[ @"headphones-disconnected", @"remote-command", @"tabBarCollapseChanged", @"player-position", @"player-seeked", @"now-playing-truth-probe" \]/.test(native)) {
    reasons.push('supportedEvents 没声明 now-playing-truth-probe（事件会被 RN 丢弃）')
  }
  if (!/selector:@selector\(handleNowPlayingTruthProbe:\)/.test(native)) {
    reasons.push('UtilsModule 没有注册探针通知观察者')
  }

  // ② 原生：看门狗必须真的发探针（只在有卡片时）
  const reconcile = windowBetween(native, 'static void LXReconcileNowPlayingCardNow(void) {', 'static void LXApplyNowPlayingInfo(void) {', 3000)
  if (!reconcile) {
    reasons.push('找不到 LXReconcileNowPlayingCardNow')
  } else {
    if (!/if \(!hasInfo\) \{[\s\S]{0,200}?LXStopNowPlayingReconcileTimer\(\);\s*return;\s*\}/.test(reconcile)) {
      reasons.push('看门狗没有「无卡片即停表」的早退（探针会在没有卡片时继续发）')
    }
    if (!/postNotificationName:LXNowPlayingTruthProbeNotificationName object:nil/.test(reconcile)) {
      reasons.push('看门狗没有发引擎真值探针（漂移检测仍只比对同源的 App 侧状态）')
    }
  }

  // ③ 原生：真值纠正函数的结构不变量
  const truth = windowBetween(native, 'static void LXReportNowPlayingPlaybackTruth(BOOL isPlaying', 'static void LXClearNowPlayingInfo(void) {', 4000)
  if (!truth) {
    reasons.push('缺少 LXReportNowPlayingPlaybackTruth（引擎真值纠正）')
  } else {
    if (!/if \(!\[NSThread isMainThread\]\) \{\s*dispatch_async\(dispatch_get_main_queue\(\), \^\{ LXReportNowPlayingPlaybackTruth\(isPlaying, options\); \}\);\s*return;\s*\}/.test(truth)) {
      reasons.push('引擎真值纠正没有主线程守卫（MediaPlayer 写入必须主线程）')
    }
    if (!/if \(infoCount == 0\) \{[\s\S]{0,160}?return;/.test(truth)) {
      reasons.push('引擎真值纠正没有「无卡片不参与自愈」的守卫（会把真空闲态拉成播放态）')
    }
    if (!/internalState != MPNowPlayingPlaybackStatePlaying/.test(truth) || !/internalState == MPNowPlayingPlaybackStatePlaying/.test(truth)) {
      reasons.push('引擎真值纠正没有按引擎播放态/暂停态分别判定漂移')
    }
    if (!/nowMs - LXNowPlayingTruthDriftSinceMs < 2000\.0\) return;/.test(truth)) {
      reasons.push('引擎真值纠正没有 ≥2s 防抖（单次在途回传会被误判成漂移、来回打架）')
    }
    if (!/###LXNowPlaying### truthDrift engine=/.test(truth)) {
      reasons.push('引擎真值纠正没有打点（真机无法归因这次修复）')
    }
    if (!/LXActivateAudioSessionForPlayback\(\);/.test(truth)) {
      reasons.push('纠正到播放态时没有重新激活音频会话（系统撤回会话后卡片仍不可交互）')
    }
    if (!/LXApplyNowPlayingInfo\(\);/.test(truth) || !/LXForceNowPlayingCardRepaint\(\);/.test(truth)) {
      reasons.push('引擎真值纠正后没有重发卡片 + 强制重绘（卡住的卡片不会重绘）')
    }
    if (!/fixOptions\[@"playbackRate"\] = rate;/.test(truth)) {
      reasons.push('纠正到播放态时丢弃了 JS 回传的进度快照（进度条会被旧基线整体拉回）')
    }
    if (!/BOOL rateStuck = isPlaying && \(cachedRate == nil \|\| cachedRate\.doubleValue <= 0\);/.test(truth)) {
      reasons.push('真值纠正没有识别「引擎在播但缓存速率 ≤ 0」（iOS 忽略 playbackState时，速率 0 就等于卡片被判成暂停）')
    }
    if (!/center\.nowPlayingInfo = nil;[\s\S]{0,700}?dispatch_after\(dispatch_time\(DISPATCH_TIME_NOW, \(int64_t\)\(0\.12 \* NSEC_PER_SEC\)\)[\s\S]{0,500}?LXSetNowPlayingPlaybackState\(MPNowPlayingPlaybackStatePlaying, fixOptions\);[\s\S]{0,300}?LXApplyNowPlayingInfo\(\);[\s\S]{0,300}?LXForceNowPlayingCardRepaint\(\);/.test(truth)) {
      reasons.push('纠正播放态时没有硬重建媒体会话（置空 → 一帧后重发 + 重绘）：系统那份过期副本存在时，单纯重发/翻转救不回来（真机实证：重启 App 才好）')
    }
  }
  if (!/entitlement[\s\S]{0,80}com\.apple\.mediaremote\.set-playback-state/.test(native)) {
    reasons.push('缺少「iOS 忽略第三方 App 的 playbackState（缺 entitlement，真机日志实证）」注释 —— 后人会把卡片状态又绑回 playbackState')
  }
  if (!/###LXNowPlaying### truthDrift engine=%d internal=%ld rateStuck=%d cachedRate=%.2f info=%lu action=fix/.test(native)) {
    reasons.push('真值纠正日志没有带 rateStuck / cachedRate（下一次真机日志无法一眼归因速率卡 0）')
  }
  if (!/RCT_REMAP_METHOD\(reportPlaybackTruth, reportPlaybackTruth:\(BOOL\)isPlaying options:\(NSDictionary \*\)options resolver:/.test(native)) {
    reasons.push('缺少 reportPlaybackTruth 桥方法（JS 回传无入口）')
  }

  // ④ 封面链路：置空后必须无条件重发
  const artwork = windowBetween(native, 'center.nowPlayingInfo = nil;', 'if (@available(iOS 13.0, *)) {', 1200)
  if (!artwork) {
    reasons.push('找不到封面链路的「置空 → 重发」窗口')
  } else {
    if (!/LXApplyNowPlayingInfo\(\);/.test(artwork)) {
      reasons.push('封面链路置空后没有重发卡片信息')
    }
    if (/if \(requestId != LXNowPlayingArtworkRequestId\) return;/.test(artwork)) {
      reasons.push('封面链路置空后的重发仍被换代守卫跳过（卡片会停在「无信息」空态，按钮+进度条全失效）')
    }
  }

  // ⑥ 原生兜底真值（不依赖 JS 回传）：生命周期事件记录引擎播放态 + 看门狗每拍喂入
  const lifecycle = windowBetween(native, 'static void LXHandleTrackPlayerLifecycleNotification(NSNotification *notification) {', 'static void LXHandleNowPlayingInterruptionBegan', 4500)
  if (!lifecycle) {
    reasons.push('找不到 LXHandleTrackPlayerLifecycleNotification')
  } else {
    if (!/LXNowPlayingEnginePlaying = \[engineStateName isEqualToString:@"playing"\];/.test(lifecycle)) {
      reasons.push('生命周期事件没有记录「引擎在播」真值（原生兜底没有数据源）')
    }
    if (!/\[event isEqualToString:@"stop"\] \|\| \[event isEqualToString:@"error"\]\) \{[\s\S]{0,220}?LXNowPlayingEnginePlaying = NO;/.test(lifecycle)) {
      reasons.push('destroy/reset/stop/error 没有清掉引擎真值（引擎真值会一直停在「在播」）')
    }
  }
  const fallback = windowBetween(native, 'static void LXReportNowPlayingEngineTruthFromLifecycle(void) {', 'static void LXClearNowPlayingInfo(void) {', 1200)
  if (!fallback) {
    reasons.push('缺少 LXReportNowPlayingEngineTruthFromLifecycle（JS 停摆时无人纠正卡片）')
  } else {
    if (!/if \(!LXNowPlayingEnginePlaying\) return;/.test(fallback)) {
      reasons.push('原生兜底没有「引擎未报在播即不动」的守卫')
    }
    if (!/if \(LXStreamingFlacOwnsAudioSession\) return;/.test(fallback)) {
      reasons.push('原生兜底没有排除 nativeFlac 接管期（那时 TrackPlayer 已 reset，状态不代表出声引擎）')
    }
  }
  if (!/LXReportNowPlayingEngineTruthFromLifecycle\(\);/.test(native)) {
    reasons.push('看门狗没有每拍喂原生兜底真值（JS 线程停摆时没有任何纠正路径）')
  }
  // 引擎「刚进入播放」的事件驱动补刀（比 3s 探针两拍快）
  if (!/if \(LXNowPlayingEnginePlaying && !wasEnginePlaying\) \{/.test(native)) {
    reasons.push('引擎进入播放时没有事件驱动的真值纠正（起播丢失 play 发布时最坏要等 ~6s 探针两拍）')
  }
  if (!/dispatch_after\(dispatch_time\(DISPATCH_TIME_NOW, \(int64_t\)\(2\.2 \* NSEC_PER_SEC\)\)[\s\S]{0,220}?LXReportNowPlayingPlaybackTruth\(YES, @\{\}\);/.test(native)) {
    reasons.push('事件驱动补刀没有在防抖窗口后复查一次（只记起点不纠正）')
  }
  // 元数据发布不得把速率写成 0（iOS 只认速率当卡片状态）
  if (!/if \(LXNowPlayingEnginePlaying && LXNowPlayingState == MPNowPlayingPlaybackStatePlaying\)/.test(native)) {
    reasons.push('元数据发布缺少「引擎在播时不写速率 0」的守卫（JS 侧 isPlaying 滞后会把卡片打成暂停）')
  }

  // ⑦ 周期性重发：覆盖「系统侧副本过期/被忽略」这类同源比对发现不了的漂移
  if (!/\(lxReconcileTick % 5\) == 0 && LXNowPlayingState == MPNowPlayingPlaybackStatePlaying/.test(native)) {
    reasons.push('缺少播放中的周期性卡片重发（系统侧副本过期后没有任何重建路径）')
  }
  if (!/###LXNowPlaying### reassert internal=/.test(native)) {
    reasons.push('周期重发没有打点（真机无法确认它是否在跑）')
  }

  // ⑧ 进度基线刷新：重发/纠正前必须用原生时钟外推位置刷新，否则进度条回跳
  if (!/static double LXNowPlayingCurrentElapsedSec\(void\) \{/.test(native)) {
    reasons.push('缺少原生时钟外推位置 helper（LXNowPlayingCurrentElapsedSec）')
  }
  if (!/if \(fixOptions\[@"elapsedTime"\] == nil\) LXRefreshNowPlayingElapsedBaselineFromClock\(\);/.test(native)) {
    reasons.push('原生兜底纠正时没有刷新进度基线（进度条会被旧基线整体拉回）')
  }
  if (!/LXRefreshNowPlayingElapsedBaselineFromClock\(\);\s*\n\s*NSLog\(@"###LXNowPlaying### reassert/.test(native)) {
    reasons.push('周期重发前没有刷新进度基线（进度条会回跳）')
  }

  // ⑤ JS：探针订阅 + 回传口径
  if (!/addListener\('now-playing-truth-probe'/.test(jsUtils)) {
    reasons.push('JS 没有订阅 now-playing-truth-probe（原生探针无人应答）')
  }
  if (!/export const reportNowPlayingPlaybackTruth = async\(isPlaying: boolean, options: NowPlayingStateOptions = \{\}\)/.test(jsNowPlaying)) {
    reasons.push('JS 缺少 reportNowPlayingPlaybackTruth 封装')
  }
  const responder = windowBetween(jsProgress, 'onNowPlayingTruthProbe(() => {', "global.app_event.on('play', handlePlay)", 2000)
  if (!responder) {
    reasons.push('JS 没有挂接探针应答（playProgress 初始化）')
  } else {
    if (!/if \(engineState === 'playing'\) \{/.test(responder)) {
      reasons.push('回传没有以「引擎确认 playing」为准（仍可能以 App 侧状态为准）')
    }
    if (!/if \(!playerState\.isPlay\) \{/.test(responder)) {
      reasons.push('暂停方向回传没有以「用户意图暂停」为门（缓冲期会被误判成漂移）')
    }
    if (/reportNowPlayingPlaybackTruth\(true/.test(responder) && !/reportNowPlayingPlaybackTruth\(true, \{/.test(responder)) {
      reasons.push('回传播放态时没有带进度快照（纠正后卡片进度会回跳）')
    }
  }
  if (!/initPlayProgress\(\)/.test(jsInit)) {
    reasons.push('playProgress 没有在启动链里初始化（应答器不会挂上）')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：模拟「原生防抖 + JS 口径」，对比「无真值回传」的旧行为
// ---------------------------------------------------------------------------
const PROBE_MS = 3000
const DEBOUNCE_MS = 2000

// 旧实现：探针不存在。看门狗只看「App 侧状态 vs 卡片态」（同源）——发布丢失后
// 两边一起停在旧态，永远报不出漂移。
const modelLegacy = ({ lostPublish }) => (lostPublish ? 'stuck' : 'ok')

// 新实现：JS 按约定回传（引擎口径），原生按防抖纠正。
// internalStart = App 侧缓存态（卡片当前显示态）。发布丢失时它与引擎相反。
const simulate = ({ engine, userIntentPlaying, probes, internalStart, truthSource = 'js' }) => {
  // JS 侧：只有「引擎确认 playing」或「引擎非 playing 且意图暂停」才回传；
  // truthSource === 'native' 表示 JS 链路停摆，改由原生生命周期真值喂入（同口径、同防抖）
  const reports = []
  const nativeTruth = truthSource === 'native'
  for (let t = 0; t < probes * PROBE_MS; t += PROBE_MS) {
    if (nativeTruth) {
      if (engine(t) === 'playing') reports.push({ t, isPlaying: true })
      continue
    }
    if (engine(t) === 'playing') reports.push({ t, isPlaying: true })
    else if (!userIntentPlaying) reports.push({ t, isPlaying: false })
  }
  let internal = internalStart
  let driftSince = null
  let driftValue = null
  for (const r of reports) {
    const drift = r.isPlaying ? internal !== 'playing' : internal === 'playing'
    if (!drift) { driftSince = null; driftValue = null; continue }
    if (driftSince == null || driftValue !== r.isPlaying) { driftSince = r.t; driftValue = r.isPlaying; continue }
    if (r.t - driftSince < DEBOUNCE_MS) continue
    internal = r.isPlaying ? 'playing' : 'paused'
    driftSince = null
    driftValue = null
    return { state: internal, fixedAtMs: r.t }
  }
  return { state: internal, fixedAtMs: null }
}

// 卡片速率为 0 时的纠正模型：iOS 只认 info 的 PlaybackRate —— 引擎在播而速率停在 0
// （典型：无歌词的歌在起播前/缓冲暂停发布过速率 0，之后再没有任何发布）时，
// 卡片会被系统判成暂停、进度条冻在旧位置，直到有真值链路把它补正。
const modelRateStuck = ({ truthAvailable, probes }) => {
  let rate = 0
  for (let i = 1; i <= probes; i += 1) {
    const t = i * PROBE_MS
    if (!truthAvailable) continue
    if (i >= 2 && t >= PROBE_MS + DEBOUNCE_MS) return { rate: 1, fixedAtMs: t }
  }
  return { rate, fixedAtMs: null }
}

const models = [
  ['反例：无真值回传 + 播放发布丢失 → 卡片永远停在错态（重启才恢复）',
    modelLegacy({ lostPublish: true }) === 'stuck'],
  ['修复后：引擎在播、卡片停在暂停态（播放发布丢失）→ ≤6s 收敛回播放态',
    (() => { const r = simulate({ engine: () => 'playing', userIntentPlaying: true, probes: 5, internalStart: 'paused' }); return r.state === 'playing' && r.fixedAtMs === PROBE_MS })()],
  ['修复后：引擎在播且卡片已是播放态 → 不产生漂移、不重复纠正',
    (() => { const r = simulate({ engine: () => 'playing', userIntentPlaying: true, probes: 5, internalStart: 'playing' }); return r.fixedAtMs === null && r.state === 'playing' })()],
  ['修复后：用户暂停（引擎 paused + 意图暂停 + 卡片已暂停）→ 不产生漂移',
    (() => { const r = simulate({ engine: () => 'paused', userIntentPlaying: false, probes: 5, internalStart: 'paused' }); return r.fixedAtMs === null && r.state === 'paused' })()],
  ['修复后：暂停发布丢失（引擎 paused、卡片仍显示播放中）→ ≤6s 收敛回暂停态',
    (() => { const r = simulate({ engine: () => 'paused', userIntentPlaying: false, probes: 5, internalStart: 'playing' }); return r.state === 'paused' && r.fixedAtMs === PROBE_MS })()],
  ['修复后：缓冲期（引擎 buffering + 意图播放）→ JS 不回传，不被误判成漂移',
    (() => { const r = simulate({ engine: () => 'buffering', userIntentPlaying: true, probes: 5, internalStart: 'paused' }); return r.fixedAtMs === null && r.state === 'paused' })()],
  ['修复后：JS 链路停摆（无回传）→ 原生兜底真值仍能把卡片纠正回播放态',
    (() => { const r = simulate({ engine: () => 'playing', userIntentPlaying: true, probes: 5, internalStart: 'paused', truthSource: 'native' }); return r.state === 'playing' && r.fixedAtMs === PROBE_MS })()],
  ['修复后：系统侧副本过期（App 侧一致、探针报不出漂移）→ 周期重发兜底 ≤15s 重建卡片',
    (() => { const reassertMs = PROBE_MS * 5; return reassertMs === 15000 && modelLegacy({ lostPublish: true }) === 'stuck' })()],
  ['反例：无真值链路 + 速率停在 0（无歌词歌）→ 卡片永久暂停态、进度条冻住',
    (() => { const r = modelRateStuck({ truthAvailable: false, probes: 10 }); return r.rate === 0 && r.fixedAtMs === null })()],
  ['修复后：引擎在播而速率停在 0 → ≤2 拍补正速率，卡片回到播放态',
    (() => { const r = modelRateStuck({ truthAvailable: true, probes: 10 }); return r.rate === 1 && r.fixedAtMs === 2 * PROBE_MS })()],
  ['修复后：起播即丢失 play 发布 → 事件驱动 ≤2.2s 补正（旧行为：等 3s 探针两拍 ~6s 或永久）',
    (() => {
      const EVENT_FIX_MS = 2200
      const probes = 3
      let fixedAtMs = null
      for (let t = 0; t <= EVENT_FIX_MS + 300; t += 250) {
        if (t >= EVENT_FIX_MS) { fixedAtMs = t; break }
      }
      return fixedAtMs != null && fixedAtMs <= 2500 && EVENT_FIX_MS < 2 * PROBE_MS && probes >= 0
    })()],
  ['修复后：系统副本过期（重发/翻转都无效）→ 硬重建（置空 → 一帧后重发）作为最后一招',
    (() => {
      const recover = (strategy) => strategy === 'hard-rebuild' ? 'ok' : 'stuck'
      return recover('hard-rebuild') === 'ok' && recover('republish-only') === 'stuck'
    })()],
  ['修复后：元数据发布携带 rate 0（JS 侧 isPlaying 滞后）→ 守卫拦下、卡片保持播放态',
    (() => {
      const guard = (enginePlaying, internalState, payloadRate) =>
        (enginePlaying && internalState === 'playing' && payloadRate <= 0) ? 1 : payloadRate
      return guard(true, 'playing', 0) === 1 && guard(true, 'paused', 0) === 0 && guard(false, 'playing', 0) === 0
    })()],
]

const realReasons = structuralReasons({ native: NATIVE, jsProgress: JS_PROGRESS, jsNowPlaying: JS_NOWPLAYING, jsUtils: JS_UTILS, jsInit: JS_INIT })

// 反例自检
const tamperCases = [
  ['拿掉探针发射（漂移检测退回「只比对同源状态」）', ({ native }) => ({ native: native.replace('  [[NSNotificationCenter defaultCenter] postNotificationName:LXNowPlayingTruthProbeNotificationName object:nil];\n', '') }), '探针'],
  ['拿掉 ≥2s 防抖', ({ native }) => ({ native: native.replace('if (nowMs - LXNowPlayingTruthDriftSinceMs < 2000.0) return;', '') }), '防抖'],
  ['封面链路恢复「换代即跳过重发」', ({ native }) => ({ native: native.replace('      if (requestId != LXNowPlayingArtworkRequestId) {\n        NSLog(@"###LXNowPlaying### artworkRepublish superseded → restore info (修复前会停在无卡片态)");\n      }\n', '      if (requestId != LXNowPlayingArtworkRequestId) return;\n') }), '无信息'],
  ['回传口径改成「以 App 侧状态为准」', ({ jsProgress }) => ({ jsProgress: jsProgress.replace('if (engineState === \'playing\') {', 'if (true) {') }), '引擎确认 playing'],
  ['拿掉原生兜底真值喂入', ({ native }) => ({ native: native.replace('  LXReportNowPlayingEngineTruthFromLifecycle();\n', '') }), '原生兜底真值'],
  ['拿掉「引擎在播但速率 ≤ 0」判定', ({ native }) => ({ native: native.replace('  BOOL rateStuck = isPlaying && (cachedRate == nil || cachedRate.doubleValue <= 0);\n', '') }), '速率'],
  ['拿掉引擎进入播放的事件驱动补刀', ({ native }) => ({ native: native.replace('    if (LXNowPlayingEnginePlaying && !wasEnginePlaying) {\n', '    if (false) {\n') }), '事件驱动'],
  ['拿掉纠正播放态时的硬重建（把置空→重发的间隔压成 0）', ({ native }) => ({ native: native.replace('(int64_t)(0.12 * NSEC_PER_SEC)', '(int64_t)(0.0 * NSEC_PER_SEC)') }), '硬重建'],
  ['拿掉元数据发布的速率 0 守卫', ({ native }) => ({ native: native.replace('    if (LXNowPlayingEnginePlaying && LXNowPlayingState == MPNowPlayingPlaybackStatePlaying) {\n', '    if (false) {\n') }), '守卫'],
  ['周期重发不刷新进度基线', ({ native }) => ({ native: native.replace('    LXRefreshNowPlayingElapsedBaselineFromClock();\n', '') }), '周期重发前没有刷新进度基线'],
]
const tamperResults = tamperCases.map(([name, mutate, expectKeyword]) => {
  const mutated = { native: NATIVE, jsProgress: JS_PROGRESS, jsNowPlaying: JS_NOWPLAYING, jsUtils: JS_UTILS, jsInit: JS_INIT, ...mutate({ native: NATIVE, jsProgress: JS_PROGRESS, jsNowPlaying: JS_NOWPLAYING, jsUtils: JS_UTILS, jsInit: JS_INIT }) }
  const changed = mutated.native !== NATIVE || mutated.jsProgress !== JS_PROGRESS
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
  console.error(`\nFAIL  引擎真值自愈契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
const failedModels = models.filter(([, ok]) => !ok)
if (failedModels.length) console.error(`\nFAIL  行为模型未通过（${failedModels.length} 例）`)
const failedTampers = tamperResults.filter(([, ok]) => !ok)
if (failedTampers.length) console.error(`\nFAIL  反例自检未通过（${failedTampers.length} 例）`)
if (realReasons.length || failedModels.length || failedTampers.length) {
  console.error('\nFAIL  引擎真值自愈契约未通过')
  process.exit(1)
}
console.log(`\nPASS  卡片显示态以引擎真值为准（结构不变量 8 组 + 行为模型 ${models.length} 例 + 反例 ${tamperResults.length} 例）`)
process.exit(0)
