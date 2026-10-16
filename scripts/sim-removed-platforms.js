/**
 * sim-removed-platforms.js
 *
 * 「已下线平台（Gitcode / 汽水音乐）不得再出现在任何平台入口」契约。
 *
 * 背景（用户要求，2026-10-16 真机截图三处）：
 *   ① 列表设置 →「推荐页平台按钮排序」里还有 Gitcode
 *   ② 歌单页顶部平台胶囊里还有 Gitcode / 汽水音乐
 *   ③ 搜索设置 →「启用搜索平台」里还有 Git
 * 这三处（以及推荐页按钮、榜单页、搜索/热搜平台、深链搜索）共用同一份「平台枚举」——
 * `src/utils/musicSdk/index.js` 的 `sources.sources` 数组。把 git / qs 从枚举里拿掉，
 * 所有入口一起消失，不必在每个页面各写一份过滤名单（少一份名单就少一处漂移）。
 *
 * 契约守护四件事：
 *   1) 枚举数组里不得再出现 `id: 'git'` / `id: 'qs'`（注释掉的旧条目不算，先剥注释）；
 *   2) 搜索设置的平台清单（SearchSourceFilter.SOURCE_LIST）不得含 git；
 *   3) 深链搜索的平台白名单（searchAction.ts）不得含 git；
 *   4) 歌单页必须有「当前平台已下线」兜底（回退到首个可用平台并纠正存储），否则会卡在
 *      「顶部胶囊没有选中项、列表却仍是已下线平台内容」的半死状态。
 * 另：SDK 与 registry（`git,` / `qs: qishui,`）必须保留 —— 老歌单、老链接里的歌仍要能
 * 取链播放（取链走 musicSdk[source]，与枚举无关），所以本契约只查「枚举」而不是整个 SDK。
 *
 * 运行：node scripts/sim-removed-platforms.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  sdk: 'src/utils/musicSdk/index.js',
  searchFilter: 'src/screens/Home/Views/Setting/settings/Search/SearchSourceFilter.tsx',
  songlistContent: 'src/screens/Home/Views/SongList/Content.tsx',
  deeplink: 'src/core/init/deeplink/searchAction.ts',
  defaults: 'src/config/defaultSetting.ts',
}
const REMOVED = ['git', 'qs']
// 枚举里必须保留的其它平台：防「一刀切」把别的平台也删掉
const KEPT = ['kw', 'kg', 'tx', 'wy', 'mg', 'bilibili']

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

// 剥注释（保留字符串字面量）：注释里说明「哪个平台被拿掉了」不算违规
const stripComments = (src) => {
  let out = ''
  let i = 0
  let inBlock = false
  let inLine = false
  let quote = null
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (inLine) {
      if (c === '\n') { inLine = false; out += '\n' }
      i++
      continue
    }
    if (inBlock) {
      if (c === '*' && n === '/') { inBlock = false; i += 2; continue }
      out += c === '\n' ? '\n' : ' '
      i++
      continue
    }
    if (quote) {
      out += c
      if (c === '\\') { out += n === undefined ? '' : n; i += 2; continue }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '/' && n === '/') { inLine = true; i += 2; continue }
    if (c === '/' && n === '*') { inBlock = true; i += 2; continue }
    if (c === '"' || c === "'") quote = c
    out += c
    i++
  }
  return out
}

// 平台枚举数组（sources: [ … ]）里的 id 清单
const extractEnumIds = (code) => {
  const start = code.indexOf('sources: [')
  if (start < 0) return null
  const end = code.indexOf('],', start)
  const region = code.slice(start, end < 0 ? undefined : end)
  return [...region.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1])
}

const checkAll = ({ sdk, searchFilter, songlistContent, deeplink, defaults }) => {
  const violations = []
  const code = stripComments(sdk)
  const ids = extractEnumIds(code)

  // ① 枚举里不得再有已下线平台
  if (ids === null) {
    violations.push({ rule: 'enum', where: FILES.sdk, detail: '找不到平台枚举数组 sources: [ … ]' })
  } else {
    for (const id of REMOVED) {
      if (ids.includes(id)) {
        violations.push({ rule: 'enum', where: FILES.sdk, detail: `平台枚举里仍有 id: '${id}'（平台入口会重新出现）` })
      }
    }
    for (const id of KEPT) {
      if (!ids.includes(id)) {
        violations.push({ rule: 'enum-kept', where: FILES.sdk, detail: `平台枚举里缺少 ${id}（下线平台不能连带别的平台一起删）` })
      }
    }
  }

  // ② SDK / registry 保留（老数据取链兜底）
  if (!/(^|\n)\s*git,/.test(code)) {
    violations.push({ rule: 'registry', where: FILES.sdk, detail: 'musicSdk 注册表里缺少 git（老歌单里的 Gitcode 歌会取链失败）' })
  }
  if (!/qs:\s*qishui,/.test(code)) {
    violations.push({ rule: 'registry', where: FILES.sdk, detail: 'musicSdk 注册表里缺少 qs: qishui（老歌单里的汽水歌会取链失败）' })
  }

  // ③ 搜索设置的平台清单
  const searchCode = stripComments(searchFilter)
  for (const id of REMOVED) {
    if (new RegExp(`id:\\s*'${id}'`).test(searchCode)) {
      violations.push({ rule: 'search-list', where: FILES.searchFilter, detail: `启用搜索平台清单里仍有 ${id}` })
    }
  }
  // ④ 深链搜索白名单
  const deeplinkCode = stripComments(deeplink)
  for (const id of REMOVED) {
    if (deeplinkCode.includes(`'${id}'`)) {
      violations.push({ rule: 'deeplink', where: FILES.deeplink, detail: `深链搜索白名单里仍有 ${id}` })
    }
  }
  // ⑤ 歌单页兜底
  const songlistCode = stripComments(songlistContent)
  if (!/if\s*\(\s*!songlistState\.sources\.includes\(/.test(songlistCode)) {
    violations.push({ rule: 'songlist-fallback', where: FILES.songlistContent, detail: '歌单页缺少「当前平台已下线 → 回退到可用平台」兜底' })
  }
  if (!/saveSongListSetting\(\{/.test(songlistCode)) {
    violations.push({ rule: 'songlist-fallback', where: FILES.songlistContent, detail: '歌单页兜底没有把纠正后的平台写回存储' })
  }
  // ⑥ 搜索默认勾选
  const defaultsCode = stripComments(defaults)
  const enabled = /'search\.enabledSources':\s*\{([^}]*)\}/.exec(defaultsCode)
  if (!enabled) {
    violations.push({ rule: 'search-default', where: FILES.defaults, detail: "找不到 'search.enabledSources' 默认值" })
  } else {
    for (const id of REMOVED) {
      if (new RegExp(`(^|[\\s,{])${id}:`).test(enabled[1])) {
        violations.push({ rule: 'search-default', where: FILES.defaults, detail: `搜索平台默认勾选里仍有 ${id}` })
      }
    }
  }
  return violations
}

const REAL = {
  sdk: read(FILES.sdk),
  searchFilter: read(FILES.searchFilter),
  songlistContent: read(FILES.songlistContent),
  deeplink: read(FILES.deeplink),
  defaults: read(FILES.defaults),
}

const codeOfSdk = stripComments(REAL.sdk)
const realIds = extractEnumIds(codeOfSdk) ?? []
const models = [
  ['枚举去掉 git/qs → 由它派生的平台清单（推荐页/歌单页/榜单页/搜索/热搜/设置）同时不含这两个平台',
    !realIds.includes('git') && !realIds.includes('qs')],
  ['其余平台一个不少（下线两个平台不会连带清掉别的入口）',
    KEPT.every((id) => realIds.includes(id))],
  ['注册表保留 git/qs → 老歌单/老链接里的歌仍能取链播放',
    /(^|\n)\s*git,/.test(codeOfSdk) && /qs:\s*qishui,/.test(codeOfSdk)],
]

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

expectCaught('C1 把 Gitcode 加回平台枚举', 'enum', (v) => ({
  sdk: v.sdk.replace("      id: 'bilibili',\n", "      id: 'bilibili',\n    },\n    {\n      name: 'Gitcode',\n      id: 'git',\n"),
}))
expectCaught('C2 把汽水音乐加回平台枚举', 'enum', (v) => ({
  sdk: v.sdk.replace("      id: 'bilibili',\n", "      id: 'bilibili',\n    },\n    {\n      name: '汽水音乐',\n      id: 'qs',\n"),
}))
expectCaught('C3 删掉注册表里的 git 兜底', 'registry', (v) => ({ sdk: v.sdk.replace(/\n {2}git,/, '') }))
expectCaught('C4 把 Git 加回搜索设置清单', 'search-list', (v) => ({
  searchFilter: v.searchFilter.replace("  { id: 'all', i18nKey: 'source_all' },", "  { id: 'git', i18nKey: 'source_git' },\n  { id: 'all', i18nKey: 'source_all' },"),
}))
expectCaught('C5 把 git 加回深链搜索白名单', 'deeplink', (v) => ({
  deeplink: v.deeplink.replace("const validSources = ['kw', 'kg', 'tx', 'wy', 'mg', 'bilibili']", "const validSources = ['kw', 'kg', 'tx', 'wy', 'mg', 'bilibili', 'git']"),
}))
expectCaught('C6 去掉歌单页的已下线平台兜底', 'songlist-fallback', (v) => ({
  songlistContent: v.songlistContent.replace('!songlistState.sources.includes(source)', 'false'),
}))
expectCaught('C7 把 git 加回搜索默认勾选', 'search-default', (v) => ({
  defaults: v.defaults.replace('bilibili: true, all: true', 'bilibili: true, git: true, all: true'),
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
  console.error(`FAIL  平台入口下线契约未通过：违例 ${violations.length} 项、模型失败 ${failedModels.length} 例、反例漏检 ${missed.length} 例`)
  process.exit(1)
}
console.log(`PASS  已下线平台（Gitcode / 汽水音乐）不再出现在任何平台入口，且老数据仍可取链（规则 6 条 + 行为模型 ${models.length} 例 + 反例 ${counterExamples.length} 例）`)
process.exit(0)
