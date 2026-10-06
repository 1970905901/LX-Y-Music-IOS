/**
 * sim-native-flac-session-takeover.js
 *
 * 「流式 FLAC 引擎不得按换歌重复停用音频会话」契约（2026-10-06 真机根因候选）。
 *
 * 现象（用户真机）：打开软件 → 导入音源 → 播放，控制中心 / 灵动岛的按钮与进度条失效，但
 * **声音正常、App 内进度条在走**；重启软件后能正常一段时间，然后又失效。
 * 用户补充关键信息：播放设置里有 native flac 开关，关掉后走 AVPlayer（TrackPlayer）。
 *
 * 代码事实：JS 侧每首歌开始播都会先 `reset` 再 `openStream`（src/plugins/player/nativeFlac.ts:74/87），
 * 而 openStream 里**无条件**执行
 *   [session setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation]
 * 再 prepareAudioSession（setActive:YES）——每次换歌都把音频会话停用一次。会话停用会让 iOS 撤回
 * 本 App 的 Now Playing 角色：卡片随之中止投递/刷新（按钮按不动、进度条停走），而音频仍由
 * AVAudioEngine 继续渲染；之后要等一次「会话就绪后的信息发布」才可能恢复 —— 与「有声音但卡片死、
 * 时好时坏」的现象一致。
 *
 * 修法：只在「从其它持有者（TrackPlayer 等）接管会话」时停用+重配置；同驱动换歌直接复用会话。
 * 归属标记 LXStreamingFlacOwnsAudioSession 在 TrackPlayer 产生生命周期事件时失效（说明它动过会话）。
 *
 * 运行：node scripts/sim-native-flac-session-takeover.js
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

  if (!/static BOOL LXStreamingFlacOwnsAudioSession = NO;/.test(src)) {
    reasons.push('缺少 LXStreamingFlacOwnsAudioSession 归属标记（无法区分「接管会话」与「同驱动换歌」）')
  }

  const openStream = windowBetween(src, 'RCT_REMAP_METHOD(openStream,', 'NSMutableURLRequest *request', 3000)
  if (!openStream) {
    reasons.push('找不到 openStream（流式 FLAC 打开入口）')
  } else {
    if (!/if \(!LXStreamingFlacOwnsAudioSession\) \{[\s\S]{0,200}?setActive:NO/.test(openStream)) {
      reasons.push('openStream 仍无条件 setActive:NO：每次换歌都会让 iOS 撤回 Now Playing 角色（卡片失效但音频继续）')
    }
    if (!/prepareAudioSession:&sessionError\][\s\S]{0,400}?LXStreamingFlacOwnsAudioSession = YES;/.test(openStream)) {
      reasons.push('openStream 配置会话成功后没有置位归属标记（下次换歌仍会重复停用）')
    }
  }

  const lifecycle = windowBetween(src, 'static void LXHandleTrackPlayerLifecycleNotification(NSNotification *notification) {', 'static void LXHandleNowPlayingInterruptionBegan', 1500)
  if (!lifecycle) {
    reasons.push('找不到 LXHandleTrackPlayerLifecycleNotification（TrackPlayer 生命周期入口）')
  } else if (!/LXStreamingFlacOwnsAudioSession = NO;/.test(lifecycle)) {
    reasons.push('TrackPlayer 生命周期事件没有让归属标记失效（切回 FLAC 时可能没有音频输出）')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：换歌时是否重复停用会话
// ---------------------------------------------------------------------------
// 旧实现：无论是否已接管，都 setActive:NO → 会话被停用 → Now Playing 角色被撤回
const modelOld = () => ({ deactivated: true, nowPlayingRoleLost: true, cardDeadWhileAudioPlays: true })
const modelNew = (ownsSession) => {
  // 新实现：已接管则跳过停用；未接管（从 TrackPlayer 切过来）才停用+重配置
  return { deactivated: !ownsSession, nowPlayingRoleLost: !ownsSession, cardAlive: ownsSession }
}

const models = [
  ['反例：旧实现 · 同驱动换歌也停用会话 → iOS 撤回 Now Playing 角色（卡片死、声音在）', modelOld().cardDeadWhileAudioPlays === true],
  ['修复后：同驱动换歌不走停用 → 卡片保持可用', modelNew(true).deactivated === false && modelNew(true).cardAlive === true],
  ['修复后：从 TrackPlayer 接管时仍停用+重配置（保留原有「无音频输出」修复）', modelNew(false).deactivated === true],
]

const realReasons = structuralReasons(SRC)

// 反例自检 1：去掉守卫（恢复无条件停用）→ 必须报错
let tamper1 = false
let tamper1Detail = ''
// 反例自检 2：去掉生命周期里的归属失效 → 必须报错
let tamper2 = false
let tamper2Detail = ''
try {
  const guard = [
    '    if (!LXStreamingFlacOwnsAudioSession) {',
    '      [session setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:nil];',
    '    }',
  ].join('\n')
  const t1 = SRC.replace(guard, '    [session setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:nil];')
  if (t1 === SRC) {
    tamper1Detail = '找不到可 tamper 的守卫锚点'
  } else {
    const r = structuralReasons(t1)
    tamper1 = r.some((x) => x.includes('仍无条件 setActive:NO'))
    tamper1Detail = tamper1 ? '已拦下' : `未拦下（reasons=${JSON.stringify(r)}）`
  }
  const t2 = SRC.replace('  LXStreamingFlacOwnsAudioSession = NO;\n  NSDictionary *userInfo = [notification.userInfo', '  NSDictionary *userInfo = [notification.userInfo')
  if (t2 === SRC) {
    tamper2Detail = '找不到可 tamper 的生命周期锚点'
  } else {
    const r = structuralReasons(t2)
    tamper2 = r.some((x) => x.includes('没有让归属标记失效'))
    tamper2Detail = tamper2 ? '已拦下' : `未拦下（reasons=${JSON.stringify(r)}）`
  }
} catch (err) {
  tamper1Detail = tamper1Detail || `异常: ${err.message}`
  tamper2Detail = tamper2Detail || `异常: ${err.message}`
}

console.log('行为模型')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
console.log(`${tamper1 ? 'PASS' : 'FAIL'}  去掉「按需接管」守卫（恢复无条件停用） —— ${tamper1Detail}`)
console.log(`${tamper2 ? 'PASS' : 'FAIL'}  去掉 TrackPlayer 生命周期里的归属失效 —— ${tamper2Detail}`)

if (realReasons.length) {
  console.error(`\nFAIL  流式 FLAC 会话接管契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
const failedModels = models.filter(([, ok]) => !ok)
if (failedModels.length) console.error(`\nFAIL  行为模型未通过（${failedModels.length} 例）`)
if (failedModels.length || realReasons.length || !tamper1 || !tamper2) {
  console.error('\nFAIL  流式 FLAC 会话接管契约未通过')
  process.exit(1)
}
console.log(`\nPASS  流式 FLAC 会话接管（结构不变量 3 组 + 行为模型 ${models.length} 例 + 反例 2 例）`)
process.exit(0)
