/**
 * sim-artwork-flip-restore.js
 *
 * 「封面重绘翻转必须自己还原，不得留下假播放态」契约（2026-10-05 真机根因）。
 *
 * 现象（用户真机复现）：打开软件 → 导入音源 → 播放；控制中心 / 灵动岛的按钮与进度条失效，
 * 但**音乐在正常播放、App 内进度条在走**（用户确认）。重启软件后再播放就一切正常。
 *
 * 机制：`LXApplyNowPlayingArtwork` 为了强制系统重绘封面，会把 `playbackState` 切到相反值，
 * 80ms 后切回。旧实现里这段「切回」带了一道 `if (requestId != LXNowPlayingArtworkRequestId) return;`
 * ——封面请求一旦换代（换歌 / 首次播放时封面异步就绪最频繁），还原被直接打断，卡片就**永久停在
 * 相反的播放态**：按钮方向反或按了变成空操作、进度条停走，直到下一次 LXApplyNowPlayingInfo
 * 才恢复（无歌词/稀疏歌时可能很久不恢复）。
 *
 * 修法：已经翻转之后，还原必须**无条件执行**；requestId 换代只说明有新封面任务接手，
 * 假状态仍须由本次翻转自己还原，并打一行 ###LXNowPlaying### artworkFlip superseded 便于归因。
 *
 * 运行：node scripts/sim-artwork-flip-restore.js
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
  const flipFn = windowBetween(src, 'static void LXApplyNowPlayingArtwork(UIImage *image, NSUInteger requestId) {', 'static void LXSetNowPlayingArtwork(NSString *artworkPath) {', 4000)
  if (!flipFn) {
    reasons.push('找不到 LXApplyNowPlayingArtwork（封面重绘翻转实现）')
    return reasons
  }

  const flipIdx = flipFn.indexOf('center.playbackState = opposite;')
  const restoreIdx = flipFn.indexOf('center.playbackState = current;')
  if (flipIdx < 0 || restoreIdx < 0 || restoreIdx < flipIdx) {
    reasons.push('封面翻转没有「切反再切回」两半（无法确认还原路径）')
    return reasons
  }

  const beforeFlip = flipFn.slice(0, flipIdx)
  if (!/if \(requestId != LXNowPlayingArtworkRequestId\) return;/.test(beforeFlip)) {
    reasons.push('翻转前没有校验收到的封面是否已过期（可能把旧封面写进卡片）')
  }

  const between = flipFn.slice(flipIdx, restoreIdx)
  if (/if \(requestId != LXNowPlayingArtworkRequestId\) return;/.test(between)) {
    reasons.push('翻转后仍按 requestId 提前 return：封面换代时卡片会永久停在假播放态（按钮方向反、进度条停走）')
  }
  if (!/BOOL superseded = requestId != LXNowPlayingArtworkRequestId;/.test(between)) {
    reasons.push('缺少 superseded 判定（无法在日志里区分「正常还原」与「带病还原」）')
  }
  if (!/###LXNowPlaying### artworkFlip superseded/.test(between)) {
    reasons.push('封面换代时没有打点（真机无法归因这类死卡）')
  }
  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：翻转期间封面换代，卡片显示态是否会留在「假状态」
// ---------------------------------------------------------------------------
const oldRestore = ({ superseded }) => {
  // 旧实现：先判 requestId，换代即跳过还原
  if (superseded) return { displayed: 'paused', real: 'playing', dead: true }
  return { displayed: 'playing', real: 'playing', dead: false }
}
// 新实现：已经翻转就无条件还原（与封面请求是否换代无关）
const newRestore = () => ({ displayed: 'playing', real: 'playing', dead: false })

const contexts = [
  ['正在播放 + 封面换代（换歌/首播最常见）', { real: 'playing', superseded: true }],
  ['正在播放 + 封面未换代', { real: 'playing', superseded: false }],
]

const models = []
for (const [name, ctx] of contexts) {
  const oldR = oldRestore(ctx)
  const newR = newRestore()
  models.push(ctx.superseded
    ? [`反例：旧实现 · ${name} → 卡片永久停在假状态（按钮方向反 / 进度条停走）`, oldR.dead === true]
    : [`对照：旧实现 · ${name} → 正常还原`, oldR.dead === false])
  models.push([`修复后：${name} → 卡片回到真实播放态`, newR.displayed === ctx.real && !newR.dead])
}

const realReasons = structuralReasons(SRC)

// 反例自检：把 requestId 守卫塞回「切回」之前，结构不变量必须报错
let tamperCaught = false
let tamperDetail = ''
try {
  const anchor = '          BOOL superseded = requestId != LXNowPlayingArtworkRequestId;'
  const tampered = SRC.replace(anchor, '          if (requestId != LXNowPlayingArtworkRequestId) return;\n' + anchor)
  if (tampered === SRC) {
    tamperDetail = '找不到可 tamper 的锚点（BOOL superseded = ...）'
  } else {
    const reasons = structuralReasons(tampered)
    tamperCaught = reasons.some((r) => r.includes('永久停在假播放态'))
    tamperDetail = tamperCaught ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）`
  }
} catch (err) {
  tamperDetail = `异常: ${err.message}`
}

console.log('行为模型')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
console.log(`${tamperCaught ? 'PASS' : 'FAIL'}  把 requestId 守卫塞回还原路径 —— ${tamperDetail}`)

if (realReasons.length) {
  console.error(`\nFAIL  封面翻转还原契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
const failedModels = models.filter(([, ok]) => !ok)
if (failedModels.length) console.error(`\nFAIL  行为模型未通过（${failedModels.length} 例）`)
if (failedModels.length || realReasons.length || !tamperCaught) {
  console.error('\nFAIL  封面重绘翻转过还原契约未通过')
  process.exit(1)
}
console.log(`\nPASS  封面重绘翻转必须还原（结构不变量 4 项 + 行为模型 ${models.length} 例 + 反例 1 例）`)
process.exit(0)
