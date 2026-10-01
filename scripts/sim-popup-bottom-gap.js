/**
 * sim-popup-bottom-gap.js
 *
 * 底部弹层「面板底 ↔ 屏幕底」缺口不变量。
 *
 * 为什么需要它：`Popup` 把面板抬到 Home 指示条之上
 * （外层 `paddingBottom = position === 'bottom' ? safeAreaBottom : 0`），
 * 面板自身止于安全区顶边，于是安全区那 34pt 露出来的是遮罩 + 页面背景
 * ——真机上就是「面板下面多了一条深色横条」，Home 指示条正落在里面。
 * 实机现象：播放详情 → 设置，弹层底部那条黑边（2026-09-30 修复）。
 *
 * 修法要求「布局零变化、只补背景」：不能给面板加 paddingBottom —— 面板
 * `maxHeight: 78%` 会把 padding 一起算进高度上限，可滚内容区会被削掉
 * 一整个 safeAreaBottom（播详设置/音效弹层都是滚到底的长内容，会实打实
 * 少看一行）。所以补白必须是**同色绝对定位子视图**：不动布局、自然继承
 * 面板宽度（含 iPad 横屏 760 居中）、并绘制在面板阴影之上。
 *
 * 不变量既跑几何模型（多机型 × 四种 position × 键盘两态），也直接对
 * `src/components/common/Popup.tsx` 源码断言；反例是「把篡改后的源码喂回
 * 同一套不变量」，必须真的被拦下 —— 只跑模型等于在测自己的副本。
 *
 * 运行：node scripts/sim-popup-bottom-gap.js
 * 退出码：不变量 1~5 全过、且 4 例反例全被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const POPUP = 'src/components/common/Popup.tsx'
// 归一化行尾：同仓库 LF/CRLF 混存，多行款式的替换串不归一就会以「替换未命中」假失败
const REAL = fs.readFileSync(path.join(ROOT, POPUP), 'utf8').replace(/\r\n/g, '\n')

/**
 * 外层容器的 paddingBottom 表达式。
 * 必须锚在 JSX 里那处（`...styles.centeredView` 之后），否则会先撞上 styles
 * 里 title 的 `paddingBottom: designSpacing.sm` —— 第一版就是这么误报的。
 * 行尾用 indexOf 找、不写 `$`：这些文件是 CRLF，JS 的 `$` 不匹配 `\r` 之前的
 * 位置（同 NOTES-conventions #13 那个坑）。
 */
function bottomPaddingExpr(src) {
  const anchor = src.indexOf('...centeredViewStyle')
  if (anchor < 0) return null
  const at = src.indexOf('paddingBottom:', anchor)
  if (at < 0) return null
  const rest = src.slice(at + 'paddingBottom:'.length)
  const stop = [rest.indexOf(',\r\n'), rest.indexOf(',\n')].filter(i => i >= 0)
  if (!stop.length) return null
  return rest.slice(0, Math.min(...stop)).trim()
}

/** 补白块源码（以 `bottom: -safeAreaBottom` 为锚，取门控到 `) : null}` 之间的窗口） */
function fillerBlock(src) {
  const anchor = src.indexOf('bottom: -safeAreaBottom')
  if (anchor < 0) return null
  const gateStart = src.lastIndexOf('{position ===', anchor)
  const end = src.indexOf(') : null}', anchor)
  if (gateStart < 0 || end < 0) return null
  return src.slice(gateStart, end)
}

/** 几何模型：面板底 = 屏高 − 外层 paddingBottom；补白从面板底再向下延伸 */
function gapOf({ position, keyboardShown, safeAreaBottom, fillerPaints }) {
  const padding = keyboardShown
    ? 0 // 键盘弹起时外层留白 = 键盘高，最坏情形按 0 处理（面板贴键盘顶）
    : position === 'bottom' ? safeAreaBottom : 0
  const paintedByFiller = fillerPaints ? safeAreaBottom : 0
  return padding - paintedByFiller
}

/** 对给定源码跑全部不变量。返回 [{ name, ok, detail }] */
function invariants(src) {
  const out = []
  const add = (name, ok, detail = '') => out.push({ name, ok, detail })

  const paddingExpr = bottomPaddingExpr(src)
  const filler = fillerBlock(src)

  // 1. 外层 paddingBottom 仍是「键盘 > 底部安全区 > 0」三分支
  {
    const flat = (paddingExpr ?? '').replace(/\s+/g, ' ')
    const want = /keyboardShown \? keyboardHeight : position === 'bottom' \? safeAreaBottom : 0/
    add(
      `invariant 1: 外层 paddingBottom 三分支未变（实测 "${paddingExpr ?? '未找到'}"）`,
      paddingExpr != null && want.test(flat),
      paddingExpr ?? '',
    )
  }

  // 2. 补白高度与偏移同取 safeAreaBottom —— 偏移取反即与外层留白精确互抵
  {
    const hasHeight = filler != null && /height:\s*safeAreaBottom/.test(filler)
    const hasOffset = filler != null && /bottom:\s*-safeAreaBottom/.test(filler)
    add(
      'invariant 2: 补白高度与向下偏移同为 safeAreaBottom',
      hasHeight && hasOffset,
      `height=${hasHeight} offset=${hasOffset}`,
    )
  }

  // 3. 同色 + 不吃触摸 + 宽度继承面板（不得写死宽度）
  {
    const sameColor = filler != null && /backgroundColor:\s*theme\['c-content-background'\]/.test(filler)
    const noTouch = filler != null && /pointerEvents="none"/.test(filler)
    const inherit = filler != null && /left:\s*0/.test(filler) && /right:\s*0/.test(filler)
    const hardWidth = filler != null && /\bwidth:/.test(filler)
    add(
      'invariant 3: 补白同色（c-content-background）、不拦触摸、宽度继承面板且无写死宽度',
      sameColor && noTouch && inherit && !hardWidth,
      `同色=${sameColor} pointerEvents=${noTouch} 继承宽度=${inherit} 写死宽度=${hardWidth}`,
    )
  }

  // 4. 门控三条件
  {
    const gate = /position === 'bottom'\s*&&\s*!keyboardShown\s*&&\s*safeAreaBottom > 0/
    add(
      'invariant 4: 门控 = 仅 position==="bottom" && 键盘收起 && safeAreaBottom>0',
      filler != null && gate.test(filler),
      filler == null ? '未找到补白块' : filler.split('\n')[0].trim(),
    )
  }

  // 5. 几何模型：底部形态缺口恒为 0，其余形态不得产生多余补白
  {
    const fillerPaints = filler != null && /position === 'bottom'/.test(filler) &&
      /!keyboardShown/.test(filler) && /safeAreaBottom > 0/.test(filler)
    const devices = [
      { name: 'iPhone SE(无指示条)', safeAreaBottom: 0 },
      { name: 'iPhone 13 mini', safeAreaBottom: 34 },
      { name: 'iPhone 15', safeAreaBottom: 34 },
      { name: 'iPad 竖屏', safeAreaBottom: 20 },
      { name: 'iPad 横屏', safeAreaBottom: 20 },
    ]
    const cases = []
    for (const d of devices) {
      for (const position of ['bottom', 'left', 'right', 'top']) {
        for (const keyboardShown of [false, true]) {
          cases.push({ ...d, position, keyboardShown, fillerPaints })
        }
      }
    }
    const bad = cases.filter((c) => {
      const gap = gapOf(c)
      if (c.position === 'bottom' && !c.keyboardShown) return gap !== 0 // 必须严丝合缝
      return gap > 0 // 其余形态不得被补白反填
    })
    add(
      `invariant 5: ${cases.length} 组机型×形态×键盘组合下缺口行为正确`,
      bad.length === 0,
      bad.slice(0, 3).map(c => `${c.name}/${c.position}/kbd=${c.keyboardShown}:gap=${gapOf(c)}`).join('  '),
    )
  }

  return out
}

// ---------- 正例：真源码必须全过 ----------
const results = invariants(REAL).map(r => ({ ...r, group: '正例' }))

// ---------- 反例：篡改后喂回同一套不变量，必须真被拦下 ----------
const TAMPER_CASES = [
  {
    label: '① 删掉补白（门控恒 false）',
    from: '{position === \'bottom\' && !keyboardShown && safeAreaBottom > 0 ? (',
    to: '{false && safeAreaBottom > 0 ? (',
  },
  {
    label: '② 偏移写成 bottom: 0（补白落回面板内部）',
    from: 'bottom: -safeAreaBottom',
    to: 'bottom: 0',
  },
  {
    label: '③ 去掉键盘门控（键盘弹起时被实心补白填满）',
    from: '{position === \'bottom\' && !keyboardShown && safeAreaBottom > 0 ? (',
    to: '{position === \'bottom\' && safeAreaBottom > 0 ? (',
  },
  {
    label: '④ 宽度写死（iPad 横屏补白横向溢出）',
    from: `                  left: 0,
                  right: 0,`,
    to: `                  left: 0,
                  right: 0,
                  width: 375,`,
  },
  {
    label: '⑤ 背景换成面板以外的颜色（接缝）',
    from: `                  height: safeAreaBottom,
                  backgroundColor: theme['c-content-background'],`,
    to: `                  height: safeAreaBottom,
                  backgroundColor: 'rgba(0,0,0,.2)',`,
  },
]

// 替换只在**补白块内部**做：`backgroundColor: theme['c-content-background']` 这类串
// 在面板自身也出现一次，直接对全文 replace 会打偏（第一版反例 ⑤ 就是这么假绿的）。
const BLOCK = fillerBlock(REAL)

for (const c of TAMPER_CASES) {
  if (BLOCK == null) {
    results.push({ group: '反例', name: `反例 ${c.label}`, ok: false, detail: '未提取到补白块：源码结构已变，反例需同步' })
    continue
  }
  const patchedBlock = BLOCK.replace(c.from, c.to)
  if (patchedBlock === BLOCK) {
    results.push({ group: '反例', name: `反例 ${c.label}`, ok: false, detail: '替换未命中：源码已变，反例失效需同步' })
    continue
  }
  const patched = REAL.replace(BLOCK, patchedBlock)
  if (patched === REAL) {
    results.push({ group: '反例', name: `反例 ${c.label}`, ok: false, detail: '替换后内容不变' })
    continue
  }
  const failedInvariants = invariants(patched).filter(r => !r.ok)
  results.push({
    group: '反例',
    name: `反例 ${c.label} 被拦下`,
    ok: failedInvariants.length > 0,
    detail: failedInvariants.length
      ? `命中：${failedInvariants.map(r => r.name.split(':')[0]).join('、')}`
      : '未被任何不变量拦下（守卫无效）',
  })
}

// ---------- 输出 ----------
let failed = 0
let group = ''
for (const r of results) {
  if (r.group !== group) {
    group = r.group
    console.log(`\n--- ${group} ---`)
  }
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`)
  if (!r.ok) failed++
}
console.log(`\n${results.filter(r => r.ok).length}/${results.length} 通过`)
process.exit(failed ? 1 : 0)
