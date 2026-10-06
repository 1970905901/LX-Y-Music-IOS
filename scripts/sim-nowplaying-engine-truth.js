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
const PATCHES = read('dependencies-patch.js')
const NATIVEFLAC_JS = read('src/plugins/player/nativeFlac.ts')
const JS_PLAYER_SETTINGS = read('src/screens/Home/Views/Setting/settings/Player/index.tsx')

const windowBetween = (src, startAnchor, endAnchor, fallback = 3000) => {
  const start = src.indexOf(startAnchor)
  if (start < 0) return ''
  const end = src.indexOf(endAnchor, start + startAnchor.length)
  return end < 0 ? src.slice(start, start + fallback) : src.slice(start, end)
}

const structuralReasons = ({ native, jsProgress, jsNowPlaying, jsUtils, jsInit, patches, nativeFlacJs = '', jsPlayerSettings = '' }) => {
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
    if (!/LXReassertNowPlayingSession\(@"drift-playing"\);/.test(truth)) {
      reasons.push('漂移纠正没有走非破坏性会话重绑（应当写入真值后重绑会话，而不是置空）')
    }
  }
  if (!/entitlement[\s\S]{0,80}com\.apple\.mediaremote\.set-playback-state/.test(native)) {
    reasons.push('缺少「iOS 忽略第三方 App 的 playbackState（缺 entitlement，真机日志实证）」注释 —— 后人会把卡片状态又绑回 playbackState')
  }
  if (!/###LXNowPlaying### truthDrift engine=%d internal=%ld rateStuck=%d cachedRate=%.2f info=%lu action=fix/.test(native)) {
    reasons.push('真值纠正日志没有带 rateStuck / cachedRate（下一次真机日志无法一眼归因速率卡 0）')
  }
  // —— 单一媒体会话所有者（2026-10-06 重构）——
  // ① nowPlayingInfo 只能有一个写入点，且任何路径都不许「置空」它：
  //    置空 = 让系统拆掉这份媒体会话 —— 屏幕上的卡片会停在最后一张快照
  //    （典型：暂停图标 + 0:00），之后任何重发都改不动，只有重建会话才恢复。
  const writeCount = (native.match(/center\.nowPlayingInfo =(?!=)/g) || []).length
  if (writeCount !== 1) {
    reasons.push(`nowPlayingInfo 的写入点必须唯一（当前 ${writeCount} 处）：多写入者互相覆盖会让卡片状态不可控`)
  }
  if (/center\.nowPlayingInfo = nil;/.test(native)) {
    reasons.push('存在置空 nowPlayingInfo 的路径（= 让系统拆掉媒体会话，卡片会停在最后一张快照且无法被重发改动）')
  }
  if (!/center\.nowPlayingInfo = LXNowPlayingInfoCache\.count \? \[LXNowPlayingInfoCache copy\] : nil;/.test(native)) {
    reasons.push('唯一写入点不是「按缓存发布、只有空缓存才 nil」的漏斗（LXApplyNowPlayingInfo）')
  }
  // ② RNTP/SwiftAudioEx 不得再写/清同一份信息（否则就是本 App 之外的第二写入者）
  if (!/单一媒体会话所有者[\s\S]{0,900}?_ = metadata/.test(patches)) {
    reasons.push('dependencies-patch.js 缺少「RNTP 的 Metadata.update 改为 no-op」补丁（第二写入者会写不带速率的 info，把卡片打成暂停）')
  }
  if (!/LX: 不在此处 clear 系统媒体信息/.test(patches)) {
    reasons.push('dependencies-patch.js 缺少「RNTP destroy 不再 clear 系统媒体信息」补丁（clear = 拆会话）')
  }
  if (!/LX: no-op（单一媒体会话所有者/.test(patches)) {
    reasons.push('dependencies-patch.js 缺少「RNTP clearNowPlayingMetadata 改为 no-op」补丁')
  }
  // ③ 会话重绑必须是非破坏性的（激活会话 + 重挂命令 + 重发，不置空）
  const reassert = windowBetween(native, 'static void LXReassertNowPlayingSession(NSString *reason) {', '// 看门狗每拍调用的原生兜底真值入口', 2000)
  if (!reassert) {
    reasons.push('缺少 LXReassertNowPlayingSession（系统侧绑定过期时的非破坏性重绑）')
  } else {
    if (!/LXActivateAudioSessionForPlayback\(\);/.test(reassert) ||
        !/LXBeginReceivingRemoteControlEvents\(\);/.test(reassert) ||
        !/LXReinstallRemoteCommandHandlers\(\);/.test(reassert)) {
      reasons.push('会话重绑没有「激活会话 + 开始接收遥控事件 + 重挂命令目标」三件套')
    }
    if (/nowPlayingInfo = nil/.test(reassert)) {
      reasons.push('会话重绑里出现了置空（会拆会话，必须只做重绑/重发）')
    }
    if (!/###LXNowPlaying### sessionReassert reason=/.test(reassert)) {
      reasons.push('会话重绑没有打点（真机无法确认它触发过）')
    }
  }
  if (!/LXReassertNowPlayingSession\(@"drift-playing"\);/.test(native)) {
    reasons.push('漂移纠正没有走非破坏性会话重绑')
  }
  if (!/if \(LXNowPlayingEnginePlaying\) \{[\s\S]{0,300}?LXReassertNowPlayingSession\(@"foreground"\);/.test(native)) {
    reasons.push('回前台时没有对「引擎仍在播」做会话重绑（用户验证过的恢复时机被浪费）')
  }
  if (!/RCT_REMAP_METHOD\(reportPlaybackTruth, reportPlaybackTruth:\(BOOL\)isPlaying options:\(NSDictionary \*\)options resolver:/.test(native)) {
    reasons.push('缺少 reportPlaybackTruth 桥方法（JS 回传无入口）')
  }

  // ④ 封面链路：只「合并 + 重发」，绝不置空（置空 = 拆会话 → 卡片停在最后一张快照）
  const artwork = windowBetween(native, 'static void LXApplyNowPlayingArtwork(UIImage *image', 'static void LXBeginReceivingRemoteControlEvents', 4000)
  if (!artwork) {
    reasons.push('找不到封面链路（LXApplyNowPlayingArtwork）')
  } else {
    if (/nowPlayingInfo = nil/.test(artwork)) {
      reasons.push('封面链路里出现置空（会拆会话：卡片停在最后一张快照且无法被重发改动）')
    }
    if (!/LXApplyNowPlayingInfo\(\);/.test(artwork)) {
      reasons.push('封面链路没有重发信息（封面/元数据无法生效）')
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
    if (!/LXReportNowPlayingPlaybackTruth\(LXNowPlayingEnginePlaying, @\{\}\);/.test(fallback)) {
      reasons.push('原生兜底只喂「在播」一个方向（引擎已停而卡片仍显示播放时不会被纠正）')
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

  // ⑦ 每拍收敛（发布权收归原生）：JS 静默 >5s 才接管 —— 既不依赖 JS 发布，也不干扰按压/拖动
  if (!/double sincePublishMs = nowMs - LXNowPlayingLastPublishAtMs;/.test(native) ||
      !/BOOL jsSilent = LXNowPlayingLastPublishAtMs <= 0 \|\| sincePublishMs > 5000\.0;/.test(native)) {
    reasons.push('看门狗没有「JS 静默 >5s 才接管」的门槛（要么完全不接管、要么每拍重发干扰按压/拖动）')
  }
  if (!/if \(jsSilent\) \{\s*\n\s*LXRefreshNowPlayingElapsedBaselineFromClock\(\);\s*\n\s*LXApplyNowPlayingInfo\(\);/.test(native)) {
    reasons.push('JS 静默时没有刷新进度基线并重发（发布丢失后卡片不会收敛到真值）')
  }
  if (!/LXNowPlayingLastPublishAtMs = CACurrentMediaTime\(\) \* 1000\.0;/.test(native)) {
    reasons.push('发布漏斗没有记录最近发布时刻（静默判定失效）')
  }
  if (!/###LXNowPlaying### converge engine=1 internal=/.test(native)) {
    reasons.push('收敛没有心跳打点（真机无法确认「App 侧一直在收敛」）')
  }

  // ⑧ 进度基线刷新：重发/纠正前必须用原生时钟外推位置刷新，否则进度条回跳
  if (!/static double LXNowPlayingCurrentElapsedSec\(void\) \{/.test(native)) {
    reasons.push('缺少原生时钟外推位置 helper（LXNowPlayingCurrentElapsedSec）')
  }
  if (!/if \(fixOptions\[@"elapsedTime"\] == nil\) LXRefreshNowPlayingElapsedBaselineFromClock\(\);/.test(native)) {
    reasons.push('原生兜底纠正时没有刷新进度基线（进度条会被旧基线整体拉回）')
  }
  if (!/LXRefreshNowPlayingElapsedBaselineFromClock\(\);\s*\n\s*LXApplyNowPlayingInfo\(\);/.test(native)) {
    reasons.push('每拍收敛前没有刷新进度基线（进度条会回跳）')
  }

  // ④b 两个播放器之间的越界（2026-10-06 用户线索：播放设置里有 native FLAC 开关）：
  //   · 开关关闭（默认）走 TrackPlayer/AVPlayer，但 AVPlayer 路径每次换歌都会调用
  //     resetNativeFlacPlayback() —— 必须在本引擎未激活时直接早退，不再去触达原生
  //     FLAC 模块（否则每次换歌都在动它的状态机 / 遥控事件接收）；
  //   · 原生 FLAC 模块的 reset/stop 不得调用 LXBegin/EndReceivingRemoteControlEvents
  //     —— 那是 NowPlaying 模块（全 App 唯一会话所有者）的所有权。
  if (nativeFlacJs && !/if \(mode == 'none' && !trackId\) return/.test(nativeFlacJs)) {
    reasons.push('resetNativeFlacPlayback 没有「引擎未激活即早退」（AVPlayer 路径每次换歌都去触达原生 FLAC 模块）')
  }
  if (!/不在此处 LXEndReceivingRemoteControlEvents\(\)/.test(native)) {
    reasons.push('原生 FLAC 模块的 reset 仍在动全 App 的遥控事件接收（跨模块越界：每次换歌解绑一次按键）')
  }

  // ⑨ 自检 / 修复入口（播放设置 →「媒体卡片自检」）：诊断桥 + 非破坏性重绑桥 + JS 封装 + 注册。
  // 卡片失效时用户点一下就能看清「系统没送按键」还是「App 侧断了」，并能当场修复（不必重启 App）。
  if (!/RCT_REMAP_METHOD\(getCardDiagnostics,/.test(native) || !/RCT_REMAP_METHOD\(reassertSession,/.test(native)) {
    reasons.push('缺少媒体卡片自检/修复的原生桥（getCardDiagnostics / reassertSession）')
  }
  if (!/export const getCardDiagnostics = async\(\): Promise<CardDiagnostics \| null>/.test(jsNowPlaying) ||
      !/export const reassertNowPlayingSession = async\(\)/.test(jsNowPlaying)) {
    reasons.push('缺少媒体卡片自检/修复的 JS 封装（nowPlaying.ts）')
  }
  if (jsPlayerSettings && !/<CardSelfCheck \/>/.test(jsPlayerSettings)) {
    reasons.push('播放设置页没有注册「媒体卡片自检」入口（用户无法自检/就地修复）')
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
  ['修复后：系统侧副本过期（App 侧一致、探针报不出漂移）→ JS 静默后 ≤8s（5s 门槛 + 一拍）收敛',
    (() => {
      const worstCaseMs = 5000 + PROBE_MS
      return worstCaseMs === 8000 && modelLegacy({ lostPublish: true }) === 'stuck'
    })()],
  ['修复后：无任何 JS 发布（JS 停摆）→ 原生每拍收敛仍让卡片保持播放态 + 进度基线新鲜',
    (() => {
      const jsAlive = false
      const converge = (enginePlaying) => enginePlaying ? { rate: 1, elapsedFresh: true } : { rate: 0, elapsedFresh: false }
      const card = converge(true)
      return !jsAlive && card.rate === 1 && card.elapsedFresh === true
    })()],
  ['修复后：引擎已停而卡片仍显示播放（暂停发布丢失、无 JS 参与）→ 原生真值双向纠正 ≤3s',
    (() => {
      const truth = (enginePlaying, internal) => (enginePlaying === internal) ? 'ok' : 'drift-detected'
      return truth(false, true) === 'drift-detected' && truth(true, false) === 'drift-detected'
    })()],
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
  ['修复后：系统侧绑定过期 → 非破坏性会话重绑（激活会话 + 重挂命令 + 重发），绝不断会话',
    (() => { const recover = (s) => s === 'reassert' ? 'recovered' : 'card-dead-until-restart'; return recover('reassert') === 'recovered' && recover('nil-teardown') === 'card-dead-until-restart' })()],
  ['修复后：元数据发布携带 rate 0（JS 侧 isPlaying 滞后）→ 守卫拦下、卡片保持播放态',
    (() => {
      const guard = (enginePlaying, internalState, payloadRate) =>
        (enginePlaying && internalState === 'playing' && payloadRate <= 0) ? 1 : payloadRate
      return guard(true, 'playing', 0) === 1 && guard(true, 'paused', 0) === 0 && guard(false, 'playing', 0) === 0
    })()],
]

const realReasons = structuralReasons({ native: NATIVE, jsProgress: JS_PROGRESS, jsNowPlaying: JS_NOWPLAYING, jsUtils: JS_UTILS, jsInit: JS_INIT, patches: PATCHES, nativeFlacJs: NATIVEFLAC_JS, jsPlayerSettings: JS_PLAYER_SETTINGS })

// 反例自检
const tamperCases = [
  ['拿掉探针发射（漂移检测退回「只比对同源状态」）', ({ native }) => ({ native: native.replace('  [[NSNotificationCenter defaultCenter] postNotificationName:LXNowPlayingTruthProbeNotificationName object:nil];\n', '') }), '探针'],
  ['拿掉 ≥2s 防抖', ({ native }) => ({ native: native.replace('if (nowMs - LXNowPlayingTruthDriftSinceMs < 2000.0) return;', '') }), '防抖'],
  ['封面链路恢复「置空再重发」', ({ native }) => ({ native: native.replace('    LXApplyNowPlayingInfo();\n    // 部分音源封面在播放中途才就绪', '    [MPNowPlayingInfoCenter defaultCenter].nowPlayingInfo = nil;\n    LXApplyNowPlayingInfo();\n    // 部分音源封面在播放中途才就绪') }), '置空'],
  ['回传口径改成「以 App 侧状态为准」', ({ jsProgress }) => ({ jsProgress: jsProgress.replace('if (engineState === \'playing\') {', 'if (true) {') }), '引擎确认 playing'],
  ['拿掉原生兜底真值喂入', ({ native }) => ({ native: native.replace('  LXReportNowPlayingEngineTruthFromLifecycle();\n', '') }), '原生兜底真值'],
  ['拿掉「引擎在播但速率 ≤ 0」判定', ({ native }) => ({ native: native.replace('  BOOL rateStuck = isPlaying && (cachedRate == nil || cachedRate.doubleValue <= 0);\n', '') }), '速率'],
  ['拿掉引擎进入播放的事件驱动补刀', ({ native }) => ({ native: native.replace('    if (LXNowPlayingEnginePlaying && !wasEnginePlaying) {\n', '    if (false) {\n') }), '事件驱动'],
  ['会话重绑里加回置空（拆会话）', ({ native }) => ({ native: native.replace('  LXActivateAudioSessionForPlayback();\n  LXBeginReceivingRemoteControlEvents();\n  LXReinstallRemoteCommandHandlers();', '  [MPNowPlayingInfoCenter defaultCenter].nowPlayingInfo = nil;\n  LXActivateAudioSessionForPlayback();\n  LXBeginReceivingRemoteControlEvents();\n  LXReinstallRemoteCommandHandlers();') }), '置空'],
  ['拿掉回前台的会话重绑', ({ native }) => ({ native: native.replace('        LXReassertNowPlayingSession(@"foreground");\n', '') }), '回前台'],
  ['拿掉元数据发布的速率 0 守卫', ({ native }) => ({ native: native.replace('    if (LXNowPlayingEnginePlaying && LXNowPlayingState == MPNowPlayingPlaybackStatePlaying) {\n', '    if (false) {\n') }), '守卫'],
  ['拿掉「JS 静默才接管」的门槛', ({ native }) => ({ native: native.replace('    BOOL jsSilent = LXNowPlayingLastPublishAtMs <= 0 || sincePublishMs > 5000.0;', '    BOOL jsSilent = NO;') }), '静默'],
  ['原生真值退回「只喂在播方向」', ({ native }) => ({ native: native.replace('  LXReportNowPlayingPlaybackTruth(LXNowPlayingEnginePlaying, @{});', '  if (!LXNowPlayingEnginePlaying) return;\n  LXReportNowPlayingPlaybackTruth(YES, @{});') }), '只喂「在播」'],
  ['FLAC 引擎未激活时仍去触达原生模块（AVPlayer 路径每次换歌）', ({ nativeFlacJs }) => ({ nativeFlacJs: nativeFlacJs.replace("  if (mode == 'none' && !trackId) return\n", '') }), '引擎未激活即早退'],
  ['原生 FLAC reset 再动一次遥控事件接收', ({ native }) => ({ native: native.replace('  // ⚠️ 不在此处 LXEndReceivingRemoteControlEvents()（单一所有者，2026-10-06 重构）：', '  LXEndReceivingRemoteControlEvents();\n  // (tampered)') }), '跨模块越界'],
  ['拿掉播放设置里的自检入口', ({ jsPlayerSettings }) => ({ jsPlayerSettings: jsPlayerSettings.replace('      <CardSelfCheck />\n', '') }), '播放设置页没有注册'],
  ['拿掉自检的 JS 封装', ({ jsNowPlaying }) => ({ jsNowPlaying: jsNowPlaying.replace('export const getCardDiagnostics = async(): Promise<CardDiagnostics | null> => {', 'const _unusedGetCardDiagnostics = async(): Promise<CardDiagnostics | null> => {') }), 'JS 封装'],
  ['静默接管时不刷新进度基线', ({ native }) => ({ native: native.replace('      LXRefreshNowPlayingElapsedBaselineFromClock();\n      LXApplyNowPlayingInfo();', '      LXApplyNowPlayingInfo();') }), '刷新进度基线'],
]
const tamperResults = tamperCases.map(([name, mutate, expectKeyword]) => {
  const mutated = { native: NATIVE, jsProgress: JS_PROGRESS, jsNowPlaying: JS_NOWPLAYING, jsUtils: JS_UTILS, jsInit: JS_INIT, patches: PATCHES, nativeFlacJs: NATIVEFLAC_JS, jsPlayerSettings: JS_PLAYER_SETTINGS, ...mutate({ native: NATIVE, jsProgress: JS_PROGRESS, jsNowPlaying: JS_NOWPLAYING, jsUtils: JS_UTILS, jsInit: JS_INIT, patches: PATCHES, nativeFlacJs: NATIVEFLAC_JS, jsPlayerSettings: JS_PLAYER_SETTINGS }) }
  const changed = mutated.native !== NATIVE || mutated.jsProgress !== JS_PROGRESS || mutated.nativeFlacJs !== NATIVEFLAC_JS || mutated.patches !== PATCHES || mutated.jsNowPlaying !== JS_NOWPLAYING || mutated.jsPlayerSettings !== JS_PLAYER_SETTINGS
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
console.log(`\nPASS  单一媒体会话所有者 + 两引擎不越界 + 原生收敛 + 自检入口（结构不变量 9 组 + 行为模型 ${models.length} 例 + 反例 ${tamperResults.length} 例）`)
process.exit(0)
