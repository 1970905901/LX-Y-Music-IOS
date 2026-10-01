/**
 * sim-power-drain.js
 *
 * 「后台播放耗电」契约不变量。
 *
 * 背景：有用户反馈「只播放 1 小时就掉 10% 电」。逐层排查后，前台（屏幕亮着）的
 * 耗电主要来自几处 rAF 每帧循环（歌词连续滚动、逐字卡拉OK 插值、lrc 解析器
 * ticker）——这些在 iOS 后台会被系统暂停（rAF 由 CADisplayLink 驱动，无显示时
 * 停摆），不构成后台耗电。真正在**后台（锁屏 / 揣兜里）持续唤醒 CPU** 的是：
 *
 *   ① 原生 GCD 歌词时钟（AppDelegate.mm 的 LXNowPlayingLyricStep），周期 0.12s
 *      = 8.3Hz，**一经创建永不停止**：即使暂停 / 停止 / 清空歌词 / 切到无歌词的
 *      歌，它仍按 8.3Hz 起床做二分查找（虽多数分支早退，但 8.3Hz 的唤醒本身就是
 *      耗电，且锁屏时 CPU 本应深度睡眠）。
 *   ② JS BackgroundTimer 轮询（playProgress.ts 的 1s 慢校准 tick）：其原生实现
 *      （RNBackgroundTimer.m）每个 setTimeout/setInterval 都调
 *      `beginBackgroundTaskWithName:` 申请后台任务断言——这对系统是重操作，
 *      且让 App 保持「可运行」而不被挂起。后台 body 虽被 AppState 守卫早退，
 *      但定时器本身每秒仍在申请/释放断言。
 *   ③ 热路径 NSLog（LXNowPlayingLyricStep 每次换行、setNowPlayingLyrics 每次设行）
 *      ——NSLog 是同步写 Apple System Log，锁屏期间每次换行都唤醒 I/O。
 *
 * 本脚本把这些绑成不变量，并带反例自检（tsc/eslint 对「定时器未停」「日志未删」
 * 完全无感）。运行：node scripts/sim-power-drain.js
 * 退出码：不变量全过、且全部反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const APPDEL = 'ios/LxMusicMobile/AppDelegate.mm'
const PLAY_PROGRESS = 'src/core/init/player/playProgress.ts'

const REAL = {
  appdel: read(APPDEL),
  playProgress: read(PLAY_PROGRESS),
}

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

// ---------------------------------------------------------------------------
// 原生歌词时钟：必须「可停」，且热路径不得留 NSLog
// ---------------------------------------------------------------------------

/** 从源码抽出某个 C 函数【定义】体（按大括号配平）；跳过前置声明（`)` 后是 `;` 而非 `{`）。 */
const extractCFunction = (src, signature) => {
  let searchFrom = 0
  for (;;) {
    const start = src.indexOf(signature, searchFrom)
    if (start < 0) return null
    const parenEnd = src.indexOf(')', start + signature.length - 1)
    // signature 以 '(' 结尾时，parenEnd 是本函数的参数表右括号
    if (parenEnd < 0) return null
    let i = parenEnd + 1
    while (i < src.length && /\s/.test(src[i])) i++
    if (src[i] === '{') {
      // 命中定义：从 { 起配平
      let depth = 0
      for (let j = i; j < src.length; j++) {
        const ch = src[j]
        if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0) return src.slice(start, j + 1)
        }
      }
      return null
    }
    // 是声明（;）→ 继续往后找同名定义
    searchFrom = start + signature.length
  }
}

const nativeInvariants = (src) => {
  const _raw = src
  const code = stripComments(src)
  const reasons = []

  // 1) 必须有「停止歌词时钟」的实现：dispatch_source_cancel(timer) 且把静态变量置 nil
  if (!/static\s+void\s+LXStopNowPlayingLyricTimer\s*\(\s*void\s*\)/.test(code)) {
    reasons.push('缺少 LXStopNowPlayingLyricTimer()：时钟一旦创建永不停止 = 后台 8.3Hz 永久唤醒')
  } else {
    const body = extractCFunction(code, 'static void LXStopNowPlayingLyricTimer(void)')
    if (!body || !/dispatch_source_cancel\s*\(/.test(body)) {
      reasons.push('LXStopNowPlayingLyricTimer 未 dispatch_source_cancel 时钟（仅置 nil 会泄漏 dispatch source）')
    }
    if (!/LXNowPlayingLyricTimer\s*=\s*nil/.test(body)) {
      reasons.push('LXStopNowPlayingLyricTimer 未把 LXNowPlayingLyricTimer 置 nil（之后无法重启）')
    }
  }

  // 2) 时钟生命周期必须有「按播放态同步」的统一守卫，且被关键路径调用：
  //    - LXSyncNowPlayingLyricTimer 定义存在，且在非 Playing 时走停钟
  //    - 播放态切换（LXSetNowPlayingPlaybackState）、元数据发布（LXSetNowPlayingInfo）、
  //      清空会话（LXClearNowPlayingInfo）三处都必须调用它
  if (!/static\s+void\s+LXSyncNowPlayingLyricTimer\s*\(\s*void\s*\)/.test(code)) {
    reasons.push('缺少 LXSyncNowPlayingLyricTimer()：无法按播放态停/启 8.3Hz 时钟')
  } else {
    const syncBody = extractCFunction(code, 'static void LXSyncNowPlayingLyricTimer(void)')
    if (!syncBody || !/LXStopNowPlayingLyricTimer\s*\(\s*\)/.test(syncBody)) {
      reasons.push('LXSyncNowPlayingLyricTimer 未在非 Playing 时停钟')
    }
    if (!syncBody || !/LXStartNowPlayingLyricTimer\s*\(\s*\)/.test(syncBody)) {
      reasons.push('LXSyncNowPlayingLyricTimer 未在 Playing 时启钟')
    }
    // 三处关键路径调用点
    for (const [sig, label] of [
      ['static void LXSetNowPlayingPlaybackState(', '播放态切换'],
      ['static void LXSetNowPlayingInfo(', '元数据发布'],
      ['static void LXClearNowPlayingInfo(void)', '清空会话'],
    ]) {
      const body = extractCFunction(code, sig)
      if (!body) { reasons.push(`未找到 ${sig}`); continue }
      if (!/LXSyncNowPlayingLyricTimer\s*\(\s*\)/.test(body)) {
        reasons.push(`${label}（${sig}）未调用 LXSyncNowPlayingLyricTimer（该路径会漏掉停/启钟）`)
      }
    }
    // 歌词时间轴注入也必须走统一守卫（而非自行无条件启钟）
    const setLines = extractCFunction(code, 'static void LXSetNowPlayingLyricLines(')
    if (setLines && !/LXSyncNowPlayingLyricTimer\s*\(\s*\)/.test(setLines)) {
      reasons.push('LXSetNowPlayingLyricLines 未走统一守卫（自行启钟会在暂停态误开 8.3Hz）')
    }
  }

  // 3) 热路径不得留 NSLog：tick（每次换行）+ setNowPlayingLyrics（每次设行）
  const step = extractCFunction(code, 'static void LXNowPlayingLyricStep(void)')
  if (step && /NSLog\s*\(/.test(step)) {
    reasons.push('LXNowPlayingLyricStep 内含 NSLog（每次换行同步写系统日志，锁屏期唤醒 I/O）')
  }
  const setLinesN = extractCFunction(code, 'static void LXSetNowPlayingLyricLines(')
  if (setLinesN && /NSLog\s*\(/.test(setLinesN)) {
    reasons.push('LXSetNowPlayingLyricLines 内含 NSLog（每次设行同步写系统日志）')
  }

  // 4) 时钟周期不得被调高唤醒频率（>8Hz 视为回归）：契约值 0.12s
  if (!/0\.12\s*\*\s*NSEC_PER_SEC/.test(code)) {
    reasons.push('歌词时钟周期不再是 0.12s（契约值；改大则控制中心歌词换行延迟变化，需同步评估）')
  }

  return { ok: reasons.length === 0, reasons }
}

// ---------------------------------------------------------------------------
// JS 侧：后台不得让背景定时器空转申请后台任务断言
// ---------------------------------------------------------------------------

/** 从源码抽出一个「const/let/var name = ...」声明体（按大括号配平），供 arrow function 用。 */
const extractAssignment = (src, decl) => {
  const start = src.indexOf(decl)
  if (start < 0) return null
  const braceStart = src.indexOf('{', start)
  if (braceStart < 0) return null
  // 反向确认 `{` 之前没有 `;`（否则说明这个声明体不含块，是表达式）
  const head = src.slice(start, braceStart)
  if (head.includes(';')) return null
  let depth = 0
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

const jsInvariants = (src) => {
  const code = stripComments(src)
  const reasons = []

  // 1) 慢校准 1s tick 的 body 必须有 AppState 前台守卫（后台直接 return，
  //    不做桥往返 / React 发布；定时器本身每秒申请断言的成本靠原生侧停钟与
  //    守卫共同压制，这里先保证「后台不做重活」）
  const getCurrentTime = extractAssignment(code, 'const getCurrentTime =')
  if (!getCurrentTime) {
    reasons.push('未找到 getCurrentTime（慢校准 tick body）')
  } else if (!/AppState\.currentState\s*!==\s*'active'/.test(getCurrentTime)) {
    reasons.push('getCurrentTime 无 AppState 前台守卫（后台会做桥往返 + React 发布）')
  }

  // 2) 原生 4Hz 位置事件回调同样必须有前台守卫
  const onPos = code.indexOf('onPlayerPosition(')
  if (onPos < 0) {
    reasons.push('未找到 onPlayerPosition 订阅')
  } else if (!/AppState\.currentState\s*!==\s*'active'/.test(code.slice(onPos, onPos + 400))) {
    reasons.push('onPlayerPosition 回调无 AppState 前台守卫（后台仍会被 4Hz 事件唤醒做 React 发布）')
  }

  // 3) 1s 慢校准 tick 不得用 BackgroundTimer.setInterval：
  //    react-native-background-timer 原生每拍都 beginBackgroundTaskWithName:
  //    （申请后台任务断言 + 阻止挂起），而本 tick 后台被守卫早退、毫无意义 →
  //    纯属每秒一次的净耗电。必须用普通 setInterval（后台冻结，无断言）。
  const startUpdate = extractAssignment(code, 'const startUpdateTimeout =')
  if (!startUpdate) {
    reasons.push('未找到 startUpdateTimeout（慢校准 tick 启动点）')
  } else {
    if (/BackgroundTimer\.setInterval/.test(startUpdate)) {
      reasons.push('慢校准 tick 用了 BackgroundTimer.setInterval（每秒申请后台任务断言，后台净耗电）')
    }
    if (!/\bsetInterval\s*\(/.test(startUpdate)) {
      reasons.push('慢校准 tick 未使用普通 setInterval（后台需要它被系统冻结、零断言）')
    }
  }

  return { ok: reasons.length === 0, reasons }
}

// ---------------------------------------------------------------------------
// 反例（对篡改后的源码跑同一套判断，必须被拦下）
// ---------------------------------------------------------------------------

const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.replace(find, replace)
}

const runCounterExamples = () => {
  const results = []

  const check = (name, fn, expectReasonSubstr) => {
    let reasons = []
    try {
      reasons = fn()
    } catch (e) {
      results.push({ name, ok: false, detail: `抛异常: ${e.message}` })
      return
    }
    const hit = reasons.some(r => r.includes(expectReasonSubstr))
    results.push({ name, ok: hit, detail: hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）` })
  }

  // — 原生反例 —
  // ① 删掉停钟函数 → 应报「缺少 LXStopNowPlayingLyricTimer」
  check('原生① 无停钟函数', () => {
    const s = REAL.appdel.replace(/static\s+void\s+LXStopNowPlayingLyricTimer\s*\(\s*void\s*\)[^}]*\{[\s\S]*?\n\}/, '')
    return nativeInvariants(s).reasons
  }, '缺少 LXStopNowPlayingLyricTimer')

  // ② 停钟函数里不 cancel → 报「未 dispatch_source_cancel」
  check('原生② 停钟不 cancel', () => {
    const s = tamper(REAL.appdel, 'dispatch_source_cancel(LXNowPlayingLyricTimer);', '/*removed*/;')
    return nativeInvariants(s).reasons
  }, '未 dispatch_source_cancel')

  // ③ 停钟不再被统一守卫调用（守卫删掉停钟分支）→ 报「未在非 Playing 时停钟」
  check('原生③ 守卫不停钟', () => {
    const s = tamper(REAL.appdel,
      'if (LXNowPlayingState == MPNowPlayingPlaybackStatePlaying) {\n    LXStartNowPlayingLyricTimer();\n  } else {\n    LXStopNowPlayingLyricTimer();\n  }',
      'LXStartNowPlayingLyricTimer();')
    return nativeInvariants(s).reasons
  }, '未在非 Playing 时停钟')

  // ③b 播放态切换处漏掉统一守卫 → 报「播放态切换…未调用」
  check('原生③b 播放态切换漏调守卫', () => {
    const s = tamper(REAL.appdel,
      '  // 播放/暂停/停止切换时同步时钟生命周期：暂停/停止即停钟（8.3Hz 在非播放态是\n  // 净唤醒，锁屏后台耗电），恢复播放时重建。放在早退（无标题）之前——即使元数据\n  // 尚未到达，暂停已成立，时钟就不该继续跑。\n  LXSyncNowPlayingLyricTimer();\n',
      '')
    return nativeInvariants(s).reasons
  }, '播放态切换')

  // ④ tick 里加回 NSLog → 报「LXNowPlayingLyricStep 内含 NSLog」
  check('原生④ tick 恢复 NSLog', () => {
    const s = tamper(REAL.appdel, 'LXNowPlayingLyricIndex = found;',
      'LXNowPlayingLyricIndex = found;\n    NSLog(@"[LXLyric] %@", text);')
    return nativeInvariants(s).reasons
  }, 'LXNowPlayingLyricStep 内含 NSLog')

  // ⑤ 时钟周期改成 1s → 报「周期不再是 0.12s」
  check('原生⑤ 周期漂移', () => {
    const s2 = REAL.appdel.replace(/0\.12 \* NSEC_PER_SEC/g, '1.0 * NSEC_PER_SEC')
    return nativeInvariants(s2).reasons
  }, '周期不再是 0.12s')

  // — JS 反例 —
  // ⑥ 删掉 getCurrentTime 的 AppState 守卫 → 报「无 AppState 前台守卫」
  check('JS⑥ 慢校准无前台守卫', () => {
    const s = tamper(REAL.playProgress,
      "if (AppState.currentState !== 'active') return\n    let id = playerState.musicInfo.id",
      'let id = playerState.musicInfo.id')
    return jsInvariants(s).reasons
  }, 'getCurrentTime 无 AppState 前台守卫')

  // ⑦ 删掉 4Hz 回调的守卫 → 报「onPlayerPosition 回调无 AppState 前台守卫」
  check('JS⑦ 位置事件无前台守卫', () => {
    const s = tamper(REAL.playProgress,
      "onPlayerPosition((position, rate) => {\n    if (AppState.currentState !== 'active') return\n",
      'onPlayerPosition((position, rate) => {\n')
    return jsInvariants(s).reasons
  }, 'onPlayerPosition 回调无 AppState 前台守卫')

  // ⑧ 慢校准 tick 改回 BackgroundTimer.setInterval → 报「每秒申请后台任务断言」
  check('JS⑧ 慢校准回退 BackgroundTimer', () => {
    const s = tamper(REAL.playProgress,
      'updateTimeout = setInterval(() => {',
      'updateTimeout = BackgroundTimer.setInterval(() => {')
    return jsInvariants(s).reasons
  }, '每秒申请后台任务断言')

  return results
}

// ---------------------------------------------------------------------------
// 玻璃「覆盖暂停」链路（2026-09-30 新增）：不可见的 MTKView 不得逐帧渲染
// ---------------------------------------------------------------------------

const GLASS_FILES = {
  effectView: 'ios/Vendor/LiquidGlassKit/Sources/LiquidGlassEffectView.swift',
  manager: 'ios/Vendor/LiquidGlassKit/Sources/LiquidGlassViewManager.mm',
  comp: 'src/components/common/LiquidGlass.tsx',
  tabbar: 'src/components/layout/ModernTabBar.tsx',
  playerbar: 'src/components/player/PlayerBar/index.tsx',
  hookCommon: 'src/store/common/hook.ts',
  playingIcon: 'src/components/common/PlayingIcon.tsx',
}

const readGlass = (over = {}) => {
  const files = {}
  for (const [k, p] of Object.entries(GLASS_FILES)) {
    files[k] = over[k] ?? read(p)
  }
  return files
}

const pausedInvariants = (files) => {
  const reasons = []
  // ① 原生入口：EffectView.setPaused 转发 MTKView.isPaused
  if (!/@objc\s+public\s+func\s+setPaused\(_\s+paused:\s*Bool\)/.test(files.effectView)) {
    reasons.push('LiquidGlassEffectView 缺 setPaused:（省电门无原生入口）')
  }
  if (!/liquidGlassView\?\.isPaused\s*=\s*paused/.test(files.effectView)) {
    reasons.push('setPaused: 未落到 MTKView.isPaused（暂停不生效）')
  }
  // ② manager：protocol 声明 + host applyPaused:（respondsToSelector 分流）+ 缓存重放 + prop
  if (!/- \(void\)setPaused:\(BOOL\)paused;/.test(files.manager)) {
    reasons.push('LGGlassBackingCustomizations 缺 setPaused: 声明（磨砂档无分流依据）')
  }
  if (!/- \(void\)applyPaused:\(BOOL\)paused/.test(files.manager)) {
    reasons.push('宿主缺 applyPaused:（缓存 + respondsToSelector 分流）')
  }
  // 定位 reapply 函数【定义体】（不能 indexOf 首次出现——installGlassBacking 里
  // 的调用处在定义之前，从那里 +400 字符看不到 applyPaused）
  const reapplyAt = files.manager.indexOf('- (void)reapplyCachedPropsToBacking')
  if (reapplyAt < 0 || !/applyPaused:_paused/.test(files.manager.slice(reapplyAt, reapplyAt + 400))) {
    reasons.push('reapplyCachedPropsToBacking 未重放 paused（覆盖下切液态开关会丢暂停态、恢复渲染）')
  }
  if (!/RCT_CUSTOM_VIEW_PROPERTY\(paused,\s*NSNumber,\s*LGLiquidGlassHostView\)/.test(files.manager)) {
    reasons.push('manager 缺 paused prop（JS 门控传不到原生）')
  }
  // ③ JS 组件：paused 声明 + 透传
  if (!/paused\?\s*:\s*boolean/.test(files.comp)) {
    reasons.push('LiquidGlass.tsx 缺 paused prop 声明')
  }
  if (!/paused=\{paused\}/.test(files.comp)) {
    reasons.push('LiquidGlass.tsx 未透传 paused（声明了但没接）')
  }
  // ④ 消费点：TabBar 按全局 Home 判定；PlayerBar 按所属屏幕 componentId 判定
  if (!/useHomeCovered\(\)/.test(files.tabbar) || !/paused=\{homeCovered\}/.test(files.tabbar)) {
    reasons.push('ModernTabBar 未接 paused={homeCovered}（Tab 栏玻璃被覆盖时仍逐帧渲染）')
  }
  if (!/useScreenCovered\(componentId\)/.test(files.playerbar) || !/paused=\{screenCovered\}/.test(files.playerbar)) {
    reasons.push('PlayerBar 未接 paused={screenCovered}（迷你条玻璃被覆盖时仍逐帧渲染）')
  }
  // ⑤ 覆盖判定 hook 本体
  if (!/export const useHomeCovered/.test(files.hookCommon) || !/export const useScreenCovered/.test(files.hookCommon)) {
    reasons.push('store/common/hook 缺 useHomeCovered / useScreenCovered（覆盖判定无从派生）')
  }
  // ⑥ PlayingIcon（列表「正在播放」循环动画）必须有覆盖门控
  if (!/isPlay\s*&&\s*!homeCovered/.test(files.playingIcon)) {
    reasons.push('PlayingIcon 缺覆盖门控（Home 被覆盖时循环动画仍每帧驱动）')
  }
  return reasons
}

const runPausedCounterExamples = () => {
  const results = []
  const check = (name, files, expectSubstr) => {
    const hits = pausedInvariants(files)
    results.push({ name, ok: hits.some(r => r.includes(expectSubstr)), detail: hits })
  }
  // P1 抹掉原生入口
  check('P1 EffectView 抹掉 setPaused', readGlass({
    effectView: read(GLASS_FILES.effectView).replace(/@objc public func setPaused\(_ paused: Bool\) \{[\s\S]*?\n {4}\}/, ''),
  }), '缺 setPaused:')
  // P2 抹掉 paused prop
  check('P2 manager 抹掉 paused prop', readGlass({
    manager: read(GLASS_FILES.manager).replace('RCT_CUSTOM_VIEW_PROPERTY(paused, NSNumber, LGLiquidGlassHostView) {', 'REMOVED(paused, NSNumber, LGLiquidGlassHostView) {'),
  }), '缺 paused prop')
  // P3 抹掉重放（覆盖下切开关丢暂停态）
  check('P3 manager 抹掉 paused 重放', readGlass({
    manager: read(GLASS_FILES.manager).replace('[self applyPaused:_paused];', ''),
  }), '未重放 paused')
  // P4 JS 未透传
  check('P4 LiquidGlass 抹掉透传', readGlass({
    comp: read(GLASS_FILES.comp).replace('paused={paused}', 'removedX={paused}'),
  }), '未透传 paused')
  // P5 消费点脱钩
  check('P5 TabBar 抹掉 paused', readGlass({
    tabbar: read(GLASS_FILES.tabbar).replace(/paused=\{homeCovered\}/g, 'removedX={homeCovered}'),
  }), 'ModernTabBar 未接')
  check('P6 PlayingIcon 恢复无条件动画', readGlass({
    playingIcon: read(GLASS_FILES.playingIcon).replace('const active = isPlay && !homeCovered', 'const active = isPlay'),
  }), 'PlayingIcon 缺覆盖门控')
  return results
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const realNative = nativeInvariants(REAL.appdel)
const realJs = jsInvariants(REAL.playProgress)
const realPaused = pausedInvariants(readGlass())

console.log('=== sim-power-drain ===')
console.log('\n[原生 AppDelegate.mm]')
if (realNative.ok) console.log('  PASS 原生歌词时钟可停 / 无热路径 NSLog / 周期契约')
else realNative.reasons.forEach(r => console.log('  FAIL ' + r))

console.log('\n[JS playProgress.ts]')
if (realJs.ok) console.log('  PASS 后台守卫齐备')
else realJs.reasons.forEach(r => console.log('  FAIL ' + r))

console.log('\n[玻璃覆盖暂停链路（前台省电）]')
if (realPaused.length === 0) console.log('  PASS paused 链路 8 文件贯通（EffectView/manager/组件/消费点/hook/图标）')
else realPaused.forEach(r => console.log('  FAIL ' + r))

console.log('\n[反例自检]')
const ceResults = runCounterExamples()
const peResults = runPausedCounterExamples()
let ceAllOk = true
for (const r of [...ceResults, ...peResults]) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name} —— ${r.ok ? '已拦下' : `未拦下（reasons=${JSON.stringify(r.detail)}）`}`)
  if (!r.ok) ceAllOk = false
}

const allOk = realNative.ok && realJs.ok && realPaused.length === 0 && ceAllOk
console.log(`\n结果：${allOk ? 'ALL PASS' : '有失败项'}（不变量 ${realNative.ok && realJs.ok && realPaused.length === 0 ? '3/3' : '有失败'}；反例 ${[...ceResults, ...peResults].filter(r => r.ok).length}/${ceResults.length + peResults.length}）`)
process.exit(allOk ? 0 : 1)
