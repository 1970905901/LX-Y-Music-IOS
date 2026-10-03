/**
 * sim-refresh-control-initial-inset.js
 *
 * 「RefreshControl 不得被首帧程序化置为 refreshing」契约（2026-10-03）。
 *
 * 用户现象：cookie 登录网易后，首次从「我的」进入「网易歌单」，顶部会上移一下；
 * 返回再点开就正常。
 *
 * 根因：MyPlaylist 把 `RefreshControl.refreshing` 直接接在初始加载态 `loading` 上，
 * 而 `loading` 初值是 true。首次进入（无缓存、需联网拉歌单索引）时，RefreshControl 在
 * **首帧**就被程序化置为 refreshing —— iOS 立刻撑开刷新 inset 把内容顶下去，等数据到达
 * `endRefreshing` 再回弹，观感就是「顶部上移一下」；第二次进入有缓存、loading 为 false，
 * 所以正常。同族页面（TxPlaylist/KgPlaylist）一直是「loading 管首次加载、refreshing 只管
 * 用户下拉」两套状态，本页漏了。
 *
 * 断言：凡 `refreshing={<ident>}` 且该 ident 是 `useState(true)` 的页面一律失败
 * （正确写法见 TxPlaylist/KgPlaylist：独立的 refreshing，初值 false）。
 * 运行：node scripts/sim-refresh-control-initial-inset.js
 * 退出码：不变量全过、且反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SCAN_DIRS = ['src/screens', 'src/components']

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full)
  }
  return out
}

const readNorm = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

/** 文件里 refreshing={X} 用到的标识符（可能多处） */
const refreshingIdents = (src) =>
  [...src.matchAll(/refreshing=\{([A-Za-z_$][A-Za-z0-9_$]*)\}/g)].map((m) => m[1])

/** 该标识符是不是 useState(true)（首帧即为 true → 会程序化撑开刷新 inset） */
const isStateInitTrue = (src, ident) => {
  const re = new RegExp(`const\\s*\\[\\s*${ident}\\s*(?:,[^\\]]*)?\\]\\s*=\\s*useState(?:<[^>]*>)?\\(\\s*true\\s*\\)`)
  return re.test(src)
}

const realFiles = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))

const scan = (sources) => {
  const reasons = []
  for (const [file, src] of sources) {
    // 显式白名单：文件里写 `sim-refresh-ok: <原因>` 表示该处 refreshing 在挂载时恒为 false
    // （例如列表只在 loading=false 时才渲染），需要人写明理由才放行。
    if (/sim-refresh-ok:/.test(src)) continue
    for (const ident of refreshingIdents(src)) {
      if (isStateInitTrue(src, ident)) {
        reasons.push(`${path.relative(ROOT, file)}：refreshing={${ident}} 且 ${ident} 初值为 true（首帧程序化刷新 → iOS 撑开 inset → 数据到达回弹 = 「顶部上移一下」）`)
      }
    }
  }
  // MyPlaylist 额外要求：必须存在独立的 refreshing 状态，且不得再把 loading 接给 RefreshControl
  const myPlaylist = sources.find(([file]) => file.endsWith(path.join('MyPlaylist', 'index.tsx')))
  if (!myPlaylist) {
    reasons.push('未找到 MyPlaylist/index.tsx（契约锚点失效）')
  } else {
    const src = myPlaylist[1]
    if (!/const\s*\[\s*refreshing\s*,\s*setRefreshing\s*\]\s*=\s*useState\(\s*false\s*\)/.test(src)) {
      reasons.push('MyPlaylist 缺独立的 refreshing 状态（useState(false)）')
    }
    if (/refreshing=\{loading\}/.test(src)) {
      reasons.push('MyPlaylist 又把 loading 接给了 RefreshControl.refreshing')
    }
  }
  return reasons
}

const realSources = realFiles.map((f) => [f, readNorm(f)])
const realReasons = scan(realSources)

// ---------------------------------------------------------------------------
// 反例：把 MyPlaylist 改回 loading（真实历史 bug）必须被拦下
// ---------------------------------------------------------------------------
const myPlaylistPath = realFiles.find((f) => f.endsWith(path.join('MyPlaylist', 'index.tsx')))
const myPlaylistSrc = readNorm(myPlaylistPath)
const tampered = myPlaylistSrc.replace('refreshing={refreshing}', 'refreshing={loading}')
if (tampered === myPlaylistSrc) throw new Error('反例锚点未命中：refreshing={refreshing}')

const tamperedSources = realSources.map(([f, s]) => [f, f === myPlaylistPath ? tampered : s])
const tamperedReasons = scan(tamperedSources)
const counterCaught = tamperedReasons.some((r) => r.includes('loading 接给了 RefreshControl.refreshing')) ||
  tamperedReasons.some((r) => r.includes('初值为 true'))

console.log(`扫描文件：${realFiles.length}`)
console.log(`${counterCaught ? 'PASS' : 'FAIL'}  反例：MyPlaylist 把 refreshing 接回 loading —— ${counterCaught ? '已拦下' : '未拦下'}`)
console.log()

if (realReasons.length) {
  console.error(`FAIL  RefreshControl 首帧 inset 契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
}
if (!counterCaught) console.error('FAIL  反例未被拦下（断言无区分力）')
if (!realReasons.length && counterCaught) {
  console.log('PASS  RefreshControl 首帧 inset 契约通过（1 组不变量 + 1 例反例）')
  process.exit(0)
}
process.exit(1)

