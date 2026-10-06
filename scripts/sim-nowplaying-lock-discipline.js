/**
 * sim-nowplaying-lock-discipline.js
 *
 * 「卡片缓存（LXNowPlayingInfoCache）的跨线程访问必须持 LXLyricLock」契约
 * （2026-10-06 全仓评审 P1；同批还有 RT 缓冲销毁时序 P2）。
 *
 * 背景：歌词时钟以 8.3Hz（0.12s）跑在专用后台串行队列（com.lxmusic.nowplaying.lyric），
 * 持锁读写 LXNowPlayingInfoCache；主线程的播放态发布 / RNTP 生命周期事件 / 收敛看门狗
 * 打点 / 封面写入 / 音频中断与回前台观察者如果绕过锁直接读写同一份 NSMutableDictionary，
 * 就是未定义行为（并发读写 → 偶发崩溃），且症状随机、无法从真机日志归因。
 *
 * 检查方式（第一层为通用扫描，不是逐点正则，防止未来新增调用点漏网）：
 *   ① 扫描全文件：任何 LXNowPlayingInfoCache / LXNowPlayingMutableInfo() 访问都必须在
 *      @synchronized (LXLyricLock()) 区域内（文件级 static 初始化行除外，按行首 static 跳过）；
 *   ② 自持锁辅助函数必须真的自持锁：LXCurrentNowPlayingRate / LXRefreshNowPlayingLyricAnchor /
 *      LXResolveNowPlayingPublishStateLocked / LXNowPlayingMutableInfo / LXSetNowPlayingArtwork；
 *   ③ 收敛看门狗打点：info 数量与速率必须持锁读（不得再出现 (unsigned long)LXNowPlayingInfoCache.count）；
 *   ④ RNTP 生命周期事件：速率写入持锁 + 早退的 info 判定持锁（旧无锁形态不得回归）；
 *   ⑤ setState 打点计数与标题判定持锁；existingTitle 早退恰好 1 处（死代码不得回归）；
 *   ⑥ RT 销毁时序：[AVAudioEngine stop] 不保证已进入的渲染回调已退出 —— renderBlock 必须走
 *      带 _renderInFlight 计数的包装，cleanupAudioGraphLocked 必须等计数归零再 _pcmBuffer.reset()；
 *   ⑦ 无调用方的 restartDecoderLoopForSeek 死代码不得回归（内部 dispatch_sync 自身队列 = 死锁陷阱）。
 *
 * 运行：node scripts/sim-nowplaying-lock-discipline.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const native = fs.readFileSync(path.join(ROOT, 'ios/LxMusicMobile/AppDelegate.mm'), 'utf8').replace(/\r\n/g, '\n')

const windowBetween = (src, startAnchor, endAnchor, fallback = 4000) => {
  const start = src.indexOf(startAnchor)
  if (start < 0) return ''
  const end = src.indexOf(endAnchor, start + startAnchor.length)
  return end < 0 ? src.slice(start, start + fallback) : src.slice(start, end)
}

// ---------------------------------------------------------------------------
// 通用扫描：跳过字符串/字符/注释后按大括号追踪「是否处于 @synchronized (LXLyricLock()) 内」
// ---------------------------------------------------------------------------
const scanUnlocked = (src, needle) => {
  const n = src.length
  let lockDepth = 0
  const openStack = []
  const posLocked = new Uint8Array(n)
  let inLineComment = false
  let inBlockComment = false
  let inString = false
  let inChar = false
  for (let i = 0; i < n; i++) {
    const ch = src[i]
    const next = src[i + 1]
    if (inLineComment) { if (ch === '\n') inLineComment = false; posLocked[i] = lockDepth > 0 ? 1 : 0; continue }
    if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i++ } posLocked[i] = lockDepth > 0 ? 1 : 0; continue }
    if (inString) { if (ch === '\\') { i++ } else if (ch === '"') inString = false; posLocked[i] = lockDepth > 0 ? 1 : 0; continue }
    if (inChar) { if (ch === '\\') { i++ } else if (ch === "'") inChar = false; posLocked[i] = lockDepth > 0 ? 1 : 0; continue }
    if (ch === '/' && next === '/') { inLineComment = true; i++; posLocked[i] = lockDepth > 0 ? 1 : 0; continue }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; posLocked[i] = lockDepth > 0 ? 1 : 0; continue }
    if (ch === '"') { inString = true; posLocked[i] = lockDepth > 0 ? 1 : 0; continue }
    if (ch === "'") { inChar = true; posLocked[i] = lockDepth > 0 ? 1 : 0; continue }
    posLocked[i] = lockDepth > 0 ? 1 : 0
    if (ch === '{') {
      const pre = src.slice(Math.max(0, i - 90), i)
      const isLock = /@synchronized \(LXLyricLock\(\)\)\s*$/.test(pre)
      openStack.push(isLock)
      if (isLock) lockDepth++
    } else if (ch === '}') {
      if (openStack.length) { const wasLock = openStack.pop(); if (wasLock) lockDepth-- }
    }
  }
  const unlocked = []
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  let m
  while ((m = re.exec(src))) {
    if (posLocked[m.index] === 1) continue
    const lineStart = src.lastIndexOf('\n', m.index) + 1
    const line = src.slice(lineStart, src.indexOf('\n', m.index)).trim()
    if (line.startsWith('static ')) continue // 文件级声明/初始化（如 static NSMutableDictionary *LXNowPlayingInfoCache = nil;）
    unlocked.push({ line: src.slice(0, m.index).split('\n').length, text: line.slice(0, 120) })
  }
  return unlocked
}

const structuralReasons = (src) => {
  const reasons = []

  // ① 通用扫描：缓存与取用助手的每一次访问都必须在锁内
  for (const needle of ['LXNowPlayingInfoCache', 'LXNowPlayingMutableInfo()']) {
    for (const hit of scanUnlocked(src, needle)) {
      reasons.push(`${needle} 在 L${hit.line} 无锁访问：${hit.text}`)
    }
  }

  // ② 自持锁辅助函数
  const rateFn = windowBetween(src, 'static NSNumber *LXCurrentNowPlayingRate(void) {', 'static NSNumber *LXNowPlayingDefaultPlaybackRateValue', 1200)
  if (!rateFn || !/@synchronized \(LXLyricLock\(\)\) \{/.test(rateFn)) {
    reasons.push('LXCurrentNowPlayingRate 没有自持锁（调用点分散，逐个加锁必漏）')
  }
  const anchorFn = windowBetween(src, 'static void LXRefreshNowPlayingLyricAnchor(void) {', 'static double LXNowPlayingCurrentElapsedSec', 1600)
  if (!anchorFn || !/@synchronized \(LXLyricLock\(\)\) \{[\s\S]{0,400}?LXNowPlayingInfoCache\[MPNowPlayingInfoPropertyElapsedPlaybackTime\]/.test(anchorFn)) {
    reasons.push('LXRefreshNowPlayingLyricAnchor 没有持锁读位置/快照戳')
  }
  const artworkSetter = windowBetween(src, 'static void LXSetNowPlayingArtwork(NSString *artworkPath) {', 'static NSNumber *LXDefaultNowPlayingRate', 2600)
  if (!artworkSetter || !/@synchronized \(LXLyricLock\(\)\) \{[\s\S]{0,300}?NSMutableDictionary \*info = LXNowPlayingMutableInfo\(\);/.test(artworkSetter)) {
    reasons.push('LXSetNowPlayingArtwork 的前置判定/清封面没有持锁（判定在锁外会立即过期）')
  }
  const artworkApply = windowBetween(src, 'static void LXApplyNowPlayingArtwork(UIImage *image', 'static void LXSetNowPlayingArtwork', 3200)
  if (!artworkApply || !/@synchronized \(LXLyricLock\(\)\) \{[\s\S]{0,260}?info\[MPMediaItemPropertyArtwork\] = artwork;/.test(artworkApply)) {
    reasons.push('封面写入（LXApplyNowPlayingArtwork）没有持锁写缓存')
  }

  // ③ 收敛看门狗打点持锁
  const converge = windowBetween(src, 'static void LXReconcileNowPlayingCardNow(void) {', 'static void LXApplyNowPlayingInfo(void) {', 6000)
  if (!converge) {
    reasons.push('找不到 LXReconcileNowPlayingCardNow')
  } else {
    if (/\(unsigned long\)LXNowPlayingInfoCache\.count/.test(converge)) {
      reasons.push('收敛打点又直接无锁读 LXNowPlayingInfoCache.count')
    }
    const lockedLogReads = (converge.match(/@synchronized \(LXLyricLock\(\)\) \{ lxLogInfoCount = LXNowPlayingInfoCache\.count; \}/g) || []).length
    if (lockedLogReads < 2) {
      reasons.push(`收敛打点应有 2 处持锁读（jsSilent / 心跳），实际 ${lockedLogReads} 处`)
    }
  }

  // ④ RNTP 生命周期事件
  const lifecycle = windowBetween(src,
    'static void LXHandleTrackPlayerLifecycleNotification(NSNotification *notification) {',
    'static void LXHandleNowPlayingInterruptionBegan', 6000)
  if (!lifecycle) {
    reasons.push('找不到 LXHandleTrackPlayerLifecycleNotification')
  } else {
    if (!/if \(rate != nil\) \{\s*\n\s*@synchronized \(LXLyricLock\(\)\) \{[\s\S]{0,220}?LXNowPlayingInfoCache\[MPNowPlayingInfoPropertyPlaybackRate\] = rate;/.test(lifecycle)) {
      reasons.push('生命周期事件的速率写入没有持 LXLyricLock（与歌词时钟线程并发写同一字典）')
    }
    if (/if \(rate != nil && LXNowPlayingInfoCache\.count > 0\)/.test(lifecycle)) {
      reasons.push('生命周期速率写入退回无锁形态')
    }
    if (!/@synchronized \(LXLyricLock\(\)\) \{ lxHasInfoForLifecycle = LXNowPlayingInfoCache\.count > 0; \}/.test(lifecycle)) {
      reasons.push('生命周期早退的 info 数量没有持锁读')
    }
  }

  // ⑤ 播放态发布：log 计数 / 标题判定持锁；死行不得回归
  const stateSetter = windowBetween(src,
    'static void LXSetNowPlayingPlaybackState(MPNowPlayingPlaybackState state, NSDictionary *options) {',
    'static void LXClearNowPlayingInfo(void) {', 6000)
  if (!stateSetter) {
    reasons.push('找不到 LXSetNowPlayingPlaybackState')
  } else {
    if (!/@synchronized \(LXLyricLock\(\)\) \{ lxStateInfoCount = LXNowPlayingInfoCache\.count; \}/.test(stateSetter)) {
      reasons.push('setState 打点没有持锁读 info 数量')
    }
    if (!/NSString \*existingTitle = nil;\s*\n\s*@synchronized \(LXLyricLock\(\)\) \{/.test(stateSetter)) {
      reasons.push('标题存在性判定没有持锁读（与歌词时钟线程并发）')
    }
    const earlyReturns = (stateSetter.match(/if \(existingTitle\.length == 0\) return;/g) || []).length
    if (earlyReturns !== 1) {
      reasons.push(`existingTitle 早退应恰好 1 处（函数开头），实际 ${earlyReturns} 处（永不可达的死代码不得回归）`)
    }
  }

  // ⑥ 中断置暂停 / 回前台观察者
  const interruption = windowBetween(src,
    'static void LXHandleNowPlayingInterruptionBegan(void) {',
    'static void LXRegisterTrackPlayerLifecycleObserver', 900)
  if (!interruption || !/@synchronized \(LXLyricLock\(\)\) \{ lxHasInfo = LXNowPlayingInfoCache\.count > 0; \}/.test(interruption)) {
    reasons.push('音频中断置暂停的 info 数量没有持锁读')
  }
  const foreground = windowBetween(src,
    'addObserverForName:UIApplicationDidBecomeActiveNotification',
    'if (LXNowPlayingScreenObserver == nil)', 2600)
  if (!foreground || !/@synchronized \(LXLyricLock\(\)\) \{ lxHasInfo = LXNowPlayingInfoCache\.count > 0; \}/.test(foreground)) {
    reasons.push('回前台观察者的 info 数量没有持锁读')
  }

  // ⑦ RT 销毁时序
  if (!/std::atomic<int> _renderInFlight;/.test(src)) {
    reasons.push('缺少 _renderInFlight 在途计数（RT 回调与缓冲销毁之间没有同步手段）')
  }
  if (!/_renderInFlight\.fetch_add\(1, std::memory_order_acq_rel\);[\s\S]{0,260}?_renderInFlight\.fetch_sub\(1, std::memory_order_acq_rel\);/.test(src)) {
    reasons.push('RT 回调没有维护在途计数（销毁侧无法证明回调已退出）')
  }
  if (!/renderSourceFramesGuarded:outputData/.test(src)) {
    reasons.push('renderBlock 没有走带在途计数的包装（直接调用 = 销毁时可能 use-after-free）')
  }
  if (!/_renderInFlight\.load\(std::memory_order_acquire\) > 0[\s\S]{0,600}?_pcmBuffer\.reset\(\);/.test(src)) {
    reasons.push('销毁 _pcmBuffer 前没有等待在途回调退出（RT 线程 use-after-free）')
  }

  // ⑧ 死代码不得回归
  if (/restartDecoderLoopForSeek/.test(src)) {
    reasons.push('restartDecoderLoopForSeek 死代码又回来了（无调用方，且内部 dispatch_sync 自身队列 = 死锁陷阱）')
  }

  return reasons
}

const tamperCases = [
  ['生命周期速率写入退回无锁（并发写同一字典）', (s) => s.replace(
    '    if (rate != nil) {\n      @synchronized (LXLyricLock()) {\n        if (LXNowPlayingInfoCache.count > 0) {\n          LXNowPlayingInfoCache[MPNowPlayingInfoPropertyPlaybackRate] = rate;\n        }\n      }\n    }',
    '    if (rate != nil && LXNowPlayingInfoCache.count > 0) {\n      LXNowPlayingInfoCache[MPNowPlayingInfoPropertyPlaybackRate] = rate;\n    }',
  ), '无锁访问'],
  ['拿掉 LXCurrentNowPlayingRate 的自持锁', (s) => s.replace(
    '  @synchronized (LXLyricLock()) {\n    NSNumber *rate = [LXNowPlayingInfoCache[MPNowPlayingInfoPropertyPlaybackRate]',
    '  {\n    NSNumber *rate = [LXNowPlayingInfoCache[MPNowPlayingInfoPropertyPlaybackRate]',
  ), '自持锁'],
  ['封面写入退回无锁（直接改字典）', (s) => s.replace(
    '    // 持锁写：歌词时钟线程同时读写同一份缓存（NSMutableDictionary 非线程安全）\n    @synchronized (LXLyricLock()) {\n      NSMutableDictionary *info = LXNowPlayingMutableInfo();\n      info[MPMediaItemPropertyArtwork] = artwork;\n    }',
    '    NSMutableDictionary *info = LXNowPlayingMutableInfo();\n    info[MPMediaItemPropertyArtwork] = artwork;',
  ), '无锁访问'],
  ['收敛打点退回无锁读 count', (s) => s.replace(
    '      unsigned long lxLogInfoCount = 0;\n      @synchronized (LXLyricLock()) { lxLogInfoCount = LXNowPlayingInfoCache.count; }\n      NSLog(@"###LXNowPlaying### converge engine=1 internal=%ld rate=%.2f info=%lu silentMs=%.0f",\n            (long)LXNowPlayingState, LXCurrentNowPlayingRate().doubleValue,\n            lxLogInfoCount, LXNowPlayingLastPublishAtMs > 0 ? sincePublishMs : -1.0);',
    '      NSLog(@"###LXNowPlaying### converge engine=1 internal=%ld rate=%.2f info=%lu silentMs=%.0f",\n            (long)LXNowPlayingState, LXCurrentNowPlayingRate().doubleValue,\n            (unsigned long)LXNowPlayingInfoCache.count, LXNowPlayingLastPublishAtMs > 0 ? sincePublishMs : -1.0);',
  ), '收敛打点'],
  ['渲染回调换回直连（绕过在途计数）', (s) => s.replace(
    'renderSourceFramesGuarded:outputData',
    'renderSourceFramesToBufferList:outputData',
  ), '在途计数'],
  ['销毁缓冲前不再等待在途回调', (s) => s.replace(
    /\s{2}NSInteger lxRenderSpin = 0;[\s\S]*?\s{2}_pcmBuffer\.reset\(\);/,
    '  _pcmBuffer.reset();',
  ), '等待在途回调'],
  ['重新引入死代码 restartDecoderLoopForSeek', (s) => s.replace(
    '- (void)finishStreamDownloadIfNeeded {',
    '- (void)restartDecoderLoopForSeek {\n  self.stopRequested = NO;\n}\n\n- (void)finishStreamDownloadIfNeeded {',
  ), '死代码'],
]

const realReasons = structuralReasons(native)
console.log('结构不变量（含全文件锁范围扫描）')
if (realReasons.length === 0) {
  console.log('PASS  缓存访问持锁 + 自持锁助手 + RT 销毁时序 + 死代码清除（8 组）')
} else {
  for (const r of realReasons) console.log('FAIL  ' + r)
}

let tamperFailed = 0
console.log('')
console.log('反例自检')
for (const [name, mutate, expect] of tamperCases) {
  let detail
  let hit = false
  try {
    const mutated = mutate(native)
    if (mutated === native) {
      detail = '找不到可篡改的锚点'
    } else {
      const reasons = structuralReasons(mutated)
      hit = reasons.some((r) => r.includes(expect))
      detail = hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）`
    }
  } catch (err) {
    detail = `异常: ${err.message}`
  }
  if (!hit) tamperFailed += 1
  console.log(`${hit ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
}

if (realReasons.length || tamperFailed) {
  console.error('\nFAIL  卡片缓存锁纪律 / RT 销毁时序契约未通过')
  process.exit(1)
}
console.log(`\nPASS  卡片缓存持锁访问 + RT 回调在途计数 + 死代码清除（结构不变量 8 组 + 反例 ${tamperCases.length} 例）`)
process.exit(0)
