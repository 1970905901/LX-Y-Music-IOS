/**
 * sim-mylist-search-inplace.js
 *
 * 「我的收藏 / 自建列表的搜索必须是**就地过滤**，不得再割裂」契约（2026-10-03）。
 *
 * 用户现象与诉求：
 *   ① 旧搜索点下去整页卡住 → 曾一次性删掉搜索；
 *   ② 重新加回时明确要求「之前的太割裂」。旧实现的割裂在于它把搜索做成了另一个界面：
 *      页头放大镜 → 藏起页头、在页头位置盖一条输入条 → 结果另开一个浮层列表
 *      （components/SearchTipList）→ 点结果再把原列表滚到那首歌。
 *
 * 现在的形态（本脚本钉住它）：
 *   放大镜（ActiveList）→ 页头**下方普通一行**的输入条（ListSearchBar，不覆盖不浮层）
 *   → 关键字交给 List.tsx，用 listFilter.filterListMusic 过滤**同一个 FlatList 的数据源**
 *   → 结果行就是列表行本身；行号/播放/播放态高亮仍按原列表下标。
 *
 * 断言分两部分：
 *   A. 结构不变量（扫源码）：入口存在、宿主接线、输入条在布局流里、列表就地过滤、
 *      被删除的浮层文件不得复活；
 *   B. 行为模型（纯逻辑复刻）：命中语义 + **顺序保持**（就地过滤的必要条件）+
 *      空关键字原样返回；并配 3 个必须被拦下的反例（重排 / 丢字段 / 丢空态短路）
 *      与 3 个结构反例（data 改回整表 / 输入条改绝对定位 / 结果浮层复活）。
 *
 * 运行：node scripts/sim-mylist-search-inplace.js
 * 退出码：不变量全过、且所有反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

const FILES = {
  activeList: 'src/screens/Home/Views/Mylist/MusicList/ActiveList.tsx',
  musicList: 'src/screens/Home/Views/Mylist/MusicList/index.tsx',
  searchBar: 'src/screens/Home/Views/Mylist/MusicList/ListSearchBar.tsx',
  list: 'src/screens/Home/Views/Mylist/MusicList/List.tsx',
  filter: 'src/screens/Home/Views/Mylist/MusicList/listFilter.ts',
}
/** 旧链路里被删除的浮层/结果列表组件：不得复活 */
const GONE_FILES = [
  'src/screens/Home/Views/Mylist/MusicList/ListMusicSearch.tsx',
  'src/components/SearchTipList/index.tsx',
]

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const REAL = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]))

// ---------------------------------------------------------------------------
// A. 结构不变量
// ---------------------------------------------------------------------------
const structuralReasons = (files, goneFilesExist) => {
  const reasons = []

  // ① 入口：ActiveList 必须仍有放大镜按钮，且挂在 onShowSearchBar 上
  if (!/onShowSearchBar/.test(files.activeList)) {
    reasons.push('ActiveList 没有 onShowSearchBar（搜索入口不见了）')
  }
  if (!/name=["']search-2["']/.test(files.activeList)) {
    reasons.push('ActiveList 没有放大镜按钮（search-2）')
  }

  // ② 宿主：搜索条挂在页头下方，关键字以 prop 交给 List（同一条链路）
  if (!/<ListSearchBar\b/.test(files.musicList)) {
    reasons.push('MusicList/index.tsx 没有挂 ListSearchBar')
  }
  if (!/filterKeyword=\{isSearching \? searchKeyword : ''\}/.test(files.musicList)) {
    reasons.push('MusicList/index.tsx 没有把关键字（filterKeyword）交给 List —— 搜索与列表断链')
  }

  // ③ 输入条必须在布局流里：不能绝对定位盖住页头，也不能是动画浮层
  if (/position\s*:\s*['"]absolute['"]/.test(files.searchBar)) {
    reasons.push('ListSearchBar 用了 position:absolute（旧版「盖在页头位置」的割裂形态）')
  }
  if (/\bAnimated\b/.test(files.searchBar)) {
    reasons.push('ListSearchBar 引入了 Animated 浮层动画（旧版形态）')
  }

  // ④ 列表就地过滤：FlatList 的 data 必须来自过滤结果，且不能再有第二份结果列表
  if (!/import \{ filterListMusic \} from '\.\/listFilter'/.test(files.list)) {
    reasons.push('List.tsx 没有引入 listFilter.filterListMusic')
  }
  if (!/const visibleList = filterState\?\.visible \?\? currentList/.test(files.list)) {
    reasons.push('List.tsx 没有「可见列表 = 过滤结果，未过滤时才用整表」的派生')
  }
  if (!/data=\{visibleList\}/.test(files.list)) {
    reasons.push('List.tsx 的 FlatList 没有接 data={visibleList}（搜索没作用在同一个列表上）')
  }
  if (/data=\{currentList\}/.test(files.list)) {
    reasons.push('List.tsx 仍有 data={currentList}（过滤结果没进列表 / 出现了第二份列表）')
  }
  if (!/const itemIndex = d\.filterOriginalById\?\.get\(item\.id\) \?\? index/.test(files.list)) {
    reasons.push('List.tsx 没有把可见行下标换算回原列表下标（行号/播放/高亮会错位）')
  }
  if (!/if \(filterStateRef\.current\) return/.test(files.list)) {
    reasons.push('List.tsx 过滤中仍会把临时滚动位置写回整表（搜完退出会被带跑）')
  }

  // ⑤ 匹配函数必须是「不重排 + 空关键字原样返回」的纯函数
  if (!/if \(!text\) return list/.test(files.filter)) {
    reasons.push('listFilter 空关键字没有原样返回原数组（未过滤态无法判定，列表会被重建）')
  }
  if (!/return list\.filter\(/.test(files.filter)) {
    reasons.push('listFilter 没有用 list.filter 保持原顺序')
  }

  // ⑥ 旧浮层组件不得复活
  for (const [rel, exists] of goneFilesExist) {
    if (exists) reasons.push(`${rel} 又出现了（旧的结果浮层/独立结果列表）`)
  }

  return reasons
}

const goneExists = GONE_FILES.map((rel) => [rel, fs.existsSync(path.join(ROOT, rel))])
const realReasons = structuralReasons(REAL, goneExists)

// ---------------------------------------------------------------------------
// B. 行为模型（复刻 listFilter.ts 的语义；用于验证「顺序保持」这类不能靠正则说清的性质）
// ---------------------------------------------------------------------------
const isOrderedMatch = (text, target) => {
  if (!text) return true
  let ti = 0
  for (let i = 0; i < target.length && ti < text.length; i++) {
    if (target[i] === text[ti]) ti++
  }
  return ti === text.length
}

/** 新实现（= listFilter.ts 的语义） */
const filterListMusic = (list, keyword) => {
  const text = String(keyword).trim().toLowerCase()
  if (!text) return list
  return list.filter((info) => {
    const name = String(info.name ?? '').toLowerCase()
    const singer = String(info.singer ?? '').toLowerCase()
    const albumName = String((info.meta && info.meta.albumName) ?? '').toLowerCase()
    if (name.includes(text) || singer.includes(text) || albumName.includes(text)) return true
    return isOrderedMatch(text, name + singer + albumName)
  })
}

/** 旧实现形态的简化复刻：命中字段分组 + 相似度重排（会打乱原顺序） */
const filterListMusicReordered = (list, keyword) => {
  const text = String(keyword).trim().toLowerCase()
  const byName = list.filter((m) => String(m.name ?? '').toLowerCase().includes(text))
  const bySinger = list.filter((m) => String(m.singer ?? '').toLowerCase().includes(text))
  const others = list.filter((m) => !byName.includes(m) && !bySinger.includes(m))
  return [...byName, ...bySinger, ...others]
}

const mk = (i, extra = {}) => ({
  id: `wy_${i}`,
  name: `歌曲${i}`,
  singer: `歌手${i % 7}`,
  meta: { albumName: `专辑${i % 5}` },
  ...extra,
})

const list = [
  mk(0, { name: '晴天', singer: '周杰伦', meta: { albumName: '叶惠美' } }),
  mk(1, { name: 'Hello World', singer: 'ADELE', meta: { albumName: '25' } }),
  mk(2, { name: '稻香', singer: '周杰伦', meta: { albumName: '魔杰座' } }),
  mk(3, { name: '默', singer: '那英', meta: { albumName: '最美和声' } }),
  mk(4, { name: 'Lemon', singer: '米津玄師', meta: { albumName: 'BOOTLEG' } }),
  mk(5, { name: '七里香', singer: '周杰伦', meta: { albumName: '七里香' } }),
]

const orderPreserved = (source, result) => {
  let last = -1
  for (const item of result) {
    const at = source.indexOf(item)
    if (at <= last) return false
    last = at
  }
  return true
}

const names = (arr) => arr.map((m) => m.name)

const modelChecks = () => {
  const out = []
  const check = (name, pass, detail) => out.push({ name, pass, detail })

  // 命中语义：歌名 / 歌手 / 专辑 / 大小写不敏感
  check('歌名命中', names(filterListMusic(list, '晴天')).join() === '晴天')
  check('歌手命中（返回全部同歌手，保持原序）', names(filterListMusic(list, '周杰伦')).join() === '晴天,稻香,七里香')
  check('专辑名命中', names(filterListMusic(list, '魔杰座')).join() === '稻香')
  check('大小写不敏感', names(filterListMusic(list, 'hello')).join() === 'Hello World')

  // 模糊档：关键字字符按顺序出现即命中
  check('模糊（顺序字符）命中', names(filterListMusic(list, 'lmn')).includes('Lemon'))
  check('模糊（乱序）不命中', !names(filterListMusic(list, 'nml')).includes('Lemon'))

  // 就地过滤的必要条件：结果必须是原列表的子序列（顺序 + 行号映射都靠它）
  const wide = Array.from({ length: 200 }, (_, i) => mk(i))
  wide[37] = mk(37, { name: 'zzz 目标歌 zzz' })
  const hit = filterListMusic(wide, '目标')
  check('顺序保持（子序列）', orderPreserved(wide, hit) && hit.length === 1)
  // 就地过滤必须幂等：对结果再过滤同一关键字，集合与顺序都不变
  const once = filterListMusic(wide, '歌手3')
  const twice = filterListMusic(once, '歌手3')
  check('就地过滤幂等（再过滤一次集合不变）', names(twice).join() === names(once).join())
  // 原列表下标可从结果反查（= List.tsx 的 originalById 语义）
  const singerHit = filterListMusic(wide, '歌手3')
  check(
    '命中行仍能反查原列表下标',
    singerHit.every((m) => wide[wide.indexOf(m)] === m && wide.indexOf(m) >= 0),
  )

  // 空关键字：必须原样返回入参（List.tsx 用 `filterState == null` 判定「未过滤」）
  check('空关键字原样返回同一数组', filterListMusic(list, '') === list)
  check('纯空白关键字原样返回同一数组', filterListMusic(list, '   ') === list)

  // ---- 反例（必须被拦下）----
  const reordered = filterListMusicReordered(list, '周杰伦')
  check('反例：按字段重排（旧行为）会被「顺序保持」拦下', !orderPreserved(list, reordered), `重排后=${names(reordered).join()}`)

  const noAlbum = (src, kw) => {
    const text = String(kw).trim().toLowerCase()
    return src.filter((info) => String(info.name ?? '').toLowerCase().includes(text) ||
      String(info.singer ?? '').toLowerCase().includes(text))
  }
  check('反例：丢掉专辑名匹配会被拦下', names(noAlbum(list, '魔杰座')).length === 0)

  const noShortCircuit = (src, kw) => {
    const text = String(kw).trim().toLowerCase()
    return src.filter(() => isOrderedMatch(text, ''))
  }
  check('反例：丢掉空关键字短路会重建数组', noShortCircuit(list, '') !== list)

  return out
}

const modelOut = modelChecks()
const modelFailed = modelOut.filter((c) => !c.pass)

// ---------------------------------------------------------------------------
// 结构反例：3 个真实历史形态，必须被拦下
// ---------------------------------------------------------------------------
const counterCases = []

{
  const tampered = {
    ...REAL,
    list: REAL.list.replace('data={visibleList}', 'data={currentList}'),
  }
  const caught = structuralReasons(tampered, goneExists).some((r) => r.includes('data={currentList}'))
  counterCases.push(['List.tsx 的 data 改回整表（搜索不进列表）', caught])
}
{
  const tampered = {
    ...REAL,
    searchBar: REAL.searchBar + "\nconst overlay = { position: 'absolute', left: 0, top: 0 }\n",
  }
  const caught = structuralReasons(tampered, goneExists).some((r) => r.includes('position:absolute'))
  counterCases.push(['ListSearchBar 改回绝对定位浮层', caught])
}
{
  const tampered = {
    ...REAL,
    musicList: REAL.musicList.replace(
      "import ActiveList, { type ActiveListType } from './ActiveList'",
      "import ActiveList, { type ActiveListType } from './ActiveList'\nimport ListMusicSearch from './ListMusicSearch'",
    ),
  }
  const tamperedGone = goneExists.map(([rel, exists]) => [rel, exists || rel.includes('ListMusicSearch')])
  const caught = structuralReasons(tampered, tamperedGone).some((r) => r.includes('ListMusicSearch'))
  counterCases.push(['结果浮层 ListMusicSearch 复活', caught])
}

const counterFailed = counterCases.filter(([, caught]) => !caught)

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------
console.log('就地搜索行为模型（listFilter 语义）')
for (const c of modelOut) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` —— ${c.detail}` : ''}`)
}
console.log('')
console.log('结构反例自检')
for (const [name, caught] of counterCases) {
  console.log(`${caught ? 'PASS' : 'FAIL'}  ${name} —— ${caught ? '已拦下' : '未拦下'}`)
}
console.log('')

let failed = 0
if (realReasons.length) {
  console.error(`FAIL  「就地搜索」结构契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
  failed++
}
if (modelFailed.length) {
  console.error(`FAIL  行为模型未通过（${modelFailed.length} 项）`)
  failed++
}
if (counterFailed.length) {
  console.error(`FAIL  有反例未被拦下（${counterFailed.length} 项，断言无区分力）`)
  failed++
}

if (!failed) {
  console.log(
    `PASS  我的收藏/自建列表搜索=就地过滤（结构不变量 6 组 + 行为模型 ${modelOut.length} 例 + 结构反例 ${counterCases.length} 例，全部通过）`,
  )
  process.exit(0)
}
process.exit(1)
