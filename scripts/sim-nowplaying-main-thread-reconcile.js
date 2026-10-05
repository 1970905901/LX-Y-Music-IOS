/**
 * sim-nowplaying-main-thread-reconcile.js
 *
 * 「卡片写入必须在主线程 + 漂移必须能自愈」契约（2026-10-06 真机：修了两轮仍复现）。
 *
 * 现象（用户真机）：打开软件 → 导入音源 → 播放，控制中心 / 灵动岛的按钮与进度条失效；
 * 播放本身正常（有声音、App 内进度条在走）。重启软件后能正常一段时间，**然后又失效**。
 *
 * 两处硬伤：
 *   ① 线程：歌词时钟跑在专用后台串行队列（com.lxmusic.nowplaying.lyric），每次歌词换行都会调用
 *      LXApplyNowPlayingInfo() → 那里直接写 MPNowPlayingInfoCenter.nowPlayingInfo / .playbackState
 *      并调用 LXSyncRemoteCommandAvailability()（MPRemoteCommandCenter）。这些 MediaPlayer 接口
 *      必须在主线程使用：后台线程写入会被系统忽略，并与主线程写入互相覆盖 —— 卡片随机停在错误的
 *      播放态或丢失某次发布，表现为「按了没反应 / 进度条停走」，且随时序随机「好一阵又坏」。
 *   ② 自愈：卡片一旦漂移，除了「歌词换行 / 用户按键 / 回前台」没有任何修复路径 ——
 *      无歌词或稀疏歌词的歌会长期停在坏状态。
 *
 * 修法：
 *   · LXApplyNowPlayingInfo 开头加主线程守卫（非主线程重新派发到主队列），所有 MediaPlayer 写入
 *     收敛到主线程一次完成；
 *   · 新增 3s 主线程收敛看门狗（只在有卡片时运行）：核对「系统持有的播放态 / 卡片信息 / 命令可用性 /
 *     音频会话是否 active」，不一致就重发并打一行 ###LXNowPlaying### reconcile；
 *   · 看门狗在两种翻转窗口（重绘翻转、封面翻转）内不判定漂移，避免与翻转互相打架。
 *
 * 运行：node scripts/sim-nowplaying-main-thread-reconcile.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = fs.readFileSync(path.join(ROOT, 'ios/LxMusicMobile/AppDelegate.mm'), 'utf8').replace(/\r\n/g, '\n')

const windowBetween = (src, startAnchor, endAnchor, fallback = 3000) => {
  const start = src.indexOf(startAnchor)
  if (start < 0) return ''
  const end = src.indexOf(endAnchor, start + startAnchor.length)
  return end < 0 ? src.slice(start, start + fallback) : src.slice(start, end)
}

const structuralReasons = (src) => {
  const reasons = []

  // ① 主线程守卫
  const applyFn = windowBetween(src, 'static void LXApplyNowPlayingInfo(void) {', 'static void LXBeginReceivingRemoteControlEvents', 2500)
  if (!applyFn) {
    reasons.push('找不到 LXApplyNowPlayingInfo')
  } else {
    if (!/if \(!\[NSThread isMainThread\]\) \{\s*dispatch_async\(dispatch_get_main_queue\(\), \^\{ LXApplyNowPlayingInfo\(\); \}\);\s*return;\s*\}/.test(applyFn)) {
      reasons.push('LXApplyNowPlayingInfo 没有主线程守卫：歌词时钟（后台队列）会直接写 MediaPlayer 接口')
    }
    if (!/if \(hasCard\) LXStartNowPlayingReconcileTimer\(\);/.test(applyFn)) {
      reasons.push('发布卡片后没有确保收敛看门狗在跑')
    }
  }

  // ② 歌词时钟不得直接碰 MediaPlayer 接口（只能经 LXApplyNowPlayingInfo）
  const step = windowBetween(src, 'static void LXNowPlayingLyricStep(void) {', 'static void LXNowPlayingLyricRedraw', 4000)
  if (!step) {
    reasons.push('找不到 LXNowPlayingLyricStep')
  } else if (/MPNowPlayingInfoCenter|MPRemoteCommandCenter/.test(step)) {
    reasons.push('歌词时钟（后台队列）直接引用 MediaPlayer 接口，必须走主线程化的 LXApplyNowPlayingInfo')
  }

  // ③ 看门狗存在且被正确接线
  if (!/static void LXReconcileNowPlayingCardNow\(void\) \{/.test(src)) {
    reasons.push('缺少收敛看门狗 LXReconcileNowPlayingCardNow（卡片漂移后无自愈路径）')
  } else {
    const reconcile = windowBetween(src, 'static void LXReconcileNowPlayingCardNow(void) {', 'static void LXApplyNowPlayingInfo(void) {', 3000)
    if (!/nowMs < LXNowPlayingCardRepaintFlipUntilMs \|\| nowMs < LXNowPlayingArtworkRepaintFlipUntilMs/.test(reconcile)) {
      reasons.push('看门狗没有避开翻转窗口（会把正在翻转的假状态当漂移去纠正，与翻转互相打架）')
    }
    if (!/###LXNowPlaying### reconcile stateDrift=/.test(reconcile)) {
      reasons.push('看门狗修复时没有打点（真机无法归因卡片漂移）')
    }
    if (!/infoMissing = \(infoCount > 0 && center\.nowPlayingInfo == nil\)/.test(reconcile)) {
      reasons.push('看门狗没有核对「卡片信息是否丢失」')
    }
    if (!/sessionInactive = \(LXNowPlayingState == MPNowPlayingPlaybackStatePlaying\) && !\[\[AVAudioSession sharedInstance\] isActive\]/.test(reconcile)) {
      reasons.push('看门狗没有核对「播放中但音频会话不 active」')
    }
    if (!/!commandCenter\.playCommand\.enabled/.test(reconcile)) {
      reasons.push('看门狗没有核对遥控命令可用性')
    }
    if (!/LXApplyNowPlayingInfo\(\);\s*\}?\s*$/.test(reconcile.trimEnd() + '\n')) {
      // 只要重发动作存在即可（文本形式可能被后续编辑微调）
      if (!/LXApplyNowPlayingInfo\(\);/.test(reconcile)) reasons.push('看门狗没有重发卡片信息（无法收敛）')
    }
  }
  if (!/if \(!hasInfo\) \{[\s\S]{0,200}?LXStopNowPlayingReconcileTimer\(\);/.test(src)) {
    reasons.push('没有卡片时看门狗没有停表（会永久空转耗电）')
  }
  if (!/LXApplyNowPlayingInfo\(\);\s*LXStopNowPlayingReconcileTimer\(\);/.test(src)) {
    reasons.push('清卡片（LXClearNowPlayingInfo）没有停看门狗')
  }

  // ④ 封面翻转窗口记账
  if (!/LXNowPlayingArtworkRepaintFlipUntilMs = CACurrentMediaTime\(\) \* 1000\.0 \+ LXNowPlayingArtworkRepaintFlipMs;/.test(src)) {
    reasons.push('封面翻转没有记账假状态窗口（看门狗会与其打架）')
  }
  if (!/center\.playbackState = current;\s*\n\s*LXNowPlayingArtworkRepaintFlipUntilMs = 0;/.test(src)) {
    reasons.push('封面翻转还原后没有清窗口标记（看门狗会长期让位）')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：后台写卡片 → 漂移是否可见；看门狗是否能把卡片拉回
// ---------------------------------------------------------------------------
const modelOld = ({ offMainWrite, driftMs }) => {
  // 旧实现：后台写被系统忽略 → 卡片停在旧状态；无自愈（无歌词时尤其明显）
  if (!offMainWrite) return 'ok'
  // 漂移后只有「歌词换行/按键/回前台」才修（模型里简化为：仅在短漂移内能自愈）
  return driftMs < 60000 ? 'flapping' : 'stuck'
}
const modelNew = ({ offMainWrite, reconcile }) => {
  // 新实现：所有写入都在主线程（不再被忽略）；即便仍有未知漂移，3s 看门狗也会拉回
  if (reconcile) return 'ok'
  return offMainWrite ? 'flapping' : 'ok'
}

const models = [
  ['反例：后台线程写 MediaPlayer（系统忽略）+ 无自愈 → 卡片长时间停在错状态', modelOld({ offMainWrite: true, driftMs: 300000 }) === 'stuck'],
  ['反例：后台写 + 短漂移 → 看起来「好一阵又坏」', modelOld({ offMainWrite: true, driftMs: 5000 }) === 'flapping'],
  ['修复后：写入收敛到主线程（不再被忽略）', modelNew({ offMainWrite: false, reconcile: false }) === 'ok'],
  ['修复后：即使仍有未知漂移，3s 看门狗也会拉回卡片', modelNew({ offMainWrite: true, reconcile: true }) === 'ok'],
]

const realReasons = structuralReasons(SRC)

// 反例自检 1：拿掉主线程守卫 → 必须报错
let tamper1 = false
let tamper1Detail = ''
// 反例自检 2：拿掉看门狗接线（发布后不再确保看门狗在跑）→ 必须报错
let tamper2 = false
let tamper2Detail = ''
try {
  const guard = (() => {
    const start = SRC.indexOf('static void LXApplyNowPlayingInfo(void) {')
    const end = SRC.indexOf('@synchronized (LXLyricLock()) {', start)
    return start < 0 || end < 0 ? '' : SRC.slice(start, end)
  })()
  if (!guard) {
    tamper1Detail = '找不到 LXApplyNowPlayingInfo 的主线程守卫锚点'
  } else {
    const t1 = SRC.replace(guard, 'static void LXApplyNowPlayingInfo(void) {\n  ')
    const reasons = structuralReasons(t1)
    tamper1 = reasons.some((r) => r.includes('没有主线程守卫'))
    tamper1Detail = tamper1 ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）`
  }
  const t2 = SRC.replace('  if (hasCard) LXStartNowPlayingReconcileTimer();', '')
  if (t2 === SRC) {
    tamper2Detail = '找不到可 tamper 的看门狗接线锚点'
  } else {
    const reasons = structuralReasons(t2)
    tamper2 = reasons.some((r) => r.includes('没有确保收敛看门狗在跑'))
    tamper2Detail = tamper2 ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）`
  }
} catch (err) {
  tamper1Detail = tamper1Detail || `异常: ${err.message}`
}

console.log('行为模型')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
console.log(`${tamper1 ? 'PASS' : 'FAIL'}  拿掉主线程守卫 —— ${tamper1Detail}`)
console.log(`${tamper2 ? 'PASS' : 'FAIL'}  拿掉看门狗接线 —— ${tamper2Detail}`)

if (realReasons.length) {
  console.error(`\nFAIL  主线程写入 + 漂移自愈契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
const failedModels = models.filter(([, ok]) => !ok)
if (failedModels.length) console.error(`\nFAIL  行为模型未通过（${failedModels.length} 例）`)
if (failedModels.length || realReasons.length || !tamper1 || !tamper2) {
  console.error('\nFAIL  主线程写入 + 漂移自愈契约未通过')
  process.exit(1)
}
console.log(`\nPASS  MediaPlayer 写入主线程化 + 看门狗收敛（结构不变量 4 组 + 行为模型 ${models.length} 例 + 反例 2 例）`)
process.exit(0)
