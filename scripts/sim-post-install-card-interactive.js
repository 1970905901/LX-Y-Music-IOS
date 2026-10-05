/**
 * sim-post-install-card-interactive.js
 *
 * 「装完 App 后卡片必须立刻可交互」契约（2026-10-05 真机反馈）。
 *
 * 现象：刚装完 App（还没播放过），控制中心 / 灵动岛的按钮与进度条**全部失效**；
 * 播过一次之后自愈。
 *
 * 真机日志（2026-10-05 16:40–16:42，单 PID 无崩溃）证明投递链是健康的：
 * 33 条 recv= / 33 条 deliver= / enabled 全 1 / infoCount=8 / nowPlayingState 跟随
 * 用户操作在 1(playing)↔2(paused) 之间正确变化 —— 也就是说「命令没到 App」「JS 没注册
 * 监听」「卡片信息被清空」三条都被排除。
 *
 * 根因：装完后 JS 会恢复上一首歌并只发布**元数据**（title/封面），而播放态从未发布过，
 * LXNowPlayingState 还是初始的 MPNowPlayingPlaybackStateStopped；LXApplyNowPlayingInfo
 * 把这个 stopped 一起写给系统 → 系统拿到的是一张「未在播放」卡片：
 *   · 遥控命令不再投递给 App（按了没反应）；
 *   · 进度条不可拖动 / 不前进。
 * 播放过一次后状态发布为 playing，卡片才恢复交互 —— 与用户观察到的「播一次就好了」一致。
 *
 * 修法：有曲目上下文（cache 非空）时不要把 stopped 写给系统，按 paused + 速率 0 发布，
 * 卡片保持可交互（按播放键即续播）；真正没有曲目（cache 空）时才写 stopped 交还会话。
 *
 * 运行：node scripts/sim-post-install-card-interactive.js
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

  const applyFn = windowBetween(src, 'static void LXApplyNowPlayingInfo(void) {', 'static void LXBeginReceivingRemoteControlEvents', 2500)
  if (!applyFn) {
    reasons.push('找不到 LXApplyNowPlayingInfo（卡片发布入口）')
  } else {
    if (/center\.playbackState = LXNowPlayingState;/.test(applyFn)) {
      reasons.push('仍把内部播放态直写系统：装完未播放时（内部态=stopped）会得到不可交互的死卡')
    }
    if (!/MPNowPlayingPlaybackState publishState = LXResolveNowPlayingPublishStateLocked\(\);/.test(applyFn)) {
      reasons.push('发布态没有经过 LXResolveNowPlayingPublishStateLocked 解析')
    }
    if (!/center\.playbackState = publishState;/.test(applyFn)) {
      reasons.push('解析出的发布态没有真正写给系统')
    }
  }

  const resolver = windowBetween(src, 'static MPNowPlayingPlaybackState LXResolveNowPlayingPublishStateLocked(void) {', 'static void LXApplyNowPlayingInfo(void) {', 1200)
  if (!resolver) {
    reasons.push('找不到 LXResolveNowPlayingPublishStateLocked（有曲目时不得发布 stopped）')
  } else {
    if (!/LXNowPlayingState != MPNowPlayingPlaybackStateStopped \|\| LXNowPlayingInfoCache\.count == 0\) return LXNowPlayingState;/.test(resolver)) {
      reasons.push('解析条件不对：只应在「内部态 stopped 且 cache 非空」时改写发布态')
    }
    if (!/MPNowPlayingInfoPropertyPlaybackRate\] = @0;/.test(resolver)) {
      reasons.push('按 paused 发布时没有把速率写 0（系统会继续按旧速率外推进度条）')
    }
    if (!/return MPNowPlayingPlaybackStatePaused;/.test(resolver)) {
      reasons.push('没有改成 paused 发布（卡片仍不可交互）')
    }
  }

  if (!/###LXRemote### recv=seek/.test(src)) {
    reasons.push('进度条拖动（seek）没有 recv= 打点：真机日志只有 deliver=seek，无法定位进度条问题')
  }
  if (!/###LXNowPlaying### publish state=/.test(src)) {
    reasons.push('发布态变化没有打点（装完首次启动无法归因）')
  }
  if (!/###LXNowPlaying### clear /.test(src)) {
    reasons.push('清卡片没有打点（会话结束原因无法归因）')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：发布态解析（旧=直写内部态；新=有曲目时 stopped 降级为 paused）
// ---------------------------------------------------------------------------
const oldResolve = (state, hasItem) => ({ publish: state, rate: hasItem ? 1 : 1 })
const newResolve = (state, hasItem) => {
  if (state !== 'stopped' || !hasItem) return { publish: state, rate: 1 }
  return { publish: 'paused', rate: 0 }
}

const models = [
  ['播放中 → 原样发布 playing（可交互卡片）', JSON.stringify(newResolve('playing', true)) === JSON.stringify({ publish: 'playing', rate: 1 })],
  ['暂停中 → 原样发布 paused', JSON.stringify(newResolve('paused', true)) === JSON.stringify({ publish: 'paused', rate: 1 })],
  ['已停止但有曲目（装完首次启动）→ 发布 paused + 速率 0', JSON.stringify(newResolve('stopped', true)) === JSON.stringify({ publish: 'paused', rate: 0 })],
  ['已停止且无曲目 → 仍发布 stopped（交还会话）', JSON.stringify(newResolve('stopped', false)) === JSON.stringify({ publish: 'stopped', rate: 1 })],
  ['反例：旧实现把 stopped 直写系统 → 死卡', JSON.stringify(oldResolve('stopped', true)) === JSON.stringify({ publish: 'stopped', rate: 1 })],
]

const realReasons = structuralReasons(SRC)

// 反例自检：把发布改回「直写内部态」，结构不变量必须报错（证明契约有区分力）
let tamperCaught = false
let tamperDetail = ''
try {
  const tampered = SRC.replace('center.playbackState = publishState;', 'center.playbackState = LXNowPlayingState;')
  if (tampered === SRC) {
    tamperDetail = '找不到可 tamper 的锚点（center.playbackState = publishState;）'
  } else {
    const reasons = structuralReasons(tampered)
    tamperCaught = reasons.some((r) => r.includes('直写系统'))
    tamperDetail = tamperCaught ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）`
  }
} catch (err) {
  tamperDetail = `异常: ${err.message}`
}

console.log('行为模型')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
console.log(`${tamperCaught ? 'PASS' : 'FAIL'}  把发布态改回直写内部态 —— ${tamperDetail}`)

if (realReasons.length) {
  console.error(`\nFAIL  装完即用卡片契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
const failedModels = models.filter(([, ok]) => !ok)
if (failedModels.length) console.error(`\nFAIL  行为模型未通过（${failedModels.length} 例）`)
if (failedModels.length || realReasons.length || !tamperCaught) {
  console.error('\nFAIL  装完 App 后卡片可交互契约未通过')
  process.exit(1)
}
console.log(`\nPASS  装完 App 后卡片可交互（结构不变量 6 项 + 行为模型 ${models.length} 例 + 反例 1 例）`)
process.exit(0)
