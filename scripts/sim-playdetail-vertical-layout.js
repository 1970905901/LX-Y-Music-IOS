/**
 * 竖屏播放页（PlayDetail/Vertical/VerticalNew.tsx）封面页纵向布局模拟。
 *
 * 目标：量化「给 picPageContainerNew 加 paddingBottom」对
 * 「封面 ↔ 歌曲信息块」中缝的影响，并校验新版（迷你歌词 3 行 + 字号放大）
 * 在小屏/大屏下都不溢出容器高度。
 *
 * 布局规则（与 RN 一致）：
 *   picPageContainerNew: flex:1, flexDirection:column, justifyContent:space-between
 *   ├─ picContainer      (flexShrink:0) 高度 = 封面 size + 少量居中留白
 *   └─ infoContainer     (flexShrink:0) 高度 = marginTop + SongInfo + MiniLyric
 *   contentHeight = picH + infoH
 *   free = containerH - paddingTop - paddingBottom - contentHeight
 *   space-between 把 free 全部放到中缝 → 中缝 = free
 *   若 free < 0 则溢出（信息块被推出容器底部，小屏需避免）
 *
 * 运行：node scripts/sim-playdetail-vertical-layout.js
 */

// ---- 基准数据：从用户截图（1170x2532 px = 390x844 pt @3x）实测 ----
const SHOT = {
  device: 'iPhone 12/13/14 (390x844pt)',
  statusBarHeight: 53, // useStatusbarHeight() = state.statusbarHeight + 6
  headerHeight: 42, // HEADER_HEIGHT（scaleSizeH(42)）
  measured: {
    cover: [106, 252], // 封面可见区间
    infoBlock: [415, 560], // 用户红框 = SongInfo（歌名/歌手/专辑）
    miniLyric: [575, 587], // 迷你歌词单行「词：季忠平/许常德」
    featureBtns: [629, 654], // 功能按钮（下载/评论/…）
  },
}

// pagerView 高度由截图反推（用旧版布局做回归校准）：
// 旧版内容高 = 封面 146 + (SongInfo marginTop 20 + content 155) + 单行歌词 37 = 358pt，
// 截图实测红框(SongInfo 内容)上边 415pt、封面底 252pt → 中缝 = 415 - 20 - 252 = 143pt，
// 故 pagerView 高 ≈ paddingTop(10) + 358 + 143 = 511pt。
const PAGER_H_FROM_SHOT = 511
const PLAYER_H_FROM_SHOT = 844 - SHOT.statusBarHeight - SHOT.headerHeight - PAGER_H_FROM_SHOT

// ---- 组件高度模型 ----
const SONGINFO = {
  marginTop: 20,
  // 歌名(28) + 间距8 + 徽章 + 歌手(16) + 间距4 + 专辑(14) + marginBottom 10，
  // 由截图反推（红框可见高 145 + marginBottom ≈ 155）。
  content: 155,
}
// 迷你歌词：3 行歌词（上16 / 当前20 / 下16）+ 可选翻译行(15) + paddingVertical
const miniLyricHeight = ({ lines, hasTranslation, paddingV, fontSize }) => {
  const lineHeights = { 13: 17, 15: 20, 16: 21, 17: 22, 20: 26 }
  let h = paddingV * 2
  const layout = lines === 3 ? [fontSize.neighbor, fontSize.current, fontSize.neighbor] : [fontSize.current]
  for (const s of layout) h += lineHeights[s]
  if (hasTranslation) h += lineHeights[15] + 2 // + marginTop
  return h
}

const calc = ({ screenH, statusBarH = SHOT.statusBarHeight, playerH, paddingBottom, miniLyric, isSmallWindow, coverH = 146 }) => {
  const headerH = SHOT.headerHeight
  const containerH = screenH - statusBarH - headerH - playerH
  const paddingTop = 10 // containerPaddingH = scaleSizeW(10)
  const infoH = SONGINFO.marginTop + SONGINFO.content + (isSmallWindow ? 12 : 0) + miniLyric
  const contentH = coverH + infoH
  const free = containerH - paddingTop - paddingBottom - contentH
  const top = statusBarH + headerH
  return {
    containerH, coverH, infoH, contentH, free,
    coverTop: top + paddingTop,
    coverBottom: top + paddingTop + coverH,
    gap: free, // space-between 下 = 封面与信息块之间的中缝
    infoTop: top + paddingTop + coverH + free,
    infoBottom: top + paddingTop + coverH + free + infoH,
    containerBottom: top + containerH,
    overflow: free < 0,
  }
}

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

console.log('='.repeat(78))
console.log('基准校验：旧版（迷你歌词 1 行、无 paddingBottom）能否复现截图实测位置')
console.log('='.repeat(78))
{
  const oldMini = miniLyricHeight({ lines: 1, hasTranslation: false, paddingV: 10, fontSize: { current: 13, neighbor: 13 } })
  const r = calc({ screenH: 844, playerH: PLAYER_H_FROM_SHOT, paddingBottom: 0, miniLyric: oldMini, isSmallWindow: false })
  console.log(`  截图实测：封面 ${SHOT.measured.cover[0]}~${SHOT.measured.cover[1]}pt；红框(SongInfo) ${SHOT.measured.infoBlock[0]}~${SHOT.measured.infoBlock[1]}pt；单行歌词 ${SHOT.measured.miniLyric[0]}~${SHOT.measured.miniLyric[1]}pt`)
  console.log(`  模型计算：封面底 ${r.coverBottom.toFixed(0)}pt；红框上边 ${(r.infoTop + SONGINFO.marginTop).toFixed(0)}pt；歌词行顶 ${(r.infoBottom - oldMini + 10).toFixed(0)}pt`)
  check('封面底与截图一致（±6pt）', Math.abs(r.coverBottom - SHOT.measured.cover[1]) <= 6, `diff=${(r.coverBottom - SHOT.measured.cover[1]).toFixed(1)}`)
  check('红框上边与截图一致（±10pt）', Math.abs(r.infoTop + SONGINFO.marginTop - SHOT.measured.infoBlock[0]) <= 10, `diff=${(r.infoTop + SONGINFO.marginTop - SHOT.measured.infoBlock[0]).toFixed(1)}`)
}

console.log('\n' + '='.repeat(78))
console.log('大屏（390x844）：不同 paddingBottom 下信息块位置与安全性')
console.log('='.repeat(78))
const oldMini = miniLyricHeight({ lines: 1, hasTranslation: false, paddingV: 10, fontSize: { current: 13, neighbor: 13 } })
const newMiniTr = miniLyricHeight({ lines: 3, hasTranslation: true, paddingV: 4, fontSize: { current: 20, neighbor: 16 } })
console.log(`  迷你歌词高度：旧 1 行 = ${oldMini}pt，新 3 行+翻译 = ${newMiniTr}pt`)
// 生产实现：大屏 paddingBottom = round(winHeight * 0.05)，小屏 = 0
const prodPaddingBottom = (h) => (h < 700 ? 0 : Math.round(h * 0.05))
for (const v of [
  { label: '旧版（1 行, pb=0）', paddingBottom: 0, miniLyric: oldMini },
  { label: '新 3 行+翻译, pb=0', paddingBottom: 0, miniLyric: newMiniTr },
  { label: '新 3 行+翻译, pb=40', paddingBottom: 40, miniLyric: newMiniTr },
  { label: '新 3 行+翻译, pb=42 (0.05*h) ★', paddingBottom: 42, miniLyric: newMiniTr },
  { label: '新 3 行+翻译, pb=63 (0.075*h)', paddingBottom: 63, miniLyric: newMiniTr },
  { label: '新 3 行+翻译, pb=80', paddingBottom: 80, miniLyric: newMiniTr },
]) {
  const r = calc({ screenH: 844, playerH: PLAYER_H_FROM_SHOT, paddingBottom: v.paddingBottom, miniLyric: v.miniLyric, isSmallWindow: false })
  console.log(
    `  ${v.label.padEnd(34)} 中缝=${r.gap.toFixed(0).padStart(4)}pt  红框上边=${(r.infoTop + SONGINFO.marginTop).toFixed(0).padStart(4)}pt  块底=${r.infoBottom.toFixed(0).padStart(4)}pt (容器底 ${r.containerBottom.toFixed(0)}pt)${r.overflow ? '  ⚠️溢出' : ''}`,
  )
}

console.log('\n' + '='.repeat(78))
console.log('小屏（iPhone SE 375x667）：生产降级方案校验')
console.log('='.repeat(78))
const SE = { screenH: 667, statusBarH: 26, playerH: 215 }
{
  const big = calc({ screenH: SE.screenH, statusBarH: SE.statusBarH, playerH: SE.playerH, paddingBottom: 63, miniLyric: newMiniTr, isSmallWindow: true })
  console.log(`  小屏若用大屏方案（3 行+放大+pb=63）：free=${big.free.toFixed(0)}pt → 溢出=${big.overflow}`)
  check('确认小屏使用大屏方案会溢出（降级确有必要）', big.overflow)

  // 生产降级：小屏只显示当前行，字号 17（仍比原先 13 放大），paddingBottom = 0
  const smallMini = miniLyricHeight({ lines: 1, hasTranslation: false, paddingV: 4, fontSize: { current: 17, neighbor: 15 } })
  const small = calc({
    screenH: SE.screenH, statusBarH: SE.statusBarH, playerH: SE.playerH,
    paddingBottom: prodPaddingBottom(SE.screenH), miniLyric: smallMini, isSmallWindow: true,
  })
  console.log(`  小屏生产方案（1 行 + 字号 17 + pb=${prodPaddingBottom(SE.screenH)}）：free=${small.free.toFixed(0)}pt → 溢出=${small.overflow}`)
  check('小屏生产方案不溢出', !small.overflow, `free=${small.free}`)
  check('小屏字号确实比原先放大（17 > 13）', 17 > 13)
}

console.log('\n' + '='.repeat(78))
console.log('大屏（用户机型 390x844）最终方案校验')
console.log('='.repeat(78))
{
  const pb = prodPaddingBottom(844)
  const base = calc({ screenH: 844, playerH: PLAYER_H_FROM_SHOT, paddingBottom: 0, miniLyric: oldMini, isSmallWindow: false })
  const fixed = calc({ screenH: 844, playerH: PLAYER_H_FROM_SHOT, paddingBottom: pb, miniLyric: newMiniTr, isSmallWindow: false })
  const lifted = (fixed.infoTop + SONGINFO.marginTop) - (base.infoTop + SONGINFO.marginTop)
  console.log(`  paddingBottom = ${pb}pt`)
  console.log(`  红框(SongInfo)上边：${(base.infoTop + SONGINFO.marginTop).toFixed(0)}pt → ${(fixed.infoTop + SONGINFO.marginTop).toFixed(0)}pt（上移 ${(-lifted).toFixed(0)}pt）`)
  console.log(`  中缝：${base.gap.toFixed(0)}pt → ${fixed.gap.toFixed(0)}pt；块底 ${fixed.infoBottom.toFixed(0)}pt，容器底 ${fixed.containerBottom.toFixed(0)}pt`)
  check('红框确有上移（>40pt）', lifted < -40, `lifted=${lifted.toFixed(1)}`)
  check('红框上边不与封面重叠', fixed.infoTop + SONGINFO.marginTop > fixed.coverBottom)
  check('红框与封面留呼吸间距（>=30pt）', fixed.infoTop + SONGINFO.marginTop - fixed.coverBottom >= 30, `gap=${(fixed.infoTop + SONGINFO.marginTop - fixed.coverBottom).toFixed(0)}`)
  check('封面与歌曲名间距不过挤（>=35pt）', fixed.infoTop + SONGINFO.marginTop - fixed.coverBottom >= 35, `gap=${(fixed.infoTop + SONGINFO.marginTop - fixed.coverBottom).toFixed(0)}`)
  check('上移后仍不溢出', !fixed.overflow, `free=${fixed.free}`)
  check('信息块不压到 Player 区', fixed.infoBottom <= fixed.containerBottom)
  check('信息块底部仍留有呼吸空间（>=30pt）', fixed.containerBottom - fixed.infoBottom >= 30, `rest=${(fixed.containerBottom - fixed.infoBottom).toFixed(0)}`)
}

console.log('\n' + '='.repeat(74))
console.log(`结果：${pass} 通过 / ${fail} 失败`)
console.log('='.repeat(74))
process.exit(fail ? 1 : 0)
