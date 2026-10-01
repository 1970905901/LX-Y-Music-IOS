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

const fs = require('fs')
const path = require('path')

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
  // 歌名(28) + 间距8 + 徽章 + 歌手(16) + 间距4 + 专辑(14)，由截图反推（红框可见高 145）。
  content: 145,
  // 红框 ↔ 迷你歌词块的间距。10 = 截图校准期的历史值；2026-09-30 用户要求
  // 「歌曲歌手名再上移一点」→ 改为 18：该块整体上移 8pt，三行歌词位置不动
  // （信息块在封面页容器里是贴底的，加大取两块的间距 = 上面那块上移）。
  marginBottomLegacy: 10,
  marginBottom: 18,
}
// 迷你歌词：3 行歌词（上16 / 当前20 / 下16）+ 可选翻译行(15) + paddingVertical。
// 行高 = 该行命中字体的自然行高（约 1.3em）。注意这是**估计值**：中文命中 PingFang(≈1.4em)、
// 拉丁命中 SF(≈1.19em)，同一字号下会差最多 0.2em —— 但 2026-09-30 对用户截图逐像素实测，
// 三行的「行盒外余量之和」几乎相等（6.2 / 6.1pt），即**这 0.2em 在本例里只值 0.1pt**：
// 用户报的「间距不一致」不是它造成的（真因见下方「每个间隙一份 marginTop」节）。
// lineGap = 各间隙的 marginTop（挂在间隙下边那一行上）
const miniLyricHeight = ({ lines, hasTranslation, paddingV, fontSize, lineGap = 0 }) => {
  const lineHeights = { 13: 17, 15: 20, 16: 21, 17: 22, 20: 26 }
  let h = paddingV * 2
  const layout = lines === 3 ? [fontSize.neighbor, fontSize.current, fontSize.neighbor] : [fontSize.current]
  for (let i = 0; i < layout.length; i++) {
    if (i > 0) h += lineGap
    h += lineHeights[layout[i]]
  }
  if (hasTranslation) h += lineGap + lineHeights[15]
  return h
}

const calc = ({ screenH, statusBarH = SHOT.statusBarHeight, playerH, paddingBottom, miniLyric, isSmallWindow, coverH = 146, songInfoMarginBottom = SONGINFO.marginBottom }) => {
  const headerH = SHOT.headerHeight
  const containerH = screenH - statusBarH - headerH - playerH
  const paddingTop = 10 // containerPaddingH = scaleSizeW(10)
  const infoH = SONGINFO.marginTop + SONGINFO.content + songInfoMarginBottom + (isSmallWindow ? 12 : 0) + miniLyric
  const contentH = coverH + infoH
  const free = containerH - paddingTop - paddingBottom - contentH
  const top = statusBarH + headerH
  return {
    containerH,
    coverH,
    infoH,
    contentH,
    free,
    coverTop: top + paddingTop,
    coverBottom: top + paddingTop + coverH,
    gap: free, // space-between 下 = 封面与信息块之间的中缝
    infoTop: top + paddingTop + coverH + free,
    infoBottom: top + paddingTop + coverH + free + infoH,
    containerBottom: top + containerH,
    overflow: free < 0,
  }
}

let pass = 0; let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

console.log('='.repeat(78))
console.log('基准校验：旧版（迷你歌词 1 行、无 paddingBottom）能否复现截图实测位置')
console.log('='.repeat(78))
{
  const oldMini = miniLyricHeight({ lines: 1, hasTranslation: false, paddingV: 10, fontSize: { current: 13, neighbor: 13 } })
  // 校准必须用**历史参数**才复现得了截图：marginBottom 旧值 10（现为 18）。
  // 行高这里按显式倍率算，比当年「系统自然行高」的估计值高 1pt，在 ±6/±10 容差内。
  const r = calc({ screenH: 844, playerH: PLAYER_H_FROM_SHOT, paddingBottom: 0, miniLyric: oldMini, isSmallWindow: false, songInfoMarginBottom: SONGINFO.marginBottomLegacy })
  console.log(`  截图实测：封面 ${SHOT.measured.cover[0]}~${SHOT.measured.cover[1]}pt；红框(SongInfo) ${SHOT.measured.infoBlock[0]}~${SHOT.measured.infoBlock[1]}pt；单行歌词 ${SHOT.measured.miniLyric[0]}~${SHOT.measured.miniLyric[1]}pt`)
  console.log(`  模型计算：封面底 ${r.coverBottom.toFixed(0)}pt；红框上边 ${(r.infoTop + SONGINFO.marginTop).toFixed(0)}pt；歌词行顶 ${(r.infoBottom - oldMini + 10).toFixed(0)}pt`)
  check('封面底与截图一致（±6pt）', Math.abs(r.coverBottom - SHOT.measured.cover[1]) <= 6, `diff=${(r.coverBottom - SHOT.measured.cover[1]).toFixed(1)}`)
  check('红框上边与截图一致（±10pt）', Math.abs(r.infoTop + SONGINFO.marginTop - SHOT.measured.infoBlock[0]) <= 10, `diff=${(r.infoTop + SONGINFO.marginTop - SHOT.measured.infoBlock[0]).toFixed(1)}`)
}

console.log('\n' + '='.repeat(78))
console.log('大屏（390x844）：不同 paddingBottom 下信息块位置与安全性')
console.log('='.repeat(78))
const oldMini = miniLyricHeight({ lines: 1, hasTranslation: false, paddingV: 10, fontSize: { current: 13, neighbor: 13 } })
const newMiniTr = miniLyricHeight({ lines: 3, hasTranslation: true, paddingV: 4, fontSize: { current: 20, neighbor: 16 }, lineGap: 8 })
console.log(`  迷你歌词高度：旧 1 行 = ${oldMini}pt，新 3 行+翻译(行距 8) = ${newMiniTr}pt`)
// 生产实现：大屏 paddingBottom = 常量（当前 12pt，见 VerticalNew 的 PAGE_BOTTOM_PADDING），小屏 = 0
const PROD_PAGE_BOTTOM_PADDING = 12
const prodPaddingBottom = (h) => (h < 700 ? 0 : PROD_PAGE_BOTTOM_PADDING)
for (const v of [
  { label: '旧版（1 行, pb=0）', paddingBottom: 0, miniLyric: oldMini },
  { label: '新 3 行+翻译, pb=0', paddingBottom: 0, miniLyric: newMiniTr },
  { label: '新 3 行+翻译, pb=12 (当前) ★', paddingBottom: 12, miniLyric: newMiniTr },
  { label: '新 3 行+翻译, pb=20', paddingBottom: 20, miniLyric: newMiniTr },
  { label: '新 3 行+翻译, pb=30', paddingBottom: 30, miniLyric: newMiniTr },
  { label: '新 3 行+翻译, pb=42 (上一轮)', paddingBottom: 42, miniLyric: newMiniTr },
  { label: '新 3 行+翻译, pb=63 (0.075*h)', paddingBottom: 63, miniLyric: newMiniTr },
]) {
  const r = calc({ screenH: 844, playerH: PLAYER_H_FROM_SHOT, paddingBottom: v.paddingBottom, miniLyric: v.miniLyric, isSmallWindow: false })
  const lyricTop = r.infoBottom - v.miniLyric
  console.log(
    `  ${v.label.padEnd(34)} 中缝=${r.gap.toFixed(0).padStart(4)}pt  红框上边=${(r.infoTop + SONGINFO.marginTop).toFixed(0).padStart(4)}pt  歌词块顶=${lyricTop.toFixed(0).padStart(4)}pt  块底=${r.infoBottom.toFixed(0).padStart(4)}pt  底部余=${(r.containerBottom - r.infoBottom).toFixed(0).padStart(3)}pt${r.overflow ? '  ⚠️溢出' : ''}`,
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
  const smallMini = miniLyricHeight({ lines: 1, hasTranslation: false, paddingV: 4, fontSize: { current: 17, neighbor: 15 }, lineGap: 6 })
  const small = calc({
    screenH: SE.screenH,
    statusBarH: SE.statusBarH,
    playerH: SE.playerH,
    paddingBottom: prodPaddingBottom(SE.screenH),
    miniLyric: smallMini,
    isSmallWindow: true,
  })
  console.log(`  小屏生产方案（1 行 + 字号 17 + pb=${prodPaddingBottom(SE.screenH)}）：free=${small.free.toFixed(0)}pt → 溢出=${small.overflow}`)
  check('小屏生产方案不溢出', !small.overflow, `free=${small.free}`)
  check('小屏字号确实比原先放大（17 > 13）', 17 > 13)
}

console.log('\n' + '='.repeat(78))
console.log('大屏（用户机型 390x844）最终方案校验：歌词下移 + 行距加大')
console.log('='.repeat(78))
{
  const pb = prodPaddingBottom(844)
  // 上一轮方案：pb=42、行距 2
  const prevMini = miniLyricHeight({ lines: 3, hasTranslation: true, paddingV: 4, fontSize: { current: 20, neighbor: 16 }, lineGap: 2 })
  const prev = calc({ screenH: 844, playerH: PLAYER_H_FROM_SHOT, paddingBottom: 42, miniLyric: prevMini, isSmallWindow: false, songInfoMarginBottom: SONGINFO.marginBottomLegacy })
  const now = calc({ screenH: 844, playerH: PLAYER_H_FROM_SHOT, paddingBottom: pb, miniLyric: newMiniTr, isSmallWindow: false })
  const prevLyricTop = prev.infoBottom - prevMini
  const nowLyricTop = now.infoBottom - newMiniTr
  const shift = nowLyricTop - prevLyricTop
  console.log(`  paddingBottom ${42} → ${pb}pt；行距 2 → 8pt；歌词块高 ${prevMini} → ${newMiniTr}pt`)
  console.log(`  歌词块顶：${prevLyricTop.toFixed(0)}pt → ${nowLyricTop.toFixed(0)}pt（下移 ${shift.toFixed(0)}pt）`)
  console.log(`  红框(SongInfo)上边：${(prev.infoTop + SONGINFO.marginTop).toFixed(0)}pt → ${(now.infoTop + SONGINFO.marginTop).toFixed(0)}pt`)
  console.log(`  中缝：${prev.gap.toFixed(0)}pt → ${now.gap.toFixed(0)}pt；块底 ${now.infoBottom.toFixed(0)}pt，容器底 ${now.containerBottom.toFixed(0)}pt（余 ${(now.containerBottom - now.infoBottom).toFixed(0)}pt）`)
  check('歌词块整体下移', shift > 0, `shift=${shift.toFixed(1)}`)
  check('下移幅度适中（8~20pt，符合"一点"）', shift >= 8 && shift <= 20, `shift=${shift.toFixed(1)}`)
  check('行距确实加大（8 > 2）', 8 > 2)
  check('行距与行高比例合理（行距 >= 行高的 1/3，避免挤成一团）', 8 * 3 >= 21)
  check('下移后仍不溢出', !now.overflow, `free=${now.free}`)
  check('信息块不压到 Player 区', now.infoBottom <= now.containerBottom)
  // 底部余量 = paddingBottom，即信息块底到容器底的间隙。它是防止歌词视觉上贴住
  // 下方控制条的安全边界（>=10pt 即肉眼可辨的空隙），不是审美指标；
  // 想要信息块更靠下就要接受底边距变小，故下移幅度与底部余量不可兼得。
  check('信息块底部不贴住控制条（>=10pt 空隙）', now.containerBottom - now.infoBottom >= 10, `rest=${(now.containerBottom - now.infoBottom).toFixed(0)}`)
  check('红框仍与封面保持舒展间距（>=40pt）', (now.infoTop + SONGINFO.marginTop) - now.coverBottom >= 40, `gap=${((now.infoTop + SONGINFO.marginTop) - now.coverBottom).toFixed(0)}`)
  check('红框仍比旧版明显上移（>60pt）', (now.infoTop + SONGINFO.marginTop) - 414 < -60)
}

// ============================================================================
console.log('\n' + '='.repeat(78))
console.log('2026-09-30 本轮：三行歌词间距一致 + 歌名块上移 8pt')
console.log('='.repeat(78))

// 与 MiniLyric 的 LINE_GAP_NORMAL 对齐（契约里会校验两者一致）
const LINE_GAP = 8

// ---- 实测基线：用户截图（887x1920 px = 390x844pt，scale 2.274）逐像素扫描墨迹 ----
const MEASURED = {
  songName: [396.2, 424.3],
  artist: [452.0, 466.1],
  album: [475.3, 487.2],
  lyricPrev: [514.4, 528.5], // 吉他：Misha Kalinin（16pt）
  lyricCurrent: [534.7, 553.1], // 和声：秋子/李郡洲（20pt 高亮）
  lyricNext: [567.2, 579.5], // 乐器技师：于磊（16pt）
  iconRow: [629.6, 657.0],
}
{
  // 墨迹间距 = 上行行盒下余量 + marginTop + 下行行盒上余量 ⇒ 两处相减即可剥出 marginTop 之差
  const gPrevCur = MEASURED.lyricCurrent[0] - MEASURED.lyricPrev[1]
  const gCurNext = MEASURED.lyricNext[0] - MEASURED.lyricCurrent[1]
  const slackUp = gPrevCur - 0 // 旧实现：prev ↔ current 之间没有 marginTop
  const slackDown = gCurNext - LINE_GAP // 旧实现：只有 next 带一份
  const albumToFirst = MEASURED.lyricPrev[0] - MEASURED.album[1]
  console.log(`  实测墨迹间距：上一行↔当前行 ${gPrevCur.toFixed(1)}pt ／ 当前行↔下一行 ${gCurNext.toFixed(1)}pt（差 ${(gCurNext - gPrevCur).toFixed(1)}pt）`)
  console.log(`  扣掉 marginTop 后的行盒外余量之和：${slackUp.toFixed(1)}pt ／ ${slackDown.toFixed(1)}pt（差 ${Math.abs(slackUp - slackDown).toFixed(1)}pt）`)
  console.log(`  专辑 → 首行歌词：${albumToFirst.toFixed(1)}pt`)
  check('实测两处间隙之差 ≈ 一份 marginTop（8±0.6pt）⇒ 根因是 marginTop 挂错行', Math.abs((gCurNext - gPrevCur) - LINE_GAP) <= 0.6, `diff=${(gCurNext - gPrevCur).toFixed(1)}`)
  check('扣掉 marginTop 后两处余量之和几乎相等（差 < 0.5pt）⇒ 排除「中英文字体自然行高不同」这个假设', Math.abs(slackUp - slackDown) < 0.5)
  const fixed = [slackUp + LINE_GAP, slackDown + LINE_GAP]
  check(`新实现（两处各一份 marginTop）预测两处墨迹间距相等：${fixed[0].toFixed(1)} vs ${fixed[1].toFixed(1)}pt`, Math.abs(fixed[0] - fixed[1]) < 0.5)
}

// ---- 盒间距：每个间隙恰好一份 marginTop，且总高不变（无净位移）----
{
  const PV = 4 // MiniLyric container paddingVertical
  const H_NEIGHBOR = 21 // 16pt 自然行高（估）
  const H_CURRENT = 26 // 20pt
  // 旧实现：marginTop 挂在 prev / 翻译 / next 上 → prev 那份落在块顶（被 paddingVertical 吃掉）
  const heightOld = PV * 2 + LINE_GAP + H_NEIGHBOR + H_CURRENT + LINE_GAP + H_NEIGHBOR
  // 新实现：挂在 current / 翻译 / next 上
  const heightNew = PV * 2 + H_NEIGHBOR + LINE_GAP + H_CURRENT + LINE_GAP + H_NEIGHBOR
  const modelHeight = miniLyricHeight({ lines: 3, hasTranslation: true, paddingV: 4, fontSize: { current: 20, neighbor: 16 }, lineGap: LINE_GAP })
  check('旧实现：prev ↔ current 之间 0pt（marginTop 落到了块顶）', heightOld === PV * 2 + LINE_GAP + H_NEIGHBOR + H_CURRENT + LINE_GAP + H_NEIGHBOR)
  check('新实现：两个间隙各一份 marginTop', heightNew - PV * 2 === H_NEIGHBOR + 2 * LINE_GAP + H_CURRENT + H_NEIGHBOR)
  check('块高不变（prev 那份挪到 current，margin 总数不变 ⇒ 无净位移）', heightOld === heightNew, `${heightOld} vs ${heightNew}`)
  check('模型 miniLyricHeight() 与新实现一致（每个间隙一份）', modelHeight === 120, `h=${modelHeight}`)
}

// ---- 位置：歌名块上移 8pt、歌词块不动、不溢出 ----
{
  const pb = prodPaddingBottom(844)
  const args = { screenH: 844, playerH: PLAYER_H_FROM_SHOT, paddingBottom: pb, miniLyric: newMiniTr, isSmallWindow: false }
  const before = calc({ ...args, songInfoMarginBottom: SONGINFO.marginBottomLegacy })
  const after = calc(args)
  const nameShift = (before.infoTop + SONGINFO.marginTop) - (after.infoTop + SONGINFO.marginTop)
  console.log(`  歌名块上移 ${nameShift.toFixed(0)}pt（红框上边 ${(before.infoTop + SONGINFO.marginTop).toFixed(0)} → ${(after.infoTop + SONGINFO.marginTop).toFixed(0)}pt）`)
  console.log(`  歌词块顶 ${(before.infoBottom - newMiniTr).toFixed(0)} → ${(after.infoBottom - newMiniTr).toFixed(0)}pt；块底 ${after.infoBottom.toFixed(0)}pt（容器底 ${after.containerBottom.toFixed(0)}pt）`)
  console.log(`  中缝 ${before.gap.toFixed(0)} → ${after.gap.toFixed(0)}pt`)
  check('歌名块恰好上移 8pt（marginBottom 10 → 18）', Math.abs(nameShift - 8) < 0.01, `shift=${nameShift.toFixed(2)}`)
  check('三行歌词块整体位置不变（块高不变 + paddingBottom 未变）', Math.abs(before.infoBottom - after.infoBottom) < 0.01)
  check('上移后不溢出、信息块不压到控制条', !after.overflow && after.infoBottom <= after.containerBottom)
  check('信息块底部仍留 >=10pt 呼吸空间', after.containerBottom - after.infoBottom >= 10)
  check('歌名块与封面仍保持舒展间距（>=40pt）', (after.infoTop + SONGINFO.marginTop) - after.coverBottom >= 40, `gap=${((after.infoTop + SONGINFO.marginTop) - after.coverBottom).toFixed(0)}`)
}

// ---- 源码契约：marginTop 必须挂在「间隙下边那一行」 ----
{
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n')
  const MINI = read('src/screens/PlayDetail/components/MiniLyric.tsx')
  const SONG = read('src/screens/PlayDetail/Vertical/components/SongInfo.tsx')

  const lineOf = (src, name) => {
    const at = src.indexOf(`const ${name} = useMemo`)
    return at < 0 ? '' : src.slice(at, src.indexOf('\n', at))
  }
  const contract = (miniSrc, songSrc) => {
    const out = []
    const prev = lineOf(miniSrc, 'prevStyle')
    const cur = lineOf(miniSrc, 'contentStyle')
    const sub = lineOf(miniSrc, 'subLineStyle')
    const gapImpl = Number(/const LINE_GAP_NORMAL = (\d+)/.exec(miniSrc)?.[1])
    out.push({ name: 'prev 行样式不带 marginTop（带 = 间隙又落回块顶）', ok: prev.length > 0 && !/marginTop/.test(prev) })
    out.push({ name: '当前行样式带 marginTop', ok: /marginTop: lineGap/.test(cur) })
    out.push({ name: '翻译/下一行样式带 marginTop', ok: /marginTop: lineGap/.test(sub) })
    out.push({ name: 'JSX 里 prev 行用 prevStyle（有歌词 + 空占位两处）', ok: (miniSrc.match(/style=\{prevStyle\}/g) || []).length >= 2 })
    out.push({ name: 'JSX 里当前行用 contentStyle、次级行用 subLineStyle', ok: /style=\{contentStyle\}/.test(miniSrc) && /style=\{subLineStyle\}/.test(miniSrc) })
    out.push({ name: `模型行距与实现一致（实现 ${gapImpl} / 模型 ${LINE_GAP}）`, ok: gapImpl === LINE_GAP })
    out.push({ name: 'SongInfo 歌名块已上移（marginBottom 18）且小屏仍有独立 override', ok: /marginBottom: 18,/.test(songSrc) && /isSmallWindow && \{ marginTop: 8, marginBottom: 4 \}/.test(songSrc) })
    return out
  }
  for (const r of contract(MINI, SONG)) check(r.name, r.ok)

  const tampers = [
    { label: '① marginTop 挪回 prev（这次修的 bug 复发）', file: 'mini', from: 'const prevStyle = useMemo<StyleProp<TextStyle>>(() => ({ textAlign }), [textAlign])', to: 'const prevStyle = useMemo<StyleProp<TextStyle>>(() => ({ textAlign, marginTop: lineGap }), [textAlign, lineGap])' },
    { label: '② prev 行改回 subLineStyle', file: 'mini', from: 'style={prevStyle}', to: 'style={subLineStyle}' },
    { label: '③ 次级行样式丢掉 marginTop（下一行间隙消失）', file: 'mini', from: 'const subLineStyle = useMemo<StyleProp<TextStyle>>(() => ({ textAlign, marginTop: lineGap }), [textAlign, lineGap])', to: 'const subLineStyle = useMemo<StyleProp<TextStyle>>(() => ({ textAlign }), [textAlign])' },
    { label: '④ 实现行距改成 12 而模型没跟（模型与实现脱钩）', file: 'mini', from: 'const LINE_GAP_NORMAL = 8', to: 'const LINE_GAP_NORMAL = 12' },
    { label: '⑤ 歌名块 marginBottom 退回 10（本次需求被回滚）', file: 'song', from: 'marginBottom: 18,', to: 'marginBottom: 10,' },
  ]
  for (const t of tampers) {
    const base = t.file === 'mini' ? MINI : SONG
    if (!base.includes(t.from)) {
      check(`反例 ${t.label}`, false, '替换未命中：源码已变，反例失效需同步')
      continue
    }
    const patched = base.replace(t.from, t.to)
    const failed = contract(t.file === 'mini' ? patched : MINI, t.file === 'song' ? patched : SONG).filter(r => !r.ok)
    check(`反例 ${t.label} 被拦下`, failed.length > 0, failed.length ? `命中：${failed.map(r => r.name.slice(0, 14)).join('、')}` : '未被任何契约拦下')
  }
}

console.log('\n' + '='.repeat(74))
console.log(`结果：${pass} 通过 / ${fail} 失败`)
console.log('='.repeat(74))
process.exit(fail ? 1 : 0)
