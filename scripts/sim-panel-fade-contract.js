/**
 * sim-panel-fade-contract.js
 *
 * 播放队列面板（`AnimatedSlideUpPanel`）的弹出动画契约。
 *
 * 为什么需要它：该面板的 show 曾经是 `timing(..., duration: 0)` —— 等于
 * **从来没有动画**（面板瞬间出现），而设置弹层走 RN Modal 的 `animationType="fade"`
 * （原生映射为 `UIModalTransitionStyleCrossDissolve`），观感不一致
 * （用户 2026-09-30 报「临时播放列表弹出没有动画」）。
 *
 * 但把动画"补回来"有个不能踩的雷：**卸载绝不能挂在动画回调上**。`d26fa34` 修过的
 * 「整页点不动的假死」根因正是 `timing().start(() => setIsVisible(false))` —— 原生动画
 * 回调可能被后续动画抢占/丢失，蒙层就以 opacity=0 残留在视图树上继续拦截全屏触摸。
 * 所以本脚本同时守两侧：①动画必须真存在（duration>0 且取自常量）；②卸载必须走定时器
 * 且定时器在 show / 卸载两条路径都被清理。
 *
 * 反例是「把篡改后的源码喂回同一套不变量」，必须真被拦下。
 *
 * 运行：node scripts/sim-panel-fade-contract.js
 * 退出码：不变量全过、且全部反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PANEL = 'src/components/common/AnimatedSlideUpPanel.tsx'
const MODAL = 'src/components/common/Modal.tsx'

const PANEL_SRC = fs.readFileSync(path.join(ROOT, PANEL), 'utf8')
const MODAL_SRC = fs.readFileSync(path.join(ROOT, MODAL), 'utf8')

// 行尾归一：同一仓库里 LF / CRLF 混存（Popup.tsx 是 LF、本面板是 CRLF），
// 多行款式的替换串若不做归一，会以「替换未命中」的形式假失败。
const norm = (s) => s.replace(/\r\n/g, '\n')
// 去行注释：契约判断只看真代码 —— 否则「把某行注释掉」这种篡改会被当成仍然存在
// （反例 ⑤ 第一版就是这么假绿的），头注释里提到的 `.start()` 也会误触发。
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '')

/** 取 `const show = useCallback(` … `}, [` 之间的函数体（不用 `$` 收尾：CRLF 陷阱） */
function callbackBody(src, name) {
  const at = src.indexOf(`const ${name} = useCallback(`)
  if (at < 0) return null
  const end = src.indexOf('}, [', at)
  if (end < 0) return null
  return src.slice(at, end)
}

/** 面板自身的淡入时长（秒级常量，源码里是 300 这种整数毫秒） */
function fadeDuration(src) {
  const m = /const FADE_DURATION = (\d+)/.exec(src)
  return m ? Number(m[1]) : null
}

/** 设置弹层的淡出卸载冗余（Modal.tsx 的 setTimeout(..., 300)），用于「同频」比对 */
function modalUnmountDelay(src) {
  const m = /setTimeout\(\(\)\s*=>\s*\{[^}]*\}\s*,\s*(\d+)\s*\)/.exec(src)
  return m ? Number(m[1]) : null
}

/** 被 timing 驱动的动画值标识符（`Animated.timing(fade, {` → 'fade'） */
function animatedValueName(body) {
  const m = /Animated\.timing\(\s*([A-Za-z_$][\w$]*)\s*,/.exec(body ?? '')
  return m ? m[1] : null
}

/** 对给定源码跑全部不变量（内部先去注释 + 归一化行尾） */
function invariants(rawSrc) {
  const src = stripComments(norm(rawSrc))
  const out = []
  const add = (name, ok, detail = '') => out.push({ name, ok, detail })

  const show = callbackBody(src, 'show')
  const hide = callbackBody(src, 'hide')
  const dur = fadeDuration(src)
  const driven = animatedValueName(show)

  // 1. 显示路径必须真有动画：timing 的 duration 取自常量且为正
  {
    const hasTiming = show != null && /Animated\.timing\(/.test(show)
    const usesConst = show != null && /duration:\s*FADE_DURATION/.test(show)
    const hardZero = show != null && /duration:\s*0\b/.test(show)
    add(
      `invariant 1: show() 用 duration: FADE_DURATION 且常量 > 0（实测 ${dur ?? '未找到'}）`,
      hasTiming && usesConst && !hardZero && dur != null && dur > 0,
      `timing=${hasTiming} 用常量=${usesConst} 硬编码0=${hardZero} FADE_DURATION=${dur}`,
    )
  }

  // 2. 蒙层与面板共用同一个动画值 ⇒ 与 Modal 的交叉溶解同构（不会蒙层瞬现、面板淡入）
  {
    const refs = driven == null ? 0 : (src.match(new RegExp(`opacity:\\s*${driven}\\b`, 'g')) || []).length
    add(
      'invariant 2: 蒙层与面板都引用同一个动画值（opacity 出现 ≥2 次）',
      refs >= 2,
      `标识符=${driven ?? '未解析到'} 引用次数=${refs}`,
    )
  }

  // 3. 卸载不得依赖动画回调：start() 不带回调，且 hide 内有定时器卸载
  {
    const withCallback = /\.start\(\s*[^)\s]/.test(show ?? '') || /\.start\(\s*[^)\s]/.test(hide ?? '')
    const hasTimer = hide != null && /setTimeout\(/.test(hide)
    add(
      'invariant 3: .start() 不带回调（假死老路）且 hide 走 setTimeout 卸载',
      !withCallback && hasTimer,
      `start带回调=${withCallback} hide有定时器=${hasTimer}`,
    )
  }

  // 4. 定时器生命周期：show 里取消待卸载 + 组件卸载时清理
  {
    const showClears = show != null && /clearUnmountTimer\(\)/.test(show)
    const unmountCleans = /useEffect\(\(\)\s*=>\s*clearUnmountTimer/.test(src)
    add(
      'invariant 4: show() 取消待卸载定时器、且组件卸载时清理（避免卸载后 setState / 淡出途中被强制卸载）',
      showClears && unmountCleans,
      `show清理=${showClears} 卸载清理=${unmountCleans}`,
    )
  }

  // 5. hide 必须同步回调 onHide（否则 300ms 内再点开因父层 visible 仍为 true 而弹不出来）
  {
    const sync = hide != null && /onHide\?\.\(\)/.test(hide)
    // onHide 调用必须出现在 setTimeout 之前（同步语义）
    const orderOk = hide != null &&
      hide.indexOf('onHide?.()') >= 0 &&
      hide.indexOf('onHide?.()') < hide.indexOf('setTimeout(')
    add(
      'invariant 5: hide() 在调度卸载定时器之前同步回调 onHide',
      sync && orderOk,
      `存在调用=${sync} 顺序正确=${orderOk}`,
    )
  }

  // 6. 与设置弹层「同频」：面板淡入时长与 Modal 的淡出冗余同频段（差值 ≤ 100ms）
  {
    const modalDelay = modalUnmountDelay(stripComments(norm(MODAL_SRC)))
    const diff = dur != null && modalDelay != null ? Math.abs(dur - modalDelay) : null
    add(
      `invariant 6: 与设置弹层同频（面板 ${dur ?? '?'}ms vs Modal ${modalDelay ?? '?'}ms）`,
      diff != null && diff <= 100,
      `差值=${diff ?? '无法比较'}`,
    )
  }

  return out
}

// ---------- 正例 ----------
const results = invariants(PANEL_SRC).map(r => ({ ...r, group: '正例' }))

// ---------- 反例：篡改后喂回同一套不变量 ----------
const TAMPER_CASES = [
  {
    label: '① 时长退回 0（等于没有动画，即本次修复前的状态）',
    from: '      duration: FADE_DURATION,',
    to: '      duration: 0,',
  },
  {
    label: '② .start() 带回调卸载（假死老路 d26fa34）',
    from: '    }).start()',
    to: '    }).start(() => { setIsVisible(false) })',
  },
  {
    label: '③ show() 不再取消待卸载定时器',
    from: `    clearUnmountTimer()
    setIsVisible(true)`,
    to: `    setIsVisible(true)`,
  },
  {
    label: '④ 面板 opacity 不接动画值（蒙层淡、面板瞬现）',
    from: `              height: windowHeight * 0.5,
              opacity: fade,`,
    to: `              height: windowHeight * 0.5,
              opacity: 1,`,
  },
  {
    label: '⑤ 删掉卸载时的定时器清理',
    from: `  useEffect(() => clearUnmountTimer, [clearUnmountTimer])`,
    to: `  // useEffect(() => clearUnmountTimer, [clearUnmountTimer])`,
  },
]

// 反例的替换基准：归一化行尾（保留注释，反例⑤正是靠"注释掉一行"来篡改的）
const BASE = norm(PANEL_SRC)

for (const c of TAMPER_CASES) {
  if (!BASE.includes(c.from)) {
    results.push({ group: '反例', name: `反例 ${c.label}`, ok: false, detail: '替换未命中：源码已变，反例失效需同步' })
    continue
  }
  const patched = BASE.replace(c.from, c.to)
  if (patched === BASE) {
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
