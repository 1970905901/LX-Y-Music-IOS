// 时序模型：验证「播放音乐 → 放后台一段时间 → 回来 → 点排行榜卡片」这条复现路径。
// 建模三件真实事实：
//  1) setNavActiveId 有同值短路（core/common.ts:76-83）；
//  2) PagerView 的原生落点(observedIndex)与 navActiveId 是两套状态，App 从后台恢复时
//     原生落点可能被重置到 0，而 navActiveId 保持不变；
//  3) observedIndex 曾被乐观初始化，可能在未经原生确认时就「看起来等于目标」。

const VIEW = { nav_discovery: 0, nav_top: 1 } // viewMap
let navActiveId = 'nav_discovery'
let observedIndex = 0
let forceSync = false
let lastIssuedIndex = null
let pendingClearIndex = false
let setPageCalls = []
let log = []

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
  observedIndex = index
}
const setNavActiveId_new = (id) => {
  if (id === navActiveId) { log.push('setNavActiveId(' + id + ') 被同值短路'); return }
  navActiveId = id
  handleUpdate_new(id)
}
const forceSyncNavActiveId = () => { forceSync = true; handleUpdate_new(navActiveId) }

const reset = () => {
  navActiveId = 'nav_discovery'; observedIndex = 0; forceSync = false
  lastIssuedIndex = null; pendingClearIndex = false; setPageCalls = []; log = []
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

console.log('\n【回归 A：正常情况（无后台失配，从推荐页点卡片）】')
reset()
newImpl.open()
flushTick()
console.log('  点卡片后：原生落点=' + observedIndex + ' → ' + (observedIndex === VIEW.nav_top ? '正常切页' : '没切'))
console.log('  轨迹：' + log.join(' | '))
console.log('  setPage 次数=' + setPageCalls.length + '（期望 1：常规切页已下发，强制同步去重）')

console.log('\n【回归 B：已在排行榜页（state 与原生都一致）时再点卡片】')
reset()
navActiveId = 'nav_top'; observedIndex = VIEW.nav_top
flushTick()
newImpl.open()
flushTick()
console.log('  点卡片后：原生落点=' + observedIndex + ' → ' + (observedIndex === VIEW.nav_top ? '仍在排行榜' : '异常'))
console.log('  轨迹：' + log.join(' | '))
console.log('  setPage 次数=' + setPageCalls.length + '（期望 1：仅强制同步下发一次校正）')

console.log('\n结论：旧实现能否复现失败=' + (!r1) + '；新实现是否修复成功=' + r2)
