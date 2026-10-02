/**
 * 播放详情（竖屏）「屏幕常亮」范围 —— 耗电契约（2026-10-03）。
 *
 * 背景：竖屏播放详情是 PagerView：第 0 页封面、第 1 页歌词。设计上**只有歌词页**需要
 * 屏幕常亮（`idleTimerDisabled`），封面页不需要 —— onPageSelected 与 AppState 的
 * active 分支都按「是否在歌词页」判定。
 *
 * 但 `componentIdsUpdated`（每次压栈/返回都会广播，见 store/common/action.ts 的
 * setComponentId / removeComponentId）的处理器是无条件 `screenkeepAwake()`：
 *   - 停在封面页时，只要发生一次导航栈变化（比如看歌手页再返回），常亮就被打开；
 *   - 此后没有任何路径会释放它（除非滑到歌词页再滑回来 / 退后台 / 退出该页）。
 * 结果：屏幕不再自动熄灭。**灭屏时间才是整机耗电的大头**，这属于实打实的漏电，
 * 且 tsc/eslint 完全无感（语法、类型都对，只是判定条件漏了一层）。
 *
 * 注：横向（iPad 横屏）详情页封面与歌词同屏，常亮是有意设计，不在本契约范围内。
 *
 * 运行：node scripts/sim-screen-keep-awake-scope.js
 * 退出码：不变量全过、且全部反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const VERTICAL = 'src/screens/PlayDetail/Vertical/VerticalNew.tsx'
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const real = read(VERTICAL)

/** 取 componentIdsUpdated 的处理器体（从声明处到其收尾 `}` 行） */
const sliceHandler = (src) => {
  const at = src.indexOf('const handleComponentIdsChange')
  if (at < 0) return ''
  const end = src.indexOf('global.state_event.on(\'componentIdsUpdated\'', at)
  return end > at ? src.slice(at, end) : src.slice(at, at + 600)
}

/** 取 onPageSelected 的函数体 */
const slicePageSelected = (src) => {
  const at = src.indexOf('const onPageSelected')
  if (at < 0) return ''
  const end = src.indexOf('// 在 PagerView 滑动过程中检测方向', at)
  return end > at ? src.slice(at, end) : src.slice(at, at + 600)
}

const invariants = (src) => {
  const reasons = []
  const handler = sliceHandler(src)
  const pageSelected = slicePageSelected(src)

  if (!handler) {
    reasons.push('找不到 componentIdsUpdated 处理器（契约失效，请同步更新锚点）')
    return reasons
  }

  // ① 导航栈变化时的常亮判定必须包含「是否在歌词页」
  if (!/showLyricRef\.current/.test(handler)) {
    reasons.push('导航栈变化时无条件 screenkeepAwake（封面页也会被常亮 → 屏幕永不息屏）')
  }
  // ①b 非歌词页（或评论页）必须走释放分支
  if (!/screenUnkeepAwake\(\)/.test(handler)) {
    reasons.push('导航栈变化时没有释放分支（常亮一旦打开无人释放）')
  }
  // ①c 不允许出现「无条件的 screenkeepAwake」写法：出现即说明判定被抹掉
  if (/else\s+screenkeepAwake\(\)/.test(handler)) {
    reasons.push('导航栈变化处存在无条件 screenkeepAwake（判定被架空）')
  }

  // ② 页切换仍按「歌词页 → 常亮 / 封面页 → 释放」
  if (!/showLyricRef\.current\s*=\s*nativeEvent\.position\s*===\s*1/.test(pageSelected)) {
    reasons.push('onPageSelected 未记录当前是否歌词页')
  }
  if (!/if\s*\(showLyricRef\.current\)\s*\{\s*screenkeepAwake\(\)\s*\}\s*else\s*\{\s*screenUnkeepAwake\(\)\s*\}/.test(pageSelected)) {
    reasons.push('onPageSelected 不再按歌词页/封面页分派常亮')
  }

  // ③ 退后台必须释放（锁屏播放时不该再占着常亮）
  if (!/case 'background':\s*screenUnkeepAwake\(\)/.test(src)) {
    reasons.push('退后台未释放常亮')
  }
  // ④ 卸载必须释放（离开详情页后不残留 idleTimerDisabled）
  if (!/return \(\) => \{[\s\S]{0,400}?screenUnkeepAwake\(\)/.test(src)) {
    reasons.push('组件卸载未释放常亮（离开详情页后可能残留）')
  }

  return reasons
}

const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.split(find).join(replace)
}

const runCounterExamples = () => {
  const results = []
  const check = (name, src, expectSubstr) => {
    let reasons = []
    try {
      reasons = invariants(src)
    } catch (e) {
      results.push({ name, ok: false, detail: `抛异常: ${e.message}` })
      return
    }
    const hit = reasons.some(r => r.includes(expectSubstr))
    results.push({ name, ok: hit, detail: hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）` })
  }

  check('R1 回退成无条件常亮（原漏电实现）', tamper(real,
    "      if (ids.find(item => item.name === COMPONENT_IDS.comment) || !showLyricRef.current) {\n        screenUnkeepAwake()\n      } else if (AppState.currentState === 'active') {\n        screenkeepAwake()\n      }",
    "      if (ids.find(item => item.name === COMPONENT_IDS.comment)) screenUnkeepAwake()\n      else if (AppState.currentState === 'active') screenkeepAwake()"),
  '导航栈变化时无条件 screenkeepAwake')

  check('R2 判定丢掉「是否歌词页」', tamper(real,
    '|| !showLyricRef.current) {',
    ') {'),
  '导航栈变化时无条件 screenkeepAwake')

  check('R3 页切换不再释放常亮', tamper(real,
    '    if (showLyricRef.current) {\n      screenkeepAwake()\n    } else {\n      screenUnkeepAwake()\n    }',
    '    if (showLyricRef.current) screenkeepAwake()'),
  'onPageSelected 不再按歌词页/封面页分派常亮')

  check('R4 退后台不再释放', tamper(real,
    "        case 'background':\n          screenUnkeepAwake()\n          break",
    "        case 'background':\n          break"),
  '退后台未释放常亮')

  return results
}

const realReasons = invariants(real)
const ce = runCounterExamples()

console.log('=== sim-screen-keep-awake-scope ===\n')
console.log('[源码不变量]')
if (realReasons.length === 0) console.log('  PASS 竖屏详情页常亮范围正确（只有歌词页常亮 / 退后台与卸载都释放）')
else realReasons.forEach(r => console.log('  FAIL ' + r))

console.log('\n[反例自检]')
ce.forEach(r => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name} —— ${r.detail}`))

const failed = realReasons.length + ce.filter(r => !r.ok).length
console.log(`\n结果：${failed ? `有 ${failed} 项失败` : 'ALL PASS'}（不变量 ${realReasons.length === 0 ? '1/1' : '有失败'}；反例 ${ce.filter(r => r.ok).length}/${ce.length}）`)
process.exit(failed ? 1 : 0)
