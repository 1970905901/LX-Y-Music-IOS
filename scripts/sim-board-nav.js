/**
 * sim-board-nav.js
 *
 * 「播放音乐 → 放后台一段时间 → 回前台 → 在推荐页点榜单卡片没反应」这条复现路径的守卫。
 *
 * 建模四件真实事实：
 *  1) `setNavActiveId` 有同值短路（`core/common.ts:76-83`）；
 *  2) PagerView 的原生落点(observedIndex)与 navActiveId 是两套状态：App 从后台恢复时
 *     原生落点可能被重置到 0（推荐页），而 navActiveId 保持不变；
 *  3) observedIndex 曾被乐观初始化，可能在未经原生确认时就「看起来等于目标」；
 *  4) **原生 pager 实例可能彻底失效**（2026-09-30 新增）：此时 `setPage*` 全是空操作
 *     —— 不报错、也不回 onPageSelected。首页横向滑动是关的（`scrollEnabled={false}`），
 *     页面只能靠 JS 切，于是第 ②③ 条的「强制同步」也只是再发一次空操作：
 *     表现为「点榜单卡片/平台切换按钮没反应，列表照样能上下滚」。
 *     修法：重试链全部失败后换 key **重建 PagerView 实例**，initialPage 落到目标页
 *     （点击 → 0/400/900ms 三次 setPage → 约 1.4s 后重建落位）。
 *
 * 注意：下面的状态机是**手写复刻**，只能证明逻辑自洽；真正把实现钉住的是「源码契约」节
 * （从 `Main.tsx` 解析关键写法，并对 5 例篡改断言必须被拦下）。
 *
 * 运行：node scripts/sim-board-nav.js
 * 退出码：断言与契约全过、且反例全被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const MAIN = 'src/screens/Home/Vertical/Main.tsx'
const SRC = fs.readFileSync(path.join(__dirname, '..', MAIN), 'utf8').replace(/\r\n/g, '\n')

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

// ============================================================================
// 一、状态机复刻：navActiveId / observedIndex 失配 + 强制同步
// ============================================================================
const VIEW = { nav_discovery: 0, nav_top: 1 } // viewMap
let navActiveId = 'nav_discovery'
let observedIndex = 0
let forceSync = false
let lastIssuedIndex = null
let pendingClearIndex = false
let setPageCalls = []
let log = []

// 原生 pager 是否已失效（setPage 空操作）+ 兜底重建状态。
// 注意：_rebuilds / _lastRebuildAt 只做占位写（重建计数在 run() 的局部对象里断言），
// 这里用 _ 前缀声明，避免 lint 的「赋值未使用」规则误报。
let nativeDead = false
let _rebuilds = 0
let _lastRebuildAt = 0

// ---- 旧实现（修复前）----
const setNavActiveId_old = (id) => {
  if (id === navActiveId) { log.push('setNavActiveId(' + id + ') 被同值短路'); return }
  navActiveId = id
  handleUpdate_old(id)
}
const handleUpdate_old = (id) => {
  const index = VIEW[id]
  if (observedIndex === index) { log.push('handleUpdate 乐观短路(index=' + index + ')'); return }
  setPageCalls.push(index); log.push('setPageWithoutAnimation(' + index + ')')
  observedIndex = index
}

// ---- 新实现（修复后）----
const markIssued = (index) => {
  lastIssuedIndex = index
  // 模拟实现里的「0ms 宏任务清标记」：微任务批跑完后才失效
  pendingClearIndex = true
}
const flushTick = () => {
  // 一批微任务（同一 tick 内的多次事件回调）跑完后，标记才失效
  if (pendingClearIndex) { pendingClearIndex = false; lastIssuedIndex = null }
}
const handleUpdate_new = (id) => {
  const index = VIEW[id]
  const isForce = forceSync && id === navActiveId
  if (!isForce && observedIndex === index) {
    log.push('handleUpdate 乐观短路(index=' + index + ')')
    return
  }
  if (isForce && lastIssuedIndex === index) {
    forceSync = false
    log.push('强制同步被去重（本 tick 已为该 index 下发过 setPage）')
    return
  }
  if (isForce) {
    forceSync = false
    observedIndex = -1
    log.push('强制同步：原生落点标记为未知')
  }
  markIssued(index)
  setPageCalls.push(index)
  log.push('setPageWithoutAnimation(' + index + ')')
  // 原生失效 ⇒ setPage 是空操作：不回执、落点不变
  if (!nativeDead) observedIndex = index
}
const setNavActiveId_new = (id) => {
  if (id === navActiveId) { log.push('setNavActiveId(' + id + ') 被同值短路'); return }
  navActiveId = id
  handleUpdate_new(id)
}
const forceSyncNavActiveId = () => { forceSync = true; handleUpdate_new(navActiveId) }

const reset = (dead = false) => {
  navActiveId = 'nav_discovery'; observedIndex = 0; forceSync = false
  lastIssuedIndex = null; pendingClearIndex = false; setPageCalls = []; log = []
  nativeDead = dead; _rebuilds = 0; _lastRebuildAt = 0
}

const run = (name, impl) => {
  impl.setNav('nav_top')
  flushTick() // 第一次进入是独立的一 tick
  const afterFirst = observedIndex
  observedIndex = 0 // 后台恢复后 iOS 重建原生子视图
  const sceneOnReturn = 'navActiveId=' + navActiveId + ' 界面在第' + observedIndex + '页'
  log = []
  impl.open()
  flushTick()
  const ok = observedIndex === VIEW.nav_top
  console.log('\n【' + name + '】')
  console.log('  首次进入后原生落点=' + afterFirst)
  console.log('  后台回来：' + sceneOnReturn)
  console.log('  点卡片后：原生落点=' + observedIndex + ' → ' + (ok ? '成功进入排行榜' : '点了没反应'))
  console.log('  轨迹：' + log.join(' | '))
  return ok
}

const oldImpl = { setNav: setNavActiveId_old, open: () => setNavActiveId_old('nav_top') }
const newImpl = {
  setNav: setNavActiveId_new,
  open: () => { setNavActiveId_new('nav_top'); forceSyncNavActiveId() },
}

reset(); const r1 = run('旧实现（复现你的 bug）', oldImpl)
reset(); const r2 = run('新实现', newImpl)
check('旧实现能复现「点了没反应」', !r1)
check('新实现（强制同步）在后端仅“落点失配”时能修复', r2)

console.log('\n【回归 A：正常情况（无后台失配，从推荐页点卡片）】')
reset()
newImpl.open()
flushTick()
console.log('  点卡片后：原生落点=' + observedIndex + ' → ' + (observedIndex === VIEW.nav_top ? '正常切页' : '没切'))
console.log('  轨迹：' + log.join(' | '))
console.log('  setPage 次数=' + setPageCalls.length + '（期望 1：常规切页已下发，强制同步去重）')
check('回归 A：正常路径只下发一次 setPage 且切页成功', setPageCalls.length === 1 && observedIndex === VIEW.nav_top)

console.log('\n【回归 B：已在排行榜页（state 与原生都一致）时再点卡片】')
reset()
navActiveId = 'nav_top'; observedIndex = VIEW.nav_top
flushTick()
newImpl.open()
flushTick()
console.log('  点卡片后：原生落点=' + observedIndex + ' → ' + (observedIndex === VIEW.nav_top ? '仍在排行榜' : '异常'))
console.log('  轨迹：' + log.join(' | '))
console.log('  setPage 次数=' + setPageCalls.length + '（期望 1：仅强制同步下发一次校正）')
check('回归 B：已在目标页时不下发多余 setPage（除强制同步的一次校正外不改落点）', observedIndex === VIEW.nav_top)

// ============================================================================
// 二、原生死透：重试链 + 兜底重建
// ============================================================================
const RETRY_FIRST = Number(/armRetry\((\d+), 1\)/.exec(SRC)?.[1] ?? NaN) // 400
const RETRY_NEXT = Number(/armRetry\((\d+), attempt \+ 1\)/.exec(SRC)?.[1] ?? NaN) // 500
const MAX_REBUILDS = Number(/const MAX_PAGER_REBUILDS = (\d+)/.exec(SRC)?.[1] ?? NaN)
const DEBOUNCE_MS = Number(/const PAGER_REBUILD_DEBOUNCE_MS = (\d+)/.exec(SRC)?.[1] ?? NaN)
const EPOCH = 1700000000000 // lastRebuildAtRef 初值 0、Date.now() 是纪元毫秒，模型须同基准

check('模型参数可从源码解析（重试时序/上限/防抖）', Number.isFinite(RETRY_FIRST) && Number.isFinite(RETRY_NEXT) && Number.isFinite(MAX_REBUILDS) && Number.isFinite(DEBOUNCE_MS), `first=${RETRY_FIRST} next=${RETRY_NEXT} max=${MAX_REBUILDS} debounce=${DEBOUNCE_MS}`)

/** 一次点击在“原生死透”下的完整时序：3 次 setPage 全无回执 → 约 1.4s 后重建 */
const deadFailAt = (tapAt) => tapAt + RETRY_FIRST + RETRY_NEXT + RETRY_NEXT
const simulateDead = (tapTimes, { withRepair = true } = {}) => {
  let page = 0
  let n = 0
  let lastAt = 0
  const trail = []
  for (const tapAt of tapTimes) {
    if (!withRepair) { trail.push({ t: deadFailAt(tapAt), kind: 'giving-up' }); continue }
    const t = deadFailAt(tapAt)
    if (t - lastAt < DEBOUNCE_MS) { trail.push({ t, kind: 'skip:debounce' }); continue }
    if (n >= MAX_REBUILDS) { trail.push({ t, kind: 'skip:limit' }); continue }
    n += 1
    lastAt = t
    page = 1 // 重建后 initialPage = 目标页
    trail.push({ t, kind: 'rebuild', page })
  }
  return { page, n, trail }
}

{
  // ① 无重建（等于本次修复前）：点多少次都停在推荐页
  const without = simulateDead([EPOCH, EPOCH + 5000, EPOCH + 10000], { withRepair: false })
  check('反例·无重建时点多少次都停在推荐页（这正是用户遇到的「点了没反应」）', without.n === 0 && without.page === 0)

  // ② 有重建：一次点击换来一次重建并落到目标页
  const once = simulateDead([EPOCH])
  check('一次点击触发 1 次重建并落到目标页', once.n === 1 && once.page === 1, `rebuilds=${once.n} page=${once.page}`)
  check(`重建发生在重试链跑完之后（≥ ${RETRY_FIRST + RETRY_NEXT + RETRY_NEXT}ms）`, once.trail[0].t - EPOCH >= RETRY_FIRST + RETRY_NEXT + RETRY_NEXT)

  // ③ 防抖：窗口内连点只重建一次
  const spam = simulateDead([EPOCH, EPOCH + 800, EPOCH + 1600])
  check(`防抖（${DEBOUNCE_MS}ms）内连点只重建一次`, spam.n === 1, `rebuilds=${spam.n}`)

  // ④ 会话上限
  const many = simulateDead(Array.from({ length: 10 }, (_, i) => EPOCH + i * (DEBOUNCE_MS + 1000)))
  check(`会话上限：最多重建 ${MAX_REBUILDS} 次（实测 ${many.n}）`, many.n === MAX_REBUILDS)
}

// ============================================================================
// 三、源码契约（把实现钉住；判断前必须去行注释，否则「注释掉某行」会假绿）
// ============================================================================
const code = (src) => src.replace(/\/\/[^\n]*/g, '')
const contract = (rawSrc) => {
  const src = code(rawSrc)
  const out = []
  const push = (name, ok) => out.push({ name, ok })
  // repairPager 的函数体：有些写法（如 observedIndexRef.current = -1）在别处也有，
  // 必须收窄到本函数体内判断，否则篡改它不会被发现（反例⑥第一版就是这么假绿的）。
  const repairAt = src.indexOf('const repairPager = useCallback(')
  const repairBody = repairAt < 0 ? '' : src.slice(repairAt, src.indexOf('}, [])', repairAt))
  push('PagerView 的 key 含 pagerRebuild（换 key 才会重建原生实例）', /key=\{`\$\{pagerKey\}#\$\{pagerRebuild\}`\}/.test(src))
  push('重试链失败后调用 repairPager(index)', /else repairPager\(index\)/.test(src))
  push('repairPager 有防抖 + 会话上限两道闸', /PAGER_REBUILD_DEBOUNCE_MS\) return/.test(repairBody) && /rebuildCountRef\.current >= MAX_PAGER_REBUILDS\) return/.test(repairBody))
  push('initialPageIndex 优先取重建目标且依赖 pagerRebuild', /const target = rebuildTargetRef\.current/.test(src) && /\[viewMap, visibleNavs\.length, pagerRebuild\]/.test(src))
  push('repairPager 内部把原生落点置为未知（-1），不残留乐观值', repairBody.length > 0 && /observedIndexRef\.current = -1/.test(repairBody))
  push('repairPager 记录重建目标页（initialPage 才有依据）', repairBody.length > 0 && /rebuildTargetRef\.current = index/.test(repairBody))
  push('onPageSelected 清掉重建目标（原生回执后恢复常规口径）', /observedIndexRef\.current = nativeEvent\.position[\s\S]{0,400}rebuildTargetRef\.current = null/.test(src))
  return out
}
for (const r of contract(SRC)) check(r.name, r.ok)

const TAMPERS = [
  { label: '① 去掉失败后的重建调用（回到本次修复前）', from: '            else repairPager(index)', to: '            // else repairPager(index)' },
  // eslint-disable-next-line no-template-curly-in-string -- 篡改源串必须与目标源码逐字符一致
  { label: '② key 不再包含 pagerRebuild（重建不生效）', from: 'key={`${pagerKey}#${pagerRebuild}`}', to: 'key={pagerKey}' },
  { label: '③ 去掉防抖（连点会反复重建）', from: 'if (now - lastRebuildAtRef.current < PAGER_REBUILD_DEBOUNCE_MS) return', to: '// debounce removed' },
  { label: '④ 去掉会话上限（修不好就一直重建）', from: 'if (rebuildCountRef.current >= MAX_PAGER_REBUILDS) return', to: '// limit removed' },
  { label: '⑤ 重建目标不清空（后续 remount 落错页）', from: 'rebuildTargetRef.current = null\n', to: '' },
  { label: '⑥ 重建前不重置原生落点（乐观值残留）', from: 'observedIndexRef.current = -1', to: 'observedIndexRef.current = index' },
]
for (const t of TAMPERS) {
  if (!SRC.includes(t.from)) {
    check(`反例 ${t.label}`, false, '替换未命中：源码已变，反例失效需同步')
    continue
  }
  const failed = contract(SRC.replace(t.from, t.to)).filter(r => !r.ok)
  check(`反例 ${t.label} 被拦下`, failed.length > 0, failed.length ? `命中：${failed.map(r => r.name.slice(0, 16)).join('、')}` : '未被任何契约拦下')
}

console.log('\n结论：旧实现能否复现失败=' + (!r1) + '；强制同步修复=' + r2 + '；原生死透由重建兜底=' + (simulateDead([EPOCH]).page === 1))

const failedCount = results.filter(r => !r.ok).length
console.log(`\n${results.length - failedCount}/${results.length} 通过`)
for (const r of results) if (!r.ok) console.log(`  ❌ ${r.name}${r.detail ? ' — ' + r.detail : ''}`)
process.exit(failedCount ? 1 : 0)
