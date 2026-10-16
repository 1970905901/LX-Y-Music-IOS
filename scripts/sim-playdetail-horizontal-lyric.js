/**
 * sim-playdetail-horizontal-lyric.js
 *
 * 「横屏歌词滚动与竖屏同一套策略（单一 writer）」契约。
 *
 * 用户反馈：iPad 横屏播放时歌词滚动不正常，竖屏正常。
 * 根因：横屏歌词的「非 force 定位」走 `utils/scroll` 的 JS 逐帧动画（setTimeout 5ms 一步、
 * 持续 120~300ms，每步 `scrollToOffset({animated:false})`），而同一时刻「每帧连续滚动循环」
 * 也在按目标行写 `scrollToOffset` —— 两套 writer 互不知情，位移在两条轨迹间来回跳，
 * 表现为滚动打顿/抖动/被拽回旧位置；竖屏用的是原生 `animated` 滚动 + 舒适区守卫（同一行且
 * 离目标 < 15% 视高就不滚），所以只有横屏复现。
 *
 * 契约守护：
 *   1) 单一 writer：横屏歌词不得再引 `@/utils/scroll` 的 scrollTo（该工具已随之删成死代码，
 *      文件本身也必须保持不存在，避免又被引回来）；
 *   2) 非 force 走原生 `animated: true`（后续写偏移会自然接管），force 走 `animated: false` 硬跳；
 *   3) 舒适区守卫与竖屏同源：`lastScrolledLineRef` + `listHeight * 0.15`；
 *   4) 几何自洽：留白（paddingV）与 contentContainerStyle 的 paddingTop/Bottom 必须同源
 *      （横屏用 FlatList 自身高度，竖屏用页面高度，各自一处来源）；
 *   5) played（bold）档不再使用：横屏行布局已与播放态解耦，累计偏移与竖屏同一基准。
 *
 * 运行：node scripts/sim-playdetail-horizontal-lyric.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  horizontal: 'src/screens/PlayDetail/Horizontal/Lyric.tsx',
  vertical: 'src/screens/PlayDetail/Vertical/Lyric.tsx',
  legacyScrollUtil: 'src/utils/scroll.ts',
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const exists = (rel) => fs.existsSync(path.join(ROOT, rel))

/** 取出文件里所有 getTargetOffsetPrecise(...) 调用的参数个数（用于确认不再传第 8 个 usePlayed） */
const preciseArgCounts = (src) =>
  [...src.matchAll(/getTargetOffsetPrecise\(([^)]*)\)/g)].map((m) => m[1].split(',').length)

const checkAll = ({ horizontal, vertical, legacyExists }) => {
  const violations = []
  const list = (rule, where, detail) => violations.push({ rule, where, detail })

  // 1) 单一 writer
  if (legacyExists) {
    list('single-writer', FILES.legacyScrollUtil, 'JS 逐帧滚动动画工具又出现了（会与每帧连续滚动循环抢同一个列表）')
  }
  if (horizontal.includes("from '@/utils/scroll'")) {
    list('single-writer', FILES.horizontal, '横屏歌词又引入了 @/utils/scroll（两套 writer 打架的根源）')
  }
  if (/(?<!Offset)scrollTo\(/.test(horizontal)) {
    list('single-writer', FILES.horizontal, '横屏歌词又调用 scrollTo(...)（JS 逐帧动画），只用 scrollToOffset')
  }

  // 2) 原生 animated 滚动 + force 硬跳
  if (!/scrollToOffset\(\{ offset: targetOffset, animated: true \}\)/.test(horizontal)) {
    list('native-scroll', FILES.horizontal, '非 force 定位没有走原生 animated 滚动')
  }
  if (!/scrollToOffset\(\{ offset: targetOffset, animated: false \}\)/.test(horizontal)) {
    list('native-scroll', FILES.horizontal, 'force 定位没有走 animated:false 硬跳')
  }

  // 3) 舒适区守卫（横屏必须有；竖屏同源用作对照）
  if (!/const lineChanged = index !== lastScrolledLineRef\.current/.test(horizontal)) {
    list('comfort-zone', FILES.horizontal, '缺少 lineChanged 判定（同一行会被反复重定位）')
  }
  if (!/Math\.abs\(targetOffset - currentOffset\) < listHeight \* 0\.15/.test(horizontal)) {
    list('comfort-zone', FILES.horizontal, '缺少「离目标 < 15% 视高就跳过」的舒适区守卫')
  }
  if (!/listHeight \* 0\.15/.test(vertical)) {
    list('comfort-zone', FILES.vertical, '竖屏（对照实现）的舒适区守卫不见了，两端策略不再同源')
  }

  // 4) 几何自洽：留白与 contentContainerStyle 同源
  const horizontalListHeight = (horizontal.match(/listHeight \* 0\.5/g) || []).length
  if (horizontalListHeight < 4) {
    list('geometry', FILES.horizontal, `留白与滚动基准必须同源（listHeight*0.5 至少 4 处：contentContainer 上下 + 两处 paddingV，实为 ${horizontalListHeight}）`)
  }
  if (!/paddingTop: listHeight \* 0\.5/.test(horizontal) || !/paddingBottom: listHeight \* 0\.5/.test(horizontal)) {
    list('geometry', FILES.horizontal, 'contentContainerStyle 的上下留白不再等于 listHeight*0.5')
  }
  const verticalPageHeight = (vertical.match(/pageHeight[^\n]*\* 0\.5/g) || []).length
  if (verticalPageHeight < 3) {
    list('geometry', FILES.vertical, `竖屏留白必须与页面高度同源（pageHeight*0.5 至少 3 处，实为 ${verticalPageHeight}）`)
  }

  // 5) played 档不再使用（横屏应只传 7 个参数）
  for (const n of preciseArgCounts(horizontal)) {
    if (n > 7) {
      list('played-bucket', FILES.horizontal, `getTargetOffsetPrecise 又传了第 8 个参数（usePlayed，实为 ${n} 个参数）`)
    }
  }
  return violations
}

// --- 行为模型：两套 writer 交替写同一列表 → 位移出现反向跳变；改单 writer 后单调收敛 ---
// JS 动画起点取的是「上一帧滚动事件」里的偏移（scrollInfoRef），连续滚动循环的跟随值
// （smoothOffsetRef）是它自己维护的另一个数：两者本来就可能差一截，于是写出的位移
// 在两条轨迹之间来回跳。
const animTrajectory = (target, from, durationMs = 300) =>
  Array.from({ length: Math.floor(durationMs / 5) + 1 }, (_, i) => ({ t: i * 5, v: from + (target - from) * ((i * 5) / durationMs) }))
const loopTrajectory = (target, from, durationMs = 300) => {
  const k = 1 - Math.exp(-0.016 * 12) // SMOOTH_RATE_NORMAL = 12/s，16ms 一帧
  let v = from
  const out = []
  for (let t = 0; t <= durationMs; t += 16) { v += (target - v) * k; out.push({ t, v }) }
  return out
}
const mergeWrites = (...lists) => lists.flat().sort((a, b) => a.t - b.t)
const stats = (writes) => {
  let jitter = 0
  let reversals = 0
  let prev = writes[0].v
  for (const w of writes.slice(1)) {
    const d = w.v - prev
    jitter += Math.abs(d)
    if (d < -1e-9) reversals++
    prev = w.v
  }
  return { jitter, reversals }
}
const both = stats(mergeWrites(animTrajectory(120, 90), loopTrajectory(120, 100)))
const single = stats(loopTrajectory(120, 100))

const comfortZone = ({ lineChanged, distanceRatio }) =>
  !lineChanged && distanceRatio < 0.15 ? 'skip' : 'scroll'

const models = [
  ['修复前：JS 动画 + 每帧循环两套 writer 交替写偏移 → 位移出现反向跳变（来回抖）',
    both.reversals > 0],
  ['修复后：只剩每帧连续滚动循环一个 writer → 位移单调收敛、无反向跳变，抖动总量下降',
    single.reversals === 0 && single.jitter < both.jitter],
  ['舒适区守卫：同一行且位移 < 15% 视高不滚；换行或位移够大才滚',
    comfortZone({ lineChanged: false, distanceRatio: 0.1 }) === 'skip' &&
    comfortZone({ lineChanged: false, distanceRatio: 0.2 }) === 'scroll' &&
    comfortZone({ lineChanged: true, distanceRatio: 0 }) === 'scroll'],
]

const REAL = {
  horizontal: read(FILES.horizontal),
  vertical: read(FILES.vertical),
  legacyExists: exists(FILES.legacyScrollUtil),
}

const counterExamples = []
const expectCaught = (name, expectRule, mutate) => {
  let rules
  try {
    rules = checkAll({ ...REAL, ...mutate({ ...REAL }) }).map((v) => v.rule)
  } catch (err) {
    counterExamples.push([name, false, `变异执行失败：${err.message}`])
    return
  }
  const hit = rules.includes(expectRule)
  counterExamples.push([name, hit, hit ? `已拦下（${expectRule}）` : `未拦下（rules=${JSON.stringify(rules)}）`])
}

expectCaught('C1 横屏又用 scrollTo 逐帧动画', 'single-writer', (v) => ({
  horizontal: v.horizontal.replace('const lineChanged =', 'scrollTo(null, null, 0)\n      const lineChanged ='),
}))
expectCaught('C2 死工具 utils/scroll.ts 回归', 'single-writer', () => ({ legacyExists: true }))
expectCaught('C3 非 force 改成 JS 动画（拿掉原生 animated）', 'native-scroll', (v) => ({
  horizontal: v.horizontal.replace('scrollToOffset({ offset: targetOffset, animated: true })', 'scrollToOffset({ offset: targetOffset, animated: false })'),
}))
expectCaught('C4 删掉舒适区守卫', 'comfort-zone', (v) => ({
  horizontal: v.horizontal.replace('if (!lineChanged && Math.abs(targetOffset - currentOffset) < listHeight * 0.15) return', 'if (false) return'),
}))
expectCaught('C5 contentContainerStyle 留白与计算脱节', 'geometry', (v) => ({
  horizontal: v.horizontal.replace('paddingTop: listHeight * 0.5', 'paddingTop: listHeight * 0.42'),
}))
expectCaught('C6 又传第 8 个参数 usePlayed', 'played-bucket', (v) => ({
  horizontal: v.horizontal.replace('lyricLines, 0.5, paddingV, 0, true)', 'lyricLines, 0.5, paddingV, 0, true, true)'),
}))
expectCaught('C7 竖屏（对照实现）的舒适区守卫被删', 'comfort-zone', (v) => ({
  vertical: v.vertical.replace('listHeight * 0.15', 'listHeight * 0.5'),
}))

const violations = checkAll(REAL)
const failedModels = models.filter(([, ok]) => !ok)
const missed = counterExamples.filter(([, ok]) => !ok)

console.log('行为模型')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of counterExamples) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')

for (const v of violations) console.error(`FAIL  [${v.rule}] ${v.where} —— ${v.detail}`)
if (violations.length || failedModels.length || missed.length) {
  console.error('')
  console.error(`FAIL  横屏歌词滚动契约未通过：违例 ${violations.length} 项、模型失败 ${failedModels.length} 例、反例漏检 ${missed.length} 例`)
  process.exit(1)
}
console.log(`PASS  横屏歌词与竖屏同一套滚动策略（单一 writer + 原生滚动 + 舒适区守卫 + 留白同源）（规则 5 组 + 行为模型 ${models.length} 例 + 反例 ${counterExamples.length} 例）`)
process.exit(0)
