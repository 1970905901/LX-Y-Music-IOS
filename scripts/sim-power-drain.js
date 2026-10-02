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
 *
 * 2026-10-02 追加第五段「后台不可见即停」：液态玻璃的 MTKView 连续渲染与播放详情
 * 的缓冲进度轮询都只在 App 前台有意义，锁屏后台必须停（见文件末尾 BACKGROUND_*）。
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
  // ④ 消费点：TabBar 按全局 Home 判定；PlayerBar 按所属屏幕 componentId 判定。
  // 2026-10-02 起 paused 还必须含「App 前台」门（见文件末尾「后台不可见即停」），
  // 故这里只要求门控变量存在且一路透传到 paused，具体公式由那段契约断言。
  if (!/useHomeCovered\(\)/.test(files.tabbar) || !/paused=\{glassPaused\}/.test(files.tabbar)) {
    reasons.push('ModernTabBar 未接 paused={glassPaused}（Tab 栏玻璃被覆盖时仍逐帧渲染）')
  }
  if (!/useScreenCovered\(componentId\)/.test(files.playerbar) || !/paused=\{glassPaused\}/.test(files.playerbar)) {
    reasons.push('PlayerBar 未接 paused={glassPaused}（迷你条玻璃被覆盖时仍逐帧渲染）')
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
    tabbar: read(GLASS_FILES.tabbar).replace(/paused=\{glassPaused\}/g, 'removedX={glassPaused}'),
  }), 'ModernTabBar 未接')
  check('P6 PlayingIcon 恢复无条件动画', readGlass({
    playingIcon: read(GLASS_FILES.playingIcon).replace('const active = isPlay && !homeCovered', 'const active = isPlay'),
  }), 'PlayingIcon 缺覆盖门控')
  return results
}

// ---------------------------------------------------------------------------
// 前台「不可见即停」（2026-10-01）：被压栈页覆盖 / App 退后台时必须停掉的持续动画
//
// 背景：
//   ① 封面旋转、「正在播放」跳动条走 useNativeDriver（原生驱动）——iOS 不会因为
//      锁屏/后台自动暂停它们，边听歌边锁屏仍在持续提交合成帧；
//   ② 歌词「每帧连续滚动」循环（rAF）后台会随显示链路停摆，但被压栈页
//      （评论 / 歌单详情 / 设置详情…）覆盖时照跑：每帧一次 bridge 调用 +
//      原生 scrollToOffset，是不可见的净耗电。
// 这些都不会崩溃、也过得了 tsc/eslint，只能靠契约绑住。
// ---------------------------------------------------------------------------

const VISIBILITY_FILES = {
  hookCommon: 'src/store/common/hook.ts',
  playingIcon: 'src/components/common/PlayingIcon.tsx',
  picVertical: 'src/screens/PlayDetail/Vertical/Pic.tsx',
  picHorizontal: 'src/screens/PlayDetail/Horizontal/Pic.tsx',
  lyricVertical: 'src/screens/PlayDetail/Vertical/Lyric.tsx',
  lyricHorizontal: 'src/screens/PlayDetail/Horizontal/Lyric.tsx',
  karaoke: 'src/screens/PlayDetail/components/KaraokeLyric.tsx',
}

const readVisibility = (over = {}) => {
  const files = {}
  for (const key of Object.keys(VISIBILITY_FILES)) {
    files[key] = over[key] !== undefined ? over[key] : read(VISIBILITY_FILES[key])
  }
  return files
}

/** 截出 `export const <name> = ...` 的函数体（到下一个顶格 '}' 为止），把不变量绑在具体函数上。 */
const sliceExportedFunction = (src, name) => {
  const start = src.indexOf(`export const ${name}`)
  if (start < 0) return ''
  const rest = src.slice(start)
  const end = rest.indexOf('\n}\n')
  return end < 0 ? rest : rest.slice(0, end)
}

const visibilityInvariants = (files) => {
  const reasons = []

  // ① 门控 hook 本体：前台判定 + 「播放详情被压栈页覆盖」判定
  const appActiveBody = sliceExportedFunction(files.hookCommon, 'useAppActive')
  if (!appActiveBody) {
    reasons.push('common/hook 缺 useAppActive（原生驱动动画的「App 前台」门无从判定）')
  } else if (!/AppState\.addEventListener\(\s*'change'/.test(appActiveBody)) {
    reasons.push('useAppActive 未订阅 AppState change（前后台切换不会重算门控值）')
  }
  const coveredBody = sliceExportedFunction(files.hookCommon, 'usePlayDetailCovered')
  if (!coveredBody) {
    reasons.push('common/hook 缺 usePlayDetailCovered（无法判定播放详情被压栈页覆盖）')
  } else if (!/state_event\.on\(\s*'componentIdsUpdated'/.test(coveredBody)) {
    reasons.push('usePlayDetailCovered 未订阅 componentIdsUpdated（压栈/出栈后门控值不更新）')
  }

  // ② 封面旋转（竖屏 / 横屏）：必须是 allowSpin && !covered && appActive
  const spinGateOk = (src) => /const spinAllowed\s*=\s*allowSpin\s*&&\s*!covered\s*&&\s*appActive/.test(src)
  if (!spinGateOk(files.picVertical)) {
    reasons.push('竖屏封面旋转未接不可见门（缺 spinAllowed = allowSpin && !covered && appActive）')
  }
  if (!spinGateOk(files.picHorizontal)) {
    reasons.push('横屏封面旋转未接不可见门（缺 spinAllowed = allowSpin && !covered && appActive）')
  }
  for (const [key, label] of [['picVertical', '竖屏'], ['picHorizontal', '横屏']]) {
    if (/if\s*\(\s*isPlay\s*&&\s*allowSpin\s*\)/.test(files[key])) {
      reasons.push(`${label}封面旋转仍用裸 allowSpin 启停（被覆盖/退后台时照转）`)
    }
  }

  // ③ 歌词每帧连续滚动循环：必须被 covered/appActive 门控，且门控值进 deps（否则切回不重启）
  if (!/if\s*\(\s*!active\s*\|\|\s*covered\s*\|\|\s*!appActive\s*\)\s*return/.test(files.lyricVertical)) {
    reasons.push('竖屏歌词连续滚动未接不可见门（缺 if (!active || covered || !appActive) return）')
  }
  if (!/\[\s*active,\s*lyricLines,\s*covered,\s*appActive\s*\]/.test(files.lyricVertical)) {
    reasons.push('竖屏歌词连续滚动 effect 依赖未含 covered/appActive（门控值变化不重启循环）')
  }
  if (!/if\s*\(\s*covered\s*\|\|\s*!appActive\s*\)\s*return/.test(files.lyricHorizontal)) {
    reasons.push('横屏歌词连续滚动未接不可见门（缺 if (covered || !appActive) return）')
  }
  if (!/\[\s*lyricLines,\s*scrollToActiveContinuous,\s*covered,\s*appActive\s*\]/.test(files.lyricHorizontal)) {
    reasons.push('横屏歌词连续滚动 effect 依赖未含 covered/appActive（门控值变化不重启循环）')
  }

  // ④ 逐字卡拉OK：门控值算了还必须真的早退
  if (!/const canTick\s*=\s*isActive\s*&&\s*!covered\s*&&\s*appActive/.test(files.karaoke)) {
    reasons.push('逐字卡拉OK未接不可见门（缺 canTick = isActive && !covered && appActive）')
  } else if (!/if\s*\(\s*!canTick\s*\)\s*return/.test(files.karaoke)) {
    reasons.push('逐字卡拉OK的 rAF 未按 canTick 早退（门控值算了却没用）')
  }

  // ⑤ 列表「正在播放」跳动条：覆盖 + 前台双门
  if (!/const active\s*=\s*isPlay\s*&&\s*!homeCovered\s*&&\s*appActive/.test(files.playingIcon)) {
    reasons.push('PlayingIcon 未同时门控「Home 被覆盖」与「App 前台」')
  }

  return reasons
}

const runVisibilityCounterExamples = () => {
  const results = []
  const check = (name, files, expectSubstr) => {
    let hits = []
    try {
      hits = visibilityInvariants(files)
    } catch (e) {
      results.push({ name, ok: false, detail: `抛异常: ${e.message}` })
      return
    }
    const hit = hits.some(r => r.includes(expectSubstr))
    results.push({ name, ok: hit, detail: hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(hits)}）` })
  }
  const hookSrc = read(VISIBILITY_FILES.hookCommon)

  // V1 抹掉 useAppActive
  check('V1 抹掉 useAppActive', readVisibility({
    hookCommon: hookSrc.replace('export const useAppActive', 'const removedUseAppActive'),
  }), '缺 useAppActive')
  // V2 useAppActive 不再订阅 AppState
  check('V2 useAppActive 不订阅 AppState', readVisibility({
    hookCommon: hookSrc.replace("AppState.addEventListener('change'", "AppState.addEventListener('removed'"),
  }), '未订阅 AppState change')
  // V3 抹掉 usePlayDetailCovered
  check('V3 抹掉 usePlayDetailCovered', readVisibility({
    hookCommon: hookSrc.replace('export const usePlayDetailCovered', 'const removedUsePlayDetailCovered'),
  }), '缺 usePlayDetailCovered')
  // V4 usePlayDetailCovered 不再订阅压栈事件
  check('V4 usePlayDetailCovered 不订阅组件栈事件', readVisibility({
    hookCommon: hookSrc.replace("global.state_event.on('componentIdsUpdated', handleUpdate)",
      "global.state_event.on('componentIdsUpdatedX', handleUpdate)"),
  }), '未订阅 componentIdsUpdated')
  // V5/V6 封面旋转回退成裸 allowSpin
  check('V5 竖屏封面回退裸 allowSpin', readVisibility({
    picVertical: read(VISIBILITY_FILES.picVertical).replace(
      'const spinAllowed = allowSpin && !covered && appActive',
      'const spinAllowed = allowSpin'),
  }), '竖屏封面旋转未接不可见门')
  check('V6 横屏封面回退裸 allowSpin', readVisibility({
    picHorizontal: read(VISIBILITY_FILES.picHorizontal).replace(
      'const spinAllowed = allowSpin && !covered && appActive',
      'const spinAllowed = allowSpin'),
  }), '横屏封面旋转未接不可见门')
  // V7/V8 竖屏歌词循环：抹门控 / 门控值不进 deps
  check('V7 竖屏歌词循环抹掉门控', readVisibility({
    lyricVertical: read(VISIBILITY_FILES.lyricVertical).replace(
      'if (!active || covered || !appActive) return', 'if (!active) return'),
  }), '竖屏歌词连续滚动未接不可见门')
  check('V8 竖屏歌词循环 deps 漏门控值', readVisibility({
    lyricVertical: read(VISIBILITY_FILES.lyricVertical).replace(
      '[active, lyricLines, covered, appActive]', '[active, lyricLines]'),
  }), '竖屏歌词连续滚动 effect 依赖未含')
  // V9/V10 横屏歌词循环
  check('V9 横屏歌词循环抹掉门控', readVisibility({
    lyricHorizontal: read(VISIBILITY_FILES.lyricHorizontal).replace(
      'if (covered || !appActive) return', ''),
  }), '横屏歌词连续滚动未接不可见门')
  check('V10 横屏歌词循环 deps 漏门控值', readVisibility({
    lyricHorizontal: read(VISIBILITY_FILES.lyricHorizontal).replace(
      '[lyricLines, scrollToActiveContinuous, covered, appActive]',
      '[lyricLines, scrollToActiveContinuous]'),
  }), '横屏歌词连续滚动 effect 依赖未含')
  // V11/V12 逐字卡拉OK：抹门控 / 算了不早退
  check('V11 逐字卡拉OK 抹掉门控', readVisibility({
    karaoke: read(VISIBILITY_FILES.karaoke).replace(
      'const canTick = isActive && !covered && appActive', 'const canTick = isActive'),
  }), '逐字卡拉OK未接不可见门')
  check('V12 逐字卡拉OK 不按 canTick 早退', readVisibility({
    karaoke: read(VISIBILITY_FILES.karaoke).replace('if (!canTick) return', ''),
  }), '未按 canTick 早退')
  // V13 PlayingIcon 只门控覆盖、不门控前台
  check('V13 PlayingIcon 漏前台门', readVisibility({
    playingIcon: read(VISIBILITY_FILES.playingIcon).replace(
      'const active = isPlay && !homeCovered && appActive', 'const active = isPlay && !homeCovered'),
  }), 'PlayingIcon 未同时门控')

  return results
}

// ---------------------------------------------------------------------------
// 后台「不可见即停」（2026-10-02）：边听歌边锁屏时不得继续渲染 / 轮询
//
// 背景：本 App 的音频后台播放能力让进程在锁屏后仍常驻，于是两类「前台才需要」的
// 工作会跟着跑一整个晚上：
//   ① 液态玻璃的 MTKView 是**连续渲染**（isPaused=false），不会随锁屏自动停 ——
//      Tab 栏 2 块 + 迷你播放器 1 块，锁屏期间白烧 GPU（此前只按「被压栈页覆盖」停）；
//   ② 播放详情页的缓冲进度轮询 useBufferProgress 每秒一次原生桥往返 + setState，
//      原生 FLAC 路径会一直轮询到整首歌缓冲完 —— 锁屏时进度条根本不可见。
// 两者都不会崩、也过得了 tsc/eslint，只能靠契约绑住。
// ---------------------------------------------------------------------------

const BACKGROUND_FILES = {
  tabbar: 'src/components/layout/ModernTabBar.tsx',
  playerbar: 'src/components/player/PlayerBar/index.tsx',
  bufferHook: 'src/plugins/player/hook.ts',
  fsIos: 'src/utils/fs.ios.ts',
}

const readBackground = (over = {}) => {
  const files = {}
  for (const key of Object.keys(BACKGROUND_FILES)) {
    files[key] = over[key] !== undefined ? over[key] : read(BACKGROUND_FILES[key])
  }
  return files
}

const backgroundInvariants = (files) => {
  const reasons = []

  // ① Tab 栏两块玻璃：paused = homeCovered || !appActive
  if (!/useAppActive\(\)/.test(files.tabbar)) {
    reasons.push('ModernTabBar 未引 useAppActive（玻璃没有「App 前台」门）')
  }
  if (!/const glassPaused\s*=\s*homeCovered\s*\|\|\s*!appActive/.test(files.tabbar)) {
    reasons.push('ModernTabBar 玻璃未按 App 前台门控（paused 必须是 homeCovered || !appActive）')
  }
  if (!/paused=\{glassPaused\}/.test(files.tabbar)) {
    reasons.push('ModernTabBar 未把带前台门的 glassPaused 传给 LiquidGlass')
  }

  // ② 迷你播放器玻璃：paused = screenCovered || !appActive，且必须进 useMemo 依赖
  if (!/useAppActive\(\)/.test(files.playerbar)) {
    reasons.push('PlayerBar 未引 useAppActive（玻璃没有「App 前台」门）')
  }
  if (!/const glassPaused\s*=\s*screenCovered\s*\|\|\s*!appActive/.test(files.playerbar)) {
    reasons.push('PlayerBar 玻璃未按 App 前台门控（paused 必须是 screenCovered || !appActive）')
  }
  if (!/paused=\{glassPaused\}/.test(files.playerbar)) {
    reasons.push('PlayerBar 未把带前台门的 glassPaused 传给 LiquidGlass')
  }
  // playerComponent 走 useMemo：依赖漏掉 glassPaused 会让 paused 永远停在旧值
  const playerMemoDeps = /\},\s*\[([^\]]*)\]/.exec(files.playerbar.slice(files.playerbar.indexOf('const playerComponent = useMemo')))
  if (!playerMemoDeps || !/glassPaused/.test(playerMemoDeps[1])) {
    reasons.push('PlayerBar 的 playerComponent useMemo 依赖漏 glassPaused（前台门变化不会重建节点）')
  }

  // ③ 缓冲进度轮询：必须由 startItv 统一起表，且 !appActive 时不起表 / 退后台立刻停表。
  //    只取 useBufferProgress 的函数体——文件里 useProgress 现在也有 startItv 与
  //    AppState 订阅，从整文件匹配会让篡改被同名实现顶包放过。
  const bufferAll = files.bufferHook
  const bufferAt = bufferAll.indexOf('export function useBufferProgress')
  const buffer = bufferAt >= 0 ? bufferAll.slice(bufferAt) : bufferAll
  if (!/AppState\.currentState\s*===\s*'active'/.test(buffer)) {
    reasons.push('useBufferProgress 未读 AppState 判定前台（后台仍会每秒轮询）')
  }
  if (!/const startItv\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,200}?!appActive/.test(buffer)) {
    reasons.push('useBufferProgress 的 startItv 缺 !appActive 早退（后台照样起表）')
  }
  const setItvCount = (buffer.match(/interval\s*=\s*setInterval\(updateBuffer, 1000\)/g) || []).length
  if (setItvCount !== 1) {
    reasons.push(`useBufferProgress 起表点必须唯一（收到 ${setItvCount} 处；散在各监听里后台停不干净）`)
  }
  if (!/AppState\.addEventListener\(\s*'change'/.test(buffer)) {
    reasons.push('useBufferProgress 未订阅 AppState change（前后台切换不会停/起表）')
  }
  if (!/if\s*\(!appActive\)\s*\{[\s\S]{0,80}?clearItv\(\)/.test(buffer)) {
    reasons.push('useBufferProgress 退后台未 clearItv（后台仍在每秒轮询）')
  }

  // ④ 下载进度上报限流：RNFS 默认（progressInterval/Divider 都为 0）逐数据块回调，
  // 每次都会串起 store 事件 + React 渲染（悬浮下载球/下载管理列表）
  if (!/progressInterval:\s*\d+/.test(files.fsIos)) {
    reasons.push('fs.ios.ts 的 downloadFile 未限流 progressInterval（逐数据块回调 → 每次一串 React 渲染）')
  }

  return reasons
}

const runBackgroundCounterExamples = () => {
  const results = []
  const check = (name, files, expectSubstr) => {
    let hits = []
    try {
      hits = backgroundInvariants(files)
    } catch (e) {
      results.push({ name, ok: false, detail: `抛异常: ${e.message}` })
      return
    }
    const hit = hits.some(r => r.includes(expectSubstr))
    results.push({ name, ok: hit, detail: hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(hits)}）` })
  }

  // B1/B2 玻璃丢掉「App 前台」门（回退成只按覆盖门控）
  check('B1 TabBar 玻璃漏前台门', readBackground({
    tabbar: read(BACKGROUND_FILES.tabbar).replace(
      'const glassPaused = homeCovered || !appActive',
      'const glassPaused = homeCovered'),
  }), 'ModernTabBar 玻璃未按 App 前台门控')
  check('B2 PlayerBar 玻璃漏前台门', readBackground({
    playerbar: read(BACKGROUND_FILES.playerbar).replace(
      'const glassPaused = screenCovered || !appActive',
      'const glassPaused = screenCovered'),
  }), 'PlayerBar 玻璃未按 App 前台门控')
  // B3 useMemo 依赖漏 glassPaused
  check('B3 PlayerBar useMemo 依赖漏前台门', readBackground({
    playerbar: read(BACKGROUND_FILES.playerbar).replace(
      '[glassOpacity, liquidGlassOn, glassPaused,',
      '[glassOpacity, liquidGlassOn,'),
  }), 'useMemo 依赖漏 glassPaused')
  // B4 缓冲轮询去掉前台早退
  check('B4 缓冲轮询去掉前台早退', readBackground({
    bufferHook: read(BACKGROUND_FILES.bufferHook).replace(
      'if (!appActive || isUnmounted || interval) return',
      'if (isUnmounted || interval) return'),
  }), 'startItv 缺 !appActive 早退')
  // B5 起表散回各监听（回归到旧实现：后台停不干净）
  check('B5 缓冲轮询起表散回监听', readBackground({
    bufferHook: read(BACKGROUND_FILES.bufferHook).replace(
      '          pollWanted = true\n          startItv()',
      '          pollWanted = true\n          interval = setInterval(updateBuffer, 1000)'),
  }), '起表点必须唯一')
  // B6 缓冲轮询不再订阅前后台切换
  check('B6 缓冲轮询不订阅前后台切换', readBackground({
    bufferHook: read(BACKGROUND_FILES.bufferHook).replace(
      "const appStateSub = AppState.addEventListener('change'",
      "const appStateSub = AppState.addEventListener('changeX'"),
  }), '未订阅 AppState change')
  // B7 下载进度限流被删（回退成逐数据块回调）
  check('B7 下载进度未限流', readBackground({
    fsIos: read(BACKGROUND_FILES.fsIos).replace('progressInterval: 250,', ''),
  }), '未限流 progressInterval')

  return results
}
// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const realNative = nativeInvariants(REAL.appdel)
const realJs = jsInvariants(REAL.playProgress)
const realPaused = pausedInvariants(readGlass())
const realVisibility = visibilityInvariants(readVisibility())
const realBackground = backgroundInvariants(readBackground())

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

console.log('\n[前台不可见即停（压栈覆盖 / App 退后台）]')
if (realVisibility.length === 0) console.log('  PASS 封面旋转×2 / 歌词连续滚动×2 / 逐字卡拉OK / 正在播放图标 / 门控 hook 全部贯通')
else realVisibility.forEach(r => console.log('  FAIL ' + r))

console.log('\n[后台不可见即停（玻璃 Metal 渲染 / 缓冲进度轮询）]')
if (realBackground.length === 0) console.log('  PASS 玻璃 ×3 与缓冲轮询均按「App 前台」停摆（锁屏后台零 GPU / 零轮询）')
else realBackground.forEach(r => console.log('  FAIL ' + r))

console.log('\n[反例自检]')
const ceResults = runCounterExamples()
const peResults = runPausedCounterExamples()
const veResults = runVisibilityCounterExamples()
const beResults = runBackgroundCounterExamples()
let ceAllOk = true
for (const r of [...ceResults, ...peResults, ...veResults, ...beResults]) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name} —— ${r.ok ? '已拦下' : `未拦下（reasons=${JSON.stringify(r.detail)}）`}`)
  if (!r.ok) ceAllOk = false
}

const invariantsOk = realNative.ok && realJs.ok && realPaused.length === 0 && realVisibility.length === 0 && realBackground.length === 0
const allOk = invariantsOk && ceAllOk
const allCe = [...ceResults, ...peResults, ...veResults, ...beResults]
console.log(`\n结果：${allOk ? 'ALL PASS' : '有失败项'}（不变量 ${invariantsOk ? '5/5' : '有失败'}；反例 ${allCe.filter(r => r.ok).length}/${allCe.length}）`)
process.exit(allOk ? 0 : 1)
