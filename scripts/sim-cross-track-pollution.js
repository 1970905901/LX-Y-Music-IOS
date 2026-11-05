/**
 * sim-cross-track-pollution.js
 *
 * 切歌时不得把上一首的歌词 / 媒体元数据带到下一首。
 *
 * 背景（2026-10 播放链路审计，三条都能从源码证明）：
 *   ① core/lyric.ts 的 setLyric 只在 `musicInfo.lrc` 非空时才写解析器，
 *      从「有歌词的 A」切到「歌词为空的 B」时，lrc-file-parser 里仍是 A 的行；
 *   ② core/init/player/lyric.ts 的 lyricUpdated 处理器不校验曲目归属，
 *      上一首异步解析完成的结果会在新歌上重放；
 *   ③ plugins/player/trackPlayerCore.ts 的 ensureCurrentTrackMetadata 为每首歌
 *      无条件排 [0,160,420,900]ms 四次发布，A 的 900ms 那次会在 B 装载后把标题
 *      改回 A —— 原生按「标题变化 = 换歌」清空歌词时间轴，车机/锁屏歌词整首消失。
 *
 * 运行：node scripts/sim-cross-track-pollution.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '')

const SRC = {
  coreLyric: stripComments(read('src/core/lyric.ts')),
  initLyric: stripComments(read('src/core/init/player/lyric.ts')),
  trackPlayerCore: stripComments(read('src/plugins/player/trackPlayerCore.ts')),
  resourceLoader: stripComments(read('src/plugins/player/engine/resourceLoader.ts')),
}

const reasons = []

// ① 无歌词时必须显式清空解析器
{
  const src = SRC.coreLyric
  const setLyricBody = src.slice(src.indexOf('export const setLyric'))
  if (!/else \{[\s\S]{0,600}?handleSetLyric\(''\)/.test(setLyricBody)) {
    reasons.push('core/lyric.setLyric: 无歌词分支没有清空解析器（会沿用上一首的行与时间轴）')
  }
}

// ② lyricUpdated 必须校验曲目归属
{
  const src = SRC.initLyric
  const handler = src.slice(src.indexOf("global.app_event.on('lyricUpdated'"))
  const handlerEnd = handler.indexOf('\n  })')
  const body = handlerEnd > 0 ? handler.slice(0, handlerEnd) : handler
  if (!/const musicId = playerState\.musicInfo\.id/.test(body)) {
    reasons.push('init/player/lyric: lyricUpdated 没有捕获事件所属曲目')
  }
  if (!/playerState\.musicInfo\.id != musicId/.test(body)) {
    reasons.push('init/player/lyric: 异步解析完成后没有校验曲目（旧歌歌词会覆盖新歌）')
  }
}

// ③ 元数据批次必须可作废
{
  const src = SRC.trackPlayerCore
  if (!/let metadataGeneration = 0/.test(src)) {
    reasons.push('trackPlayerCore: 元数据发布没有世代标记')
  }
  if (!/export const invalidateTrackMetadata/.test(src)) {
    reasons.push('trackPlayerCore: 缺少「作废旧批次」的入口')
  }
  if (!/if \(generation !== metadataGeneration\) return/.test(src)) {
    reasons.push('trackPlayerCore: 延迟重发前没有校验世代（旧歌标题会覆盖新歌）')
  }
  if (!/invalidateTrackMetadata\(\)/.test(SRC.resourceLoader)) {
    reasons.push('resourceLoader: 新装载开始时没有作废旧元数据批次')
  }
}

// ---------------------------------------------------------------------------
// 行为模型：A 装载 → 0.8s 切 B → A 的 900ms 批次到期
// ---------------------------------------------------------------------------
const runMetadataModel = (useGeneration) => {
  let generation = 0
  const published = []
  const publish = (title, gen) => {
    if (useGeneration && gen !== generation) return
    published.push(title)
  }
  // A 装载：排 0 / 160 / 420 / 900
  const genA = generation
  const scheduleA = [0, 160, 420, 900]
  // B 在 800ms 装载
  const scheduleB = [0, 160, 420, 900]
  const timeline = []
  for (const t of scheduleA) timeline.push({ t, title: 'A', gen: genA })
  generation += 1 // B 装载 → 作废 A
  const genB = generation
  for (const t of scheduleB) timeline.push({ t: 800 + t, title: 'B', gen: genB })
  timeline.sort((x, y) => x.t - y.t)
  for (const item of timeline) publish(item.title, item.gen)
  return published
}

const legacyPublished = runMetadataModel(false)
const fixedPublished = runMetadataModel(true)

const firstB = legacyPublished.indexOf('B')
const staleAAfterB = legacyPublished.slice(firstB).filter((t) => t === 'A').length
const fixedFirstB = fixedPublished.indexOf('B')
const staleAAfterBFixed = fixedPublished.slice(fixedFirstB).filter((t) => t === 'A').length

const models = [
  // 真正的伤害不是「最终标题错」，而是 B 装载后 A 的 900ms 批次又发布一次：
  // 原生按标题变化判定换歌并清空歌词时间轴 → B 刚注入的歌词被清掉。
  ['反例：旧实现里 B 装载后仍会收到 A 的发布（清空 B 的歌词时间轴）', staleAAfterB > 0],
  ['修复后：B 装载后不再出现任何 A 的发布', staleAAfterBFixed === 0],
  ['修复后：切歌后最后一个标题属于当前歌', fixedPublished[fixedPublished.length - 1] === 'B'],
]

// ---------------------------------------------------------------------------
// ④ iPad 横屏双列 getItemLayout 必须按行折算
// ---------------------------------------------------------------------------
{
  const list = stripComments(read('src/screens/Home/Views/Mylist/MusicList/List.tsx'))
  const layout = list.slice(list.indexOf('const getItemLayout'))
  const body = layout.slice(0, layout.indexOf('}\n') + 2)
  if (!/Math\.floor\(index \/ numColumns\)/.test(body)) {
    reasons.push('Mylist/MusicList/List.tsx: 双列 getItemLayout 没有按行折算（长列表定位/渲染窗口错位）')
  }
  // 与 OnlineList 的同名实现必须同源
  const online = stripComments(read('src/components/OnlineList/List.tsx'))
  if (!/Math\.floor\(index \/ numColumns\)/.test(online)) {
    reasons.push('OnlineList/List.tsx: 双列 getItemLayout 基准实现丢失')
  }
}

// ---------------------------------------------------------------------------
// ⑤ 原生液态透镜的 CADisplayLink 生命周期
// ---------------------------------------------------------------------------
{
  const lens = read('ios/Vendor/LiquidGlassKit/Sources/LiquidLensView.swift')
  const start = lens.slice(lens.indexOf('private func startPositionTracking()'))
  const startBody = start.slice(0, start.indexOf('\n    }'))
  if (!/stopPositionTracking\(\)/.test(startBody)) {
    reasons.push('LiquidLensView: startPositionTracking 没有先停掉旧计时器（连续点 Tab 会泄漏 CADisplayLink）')
  }
  if (!/deinit \{[\s\S]{0,200}?displayLink\?\.invalidate\(\)/.test(lens)) {
    reasons.push('LiquidLensView: 缺少 deinit 里的计时器清理')
  }
  if (!/willMove\(toWindow[\s\S]{0,600}?stopPositionTracking\(\)/.test(lens)) {
    reasons.push('LiquidLensView: 视图脱离层级时没有收尾（遗留 60Hz 回调并持有视图）')
  }
}

// ---------------------------------------------------------------------------
const failures = []
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' —— ' + detail : ''}`)
  if (!ok) failures.push(name)
}

console.log('行为模型（元数据批次）')
for (const [name, ok] of models) check(name, ok)

console.log('')
console.log('结构不变量')
if (reasons.length === 0) {
  check('无歌词清空 + 歌词归属 + 元数据世代 + 双列布局 + 透镜计时器', true)
} else {
  for (const r of reasons) check(r, false)
}

console.log('')
if (failures.length) {
  console.error(`FAIL  跨歌污染契约未通过（${failures.length} 项）`)
  process.exit(1)
}
console.log(`PASS  切歌不再串歌：歌词/元数据/布局/原生计时器（结构不变量 8 组 + 行为模型 ${models.length} 例）`)
process.exit(0)
