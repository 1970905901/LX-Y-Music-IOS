/**
 * sim-glass-dark-contract.js
 *
 * 玻璃「App 主题明暗」+「液态玻璃开关」两条跨层链路的契约检查。
 *
 * 为什么需要它：这些链路从 JS 一路走到原生材质，跨了 4 个层（TSX → TS 组件 →
 * RN bridge prop → ObjC 宿主 → Swift backing），其中**只有前两层受 tsc/eslint 保护**。
 * 原生侧的 prop 名、selector 名不在 TS 类型体系里，写错或整条删掉，两个基线口径
 * 都是绿的。这些缺陷真实发生过：
 *   - dark 链路：73c2e9c 把玻璃改成纯染色覆层时删掉了它（当时确实不需要），
 *     后续恢复系统材质时没有恢复，结果是「App 深色 + 系统浅色」下材质渲染成
 *     亮色磨砂，与整体配色相反，而 tsc/eslint 全过。
 *   - liquid 链路（本次新增检查）：theme.liquidGlass 设置 → JS liquid prop →
 *     ObjC 宿主重建背衬 → Swift 工厂双形态选路 → vendored Metal 液态玻璃。
 *     同样只有前两层受 tsc 保护，桥接断裂会静默回退到磨砂。
 *
 * 另含「设置项文案分档」契约（2026-09-30 新增，不变量 4~5）：主题页液态玻璃开关
 * 下方的说明文案是对用户的**分档承诺**，分档点来自原生 `#available(iOS 26.2, *)`、
 * 下限来自 Podfile 的 deployment target。文案与这两处没有任何编译期/运行期联系 ——
 * 原生守卫调档、或部署版本上调，文案就静默变成假话而全绿。故一并守。
 *
 * 另含「vendored 宿主头注释」契约（2026-09-30 新增，不变量 6~7）：LiquidGlassViewManager.mm
 * 文件头的 Usage contract 是对调用方的**材质承诺**，事实源同样在工厂的 #available 分档
 * 与磨砂档的 preferNativeGlassOnIOS26 开关里。分档落地后这段注释会静默过时（真实发生过：
 * 26.2+ 分档已生效，头注释仍写着「磨砂 = iOS 26+ UIGlassEffect」「liquid=true = vendored
 * Metal（全版本）」，与工厂正好相反，读桥接层的人会被误导）。
 *
 * 另含「26.2+ 液态玻璃门控」契约（2026-09-30 新增，不变量 8~9）：UIGlassEffect(.regular)
 * 在白底/图底页面切换瞬间闪烁（Tab 切换即复现），定案 26.2+ 强制系统磨砂、设置页隐藏
 * 液态玻璃开关、只留玻璃不透明度滑杆（14~26.1 不变）。该契约横跨 6 个文件（tools 版本
 * 判定 → LiquidGlass 组件兜底 → Toggle 隐藏 → ThemeScreen 滑杆常显 → ModernTabBar /
 * PlayerBar 消费点门控），任何一处被删/被改，26.2+ 用户就会重新看到闪烁或看到失效开关，
 * 而 tsc/eslint 全绿（theme.liquidGlass 的读取是合法 TS，版本门控是否在场无类型约束）。
 *
 * 检查的是**契约的存在与贯通**，不是观感——观感只能真机看。
 * 不变量（1~9）必过，退出码据此。
 *
 * 运行：node scripts/sim-glass-dark-contract.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

const FILES = {
  swift: 'ios/Vendor/LiquidGlassKit/Sources/LGGlassViewFactory.swift',
  mm: 'ios/Vendor/LiquidGlassKit/Sources/LiquidGlassViewManager.mm',
  comp: 'src/components/common/LiquidGlass.tsx',
}

/** 契约规则：每一层必须存在的片段 */
const RULES = [
  // ---- dark 链路（App 主题明暗 → 系统动态材质）----
  {
    id: 'swift-def',
    file: 'swift',
    test: (s) => /var isDarkMode\s*:\s*Bool/.test(s),
    desc: 'Swift backing 定义 isDarkMode 属性',
    hint: 'LGFrostedGlassView 缺 isDarkMode，原生无法接收 App 明暗',
  },
  {
    id: 'swift-apply',
    file: 'swift',
    count: (s) => (s.match(/overrideUserInterfaceStyle\s*=\s*isDarkMode/g) || []).length,
    min: 2,
    desc: 'Swift 在 init 与重建两处都把明暗应用到材质视图',
    hint: '至少要有 init（首帧）与 rebuildEffectView（切换主题）两处；少一处则某条路径下明暗不跟随',
  },
  {
    id: 'swift-rebuild',
    file: 'swift',
    test: (s) => /func rebuildEffectView\s*\(/.test(s),
    desc: 'Swift 提供材质重建入口（UIVisualEffectView 不支持事后改 overrideUserInterfaceStyle）',
    hint: '没有重建入口，主题切换后材质会保持旧明暗',
  },
  {
    id: 'mm-prop',
    file: 'mm',
    test: (s) => /RCT_CUSTOM_VIEW_PROPERTY\(\s*dark\s*,/.test(s),
    desc: 'ObjC 宿主暴露 dark prop（否则 JS 传了就丢）',
    hint: '缺 dark prop：bridge 静默丢弃该 prop，JS 侧完全看不出',
  },
  {
    id: 'mm-setter',
    file: 'mm',
    test: (s) => /setIsDarkMode\s*:/.test(s),
    desc: 'ObjC 调用 setIsDarkMode:（Swift `var isDarkMode: Bool` 的导出 setter 名）',
    hint: 'selector 名写错时 respondsToSelector 守卫会静默 return，不报错也不生效',
  },
  {
    id: 'comp-decl',
    file: 'comp',
    test: (s) => /dark\?\s*:\s*boolean/.test(s),
    desc: 'JS 组件声明 dark prop',
    hint: 'LiquidGlass 缺 dark 声明，调用方传了也透传不到原生',
  },
  {
    id: 'comp-pass',
    file: 'comp',
    test: (s) => /dark=\{dark\}/.test(s),
    desc: 'JS 组件把 dark 透传到原生组件',
    hint: '声明了但没透传，等于没接',
  },
  // ---- liquid 链路（theme.liquidGlass → 双形态背衬切换）----
  {
    id: 'swift-liquid-entry',
    file: 'swift',
    test: (s) => /createGlassBacking\(dark:\s*Bool,\s*liquid:\s*Bool\)/.test(s),
    desc: 'Swift 工厂提供带 liquid 参数的双形态背衬入口',
    hint: '缺双形态入口：磨砂/液态无法切换（ObjC 侧导出名为 createGlassBackingWithDark:liquid:）',
  },
  {
    id: 'swift-liquid-metal',
    file: 'swift',
    test: (s) => /LiquidGlassEffect\(style:\s*\.regular,\s*isNative:\s*false\)/.test(s),
    desc: 'Swift 液态分支创建 vendored Metal 玻璃（LiquidGlassEffectView + .regular 预设）',
    hint: '液态分支缺失：开关打开也不会出现折射玻璃',
  },
  {
    id: 'mm-prop-liquid',
    file: 'mm',
    test: (s) => /RCT_CUSTOM_VIEW_PROPERTY\(\s*liquid\s*,/.test(s),
    desc: 'ObjC 宿主暴露 liquid prop（切换时重建背衬并重放缓存属性）',
    hint: '缺 liquid prop：JS 开关传了也丢，永远停在磨砂',
  },
  {
    id: 'mm-liquid-entry',
    file: 'mm',
    test: (s) => /createGlassBackingWithDark:\s*\w+\s+liquid:/.test(s),
    desc: 'ObjC 宿主持有双形态工厂入口（init 与 liquid 切换都经它建背衬）',
    hint: '宿主不经工厂建背衬：磨砂/液态切换断线，JS 开关传了也回退磨砂',
  },
  {
    id: 'comp-decl-liquid',
    file: 'comp',
    test: (s) => /liquid\?\s*:\s*boolean/.test(s),
    desc: 'JS 组件声明 liquid prop',
    hint: 'LiquidGlass 缺 liquid 声明，调用方传了也透传不到原生',
  },
  {
    id: 'comp-pass-liquid',
    file: 'comp',
    test: (s) => /liquid=\{effectiveLiquid\}/.test(s),
    desc: 'JS 组件把 liquid 门控后透传到原生组件（26.2+ 强制 false）',
    hint: '直接透传 liquid={liquid} 会绕过 26.2+ 强制磨砂兜底（UIGlassEffect 闪烁问题）',
  },
]

/** 递归收集 src 下所有 tsx（跳过 node_modules） */
function collectTsx(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (name !== 'node_modules') collectTsx(p, out)
    } else if (name.endsWith('.tsx')) {
      out.push(p)
    }
  }
  return out
}

/**
 * 调用点检查：每个真正渲染 <LiquidGlass 的地方都必须传 dark **和** liquid。
 * 注意排除 `<LiquidGlassProps` / `<LiquidGlassNativeProps` 这类泛型类型名
 * （它们的 `<` 后面紧跟类型名，不是 JSX 开标签）。
 */
function checkCallSites(sources) {
  const problems = []
  let callSites = 0
  for (const [file, text] of sources) {
    text.split('\n').forEach((line, i) => {
      // JSX 开标签：<LiquidGlass 后必须紧跟空白、'{'、'>' 或 '/'（不是类型名的大写字母延续）
      if (!/<LiquidGlass(?![A-Za-z])/.test(line)) return
      callSites++
      if (!/dark=\{/.test(line)) {
        problems.push({ id: 'call-site', where: `${file}:${i + 1}`, desc: '<LiquidGlass 调用点未传 dark', hint: line.trim() })
      }
      if (!/liquid=\{/.test(line)) {
        problems.push({ id: 'call-site', where: `${file}:${i + 1}`, desc: '<LiquidGlass 调用点未传 liquid', hint: line.trim() })
      }
    })
  }
  return { problems, callSites }
}

function run(sources) {
  const problems = []
  const map = new Map(sources)
  for (const rule of RULES) {
    const text = map.get(FILES[rule.file])
    if (text == null) {
      problems.push({ id: rule.id, where: FILES[rule.file], desc: `文件不存在：${rule.desc}`, hint: '' })
      continue
    }
    const ok = rule.count ? rule.count(text) >= rule.min : rule.test(text)
    if (!ok) problems.push({ id: rule.id, where: FILES[rule.file], desc: rule.desc, hint: rule.hint })
  }
  return problems
}

// ---------------------------------------------------------------------------

const sources = Object.values(FILES).map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')])

const checks = []
const check = (name, pass, detail) => checks.push({ name, pass, detail })

console.log('玻璃「App 主题明暗」+「液态玻璃开关」跨层契约检查\n')

// --- 不变量 1~3：链路贯通 ---
const problems = run(sources)
check(
  '不变量1 四层契约片段齐备（dark 链路 7 条 + liquid 链路 6 条规则全部命中）',
  problems.length === 0,
  problems.length === 0
    ? `${RULES.length} 条规则全部命中`
    : problems.map((p) => `\n        断点 [${p.id}] ${p.where}\n          ${p.desc}\n          修法：${p.hint}`).join(''),
)

// --- 不变量 2：所有调用点都传了 dark 和 liquid ---
// 必须扫 src 下**全部** tsx，而不是 FILES 里那三个：真正的调用点在
// ModernTabBar / PlayerBar 里，它们不在 FILES 中（漏扫会让这条断言永远假通过）。
const tsxSources = collectTsx(path.join(ROOT, 'src')).map((p) => [
  path.relative(ROOT, p).replace(/\\/g, '/'),
  fs.readFileSync(p, 'utf8'),
])
const { problems: siteProblems, callSites } = checkCallSites(tsxSources)
check(
  '不变量2 所有 <LiquidGlass 调用点都传 dark 和 liquid',
  siteProblems.length === 0 && callSites >= 3,
  callSites === 0
    ? '未发现任何调用点，检查逻辑可能失效'
    : `${callSites} 个调用点，${siteProblems.length} 处缺参` +
      (siteProblems.length ? siteProblems.map((p) => `\n        ${p.where} → ${p.desc}\n          ${p.hint}`).join('') : ''),
)

// --- 不变量 3（反例）：检查器必须能发现被抹掉的片段 ---
// 把真实文件里所有相关片段替换掉，检查器必须报错；否则说明规则形同虚设。
{
  const broken = sources.map(([f, t]) => {
    let s = t
    s = s.replace(/var isDarkMode\s*:\s*Bool/g, '// removed')
    s = s.replace(/overrideUserInterfaceStyle\s*=\s*isDarkMode/g, '// removed')
    s = s.replace(/func rebuildEffectView\s*\(/g, 'func removed(')
    s = s.replace(/RCT_CUSTOM_VIEW_PROPERTY\(\s*dark\s*,/g, 'REMOVED_PROPERTY(')
    s = s.replace(/setIsDarkMode\s*:/g, 'removed:')
    s = s.replace(/dark\?\s*:\s*boolean/g, 'removed')
    s = s.replace(/dark=\{dark\}/g, 'removed')
    s = s.replace(/createGlassBacking\(dark:\s*Bool,\s*liquid:\s*Bool\)/g, 'removed(')
    s = s.replace(/LiquidGlassEffect\(style:\s*\.regular,\s*isNative:\s*false\)/g, 'REMOVED(')
    s = s.replace(/RCT_CUSTOM_VIEW_PROPERTY\(\s*liquid\s*,/g, 'REMOVED_PROPERTY(')
    s = s.replace(/createGlassBackingWithDark:/g, 'removed:')
    s = s.replace(/liquid\?\s*:\s*boolean/g, 'removed')
    s = s.replace(/liquid=\{effectiveLiquid\}/g, 'removed')
    return [f, s]
  })
  const brokenProblems = run(broken)
  const brokenTsx = tsxSources.map(([f, t]) => [f, t.replace(/dark=\{|liquid=\{/g, 'X=')])
  const { problems: brokenSites } = checkCallSites(brokenTsx)
  // 抹掉 dark={ 和 liquid={ 后：每个调用点报 2 处缺参（两个参数各一处）
  const expectedSiteProblems = callSites * 2
  // 反例成立：抹掉后必须能报出来，否则规则是空的
  const detected = brokenProblems.length >= RULES.length - 1 && brokenSites.length === expectedSiteProblems && callSites >= 3
  check(
    '不变量3 反例：抹掉链路后检查器必须报错（否则规则形同虚设）',
    detected,
    `抹掉后命中 ${brokenProblems.length}/${RULES.length} 条规则、调用点报错 ${brokenSites.length}/${expectedSiteProblems} 处` +
      (detected ? '（检查器有效）' : '（检查器失效，规则没在真的检查东西）'),
  )
}

// --- 不变量 4：设置项说明文案的分档承诺与原生/部署配置一致 ---
// 文案 = 主题页「液态玻璃」行下方常驻说明（LiquidGlassToggle 渲染）。
// 三处事实源：① 文案里的版本区间；② 原生液态分支的 #available 守卫（分档点）；
// ③ Podfile 的 platform :ios（下限）。任一改动而其余不同步 → 文案变成假话。
const COPY_KEY = 'setting_basic_theme_liquid_glass_desc'
const COPY_FILES = {
  lang: 'src/lang/zh-cn.json',
  toggle: 'src/screens/Home/Views/Setting/settings/Theme/LiquidGlassToggle.tsx',
  podfile: 'ios/Podfile',
}

/** 按签名取出函数体（花括号配平），把搜索范围限定在函数内 —— 同文件还有别的 #available */
function extractBody(src, sigRe) {
  const m = sigRe.exec(src)
  if (!m) return null
  const start = src.indexOf('{', m.index)
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  return null
}

/**
 * 原生液态分档点：`createGlassBacking` 液态分支里 `#available(iOS X, *)` 的版本。
 * 三处契约（设置文案 / 宿主头注释 / 部署下限）共用这一个事实源。
 * @returns {string|null} 如 '26.2'；找不到返回 null
 */
function nativeSplitVersion(factorySrc) {
  const body = extractBody(factorySrc, /createGlassBacking\(dark:\s*Bool,\s*liquid:\s*Bool\)/)
  const m = body && /#available\(iOS\s+(\d+(?:\.\d+)?)\s*,\s*\*\)/.exec(body)
  return m ? m[1] : null
}

/**
 * 文件开头的连续 `//` 注释块（LiquidGlassViewManager.mm 的 Usage contract 所在处）。
 *
 * ⚠️ 正则**不能**写成 `/^\s*\/\/(.*)$/`：这些 .mm/.swift 在 Windows 检出后是 CRLF，
 * 而 JS 里 `.` 不匹配 CR（LineTerminator 含 CR/LF/LS/PS）、非 multiline 的 `$` 也不
 * 匹配 CR 之前的位置 → 每一行都匹配失败，head 静默变成空字符串（本函数第一版即如此，
 * 表现是「找不到 liquid = false」这种误导性报错）。用不带 `$` 的 `/^\s*\/\/(.*)/`，
 * 贪婪的 `(.*)` 自己会在 CR 处停下，顺带把行尾 CR 剥掉。
 */
function headerComment(src) {
  const lines = []
  for (const line of src.split('\n')) {
    const m = /^\s*\/\/(.*)/.exec(line)
    if (!m) {
      if (lines.length) break
      continue
    }
    lines.push(m[1])
  }
  return lines.join('\n')
}

/**
 * 文案里出现过的 iOS 版本号（按出现顺序去重）。
 * 必须支持**区间写法**：\"iOS 14～26.1 为液态玻璃，iOS 26.2 及以上为系统磨砂\"
 *   → ['14', '26.1', '26.2']（右端 26.1 没有自己的 iOS 前缀，只认前缀会漏掉它，
 *   进而把「区间重叠」这种真缺陷误判成通过）。
 */
function copyVersions(text) {
  const out = []
  const re = /iOS\s*(\d+(?:\.\d+)?)(?:\s*[~～\-–—]\s*(\d+(?:\.\d+)?))?/g
  const push = (v) => {
    if (v && !out.includes(v)) out.push(v)
  }
  let m
  while ((m = re.exec(text))) {
    push(m[1])
    push(m[2])
  }
  return out
}

/**
 * 分档契约检查。over 允许注入被篡改的文本，供反例使用。
 * @returns {{id:string,desc:string}[]} 违规项
 */
function checkCopyContract(over = {}) {
  const problems = []
  const read = (key, file) => over[key] ?? fs.readFileSync(path.join(ROOT, file), 'utf8')

  const lang = read('lang', COPY_FILES.lang)
  const toggle = read('toggle', COPY_FILES.toggle)
  const pod = read('pod', COPY_FILES.podfile)
  const factory = over.factory ?? sources.find(([f]) => f === FILES.swift)[1]

  let desc = ''
  try {
    desc = JSON.parse(lang)[COPY_KEY] ?? ''
  } catch (e) {
    problems.push({ id: 'copy-json', desc: `${COPY_FILES.lang} 不是合法 JSON：${e.message}` })
    return problems
  }
  if (!desc) {
    problems.push({ id: 'copy-missing', desc: `缺少文案 ${COPY_KEY}` })
    return problems
  }

  // ① 文案必须真的被组件渲染（写了 key 但没人用 = 用户看不到）
  if (!toggle.includes(`'${COPY_KEY}'`)) {
    problems.push({ id: 'copy-unused', desc: `LiquidGlassToggle 未渲染 ${COPY_KEY}（文案写了但没人用）` })
  }

  // ② 分档点必须等于原生守卫版本
  const guardVer = nativeSplitVersion(factory)
  if (!guardVer) {
    problems.push({ id: 'guard-missing', desc: 'createGlassBacking 液态分支找不到 #available(iOS X, *) 守卫' })
    return problems
  }
  const vers = copyVersions(desc)
  if (!vers.includes(guardVer)) {
    problems.push({ id: 'copy-guard', desc: `文案未出现原生分档版本 ${guardVer}（原生守卫 ${guardVer} 与文案不一致）` })
  }

  // ③ 液态上界必须是分档点的前一版：保证「14～X-0.1 液态 / X+ 磨砂」不重叠也不留缝。
  //    （反例即「14～26.2 为液态，26.2 及以上为磨砂」——同一版本落在两个区间里。）
  //    注意：若原生守卫被改到 X.Y0 这类「前一版号不存在」的位置，本断言会 FAIL ——
  //    这是有意的，改档位本就该连文案与本守卫一起复核。
  const [maj, min] = guardVer.split('.')
  const expectedUpper = min == null ? null : `${maj}.${Number(min) - 1}`
  if (expectedUpper && !vers.includes(expectedUpper)) {
    problems.push({ id: 'copy-upper', desc: `文案缺液态上界 ${expectedUpper}（分档点 ${guardVer} 的前一版），区间会重叠或留缝` })
  }

  // ④ 下限必须等于 Podfile 的部署版本
  const target = /platform\s*:ios\s*,\s*'(\d+(?:\.\d+)?)'/.exec(pod)
  const lower = target ? String(parseInt(target[1], 10)) : null
  if (!lower) problems.push({ id: 'pod-target', desc: 'Podfile 找不到 platform :ios 声明' })
  else if (vers[0] !== lower) {
    problems.push({ id: 'copy-lower', desc: `文案下限 ${vers[0] ?? '(无)'} ≠ 部署版本 ${lower}` })
  }

  return problems
}

{
  const copyProblems = checkCopyContract()
  check(
    '不变量4 说明文案分档 = 原生守卫版本 + 部署下限 + 真被渲染（4 条子规则）',
    copyProblems.length === 0,
    copyProblems.length === 0
      ? '文案分档与 LGGlassViewFactory.swift / Podfile 一致'
      : copyProblems.map((p) => `\n        断点 [${p.id}] ${p.desc}`).join(''),
  )
}

/**
 * vendored 宿主头注释的材质契约检查。over 允许注入被篡改的文本，供反例使用。
 * @returns {{id:string,desc:string}[]} 违规项
 */
function checkVendorHeaderContract(over = {}) {
  const problems = []
  const text = over.mm ?? sources.find(([f]) => f === FILES.mm)[1]
  const factory = over.factory ?? sources.find(([f]) => f === FILES.swift)[1]
  const head = headerComment(text)
  const guardVer = nativeSplitVersion(factory)

  if (!guardVer) {
    problems.push({ id: 'head-split-missing', desc: '原生工厂找不到 #available(iOS X, *) 分档点' })
    return problems
  }

  // ① 分档点必须出现在头注释里：注释按版本分档描述材质、却不写分档点 = 已脱节
  if (!head.includes(guardVer)) {
    problems.push({ id: 'head-split', desc: `头注释未提到原生分档点 iOS ${guardVer}（注释与工厂分档脱节）` })
  }

  // ② 「磨砂档」那一节不得出现 UIGlassEffect：磨砂 = 全版本 UIBlurEffect(.systemMaterial)，
  //    点名 UIGlassEffect 即是在描述「磨砂按版本分派原生玻璃」这个已废弃契约
  //    （26 的原生玻璃材质只属于开关打开时的 26.2+ 档）。
  const frostedFrom = head.indexOf('liquid = false')
  if (frostedFrom < 0) {
    problems.push({ id: 'head-frosted-missing', desc: '头注释里找不到 `liquid = false` 档（契约无从核对）' })
  } else {
    const next = head.indexOf('liquid', frostedFrom + 1)
    const frosted = head.slice(frostedFrom, next < 0 ? head.length : next)
    if (frosted.includes('UIGlassEffect')) {
      problems.push({
        id: 'head-frosted-native',
        desc: '磨砂档描述里出现 UIGlassEffect（磨砂全版本 systemMaterial，用不到它）',
      })
    }
  }

  // ③ Metal 档的上界（分档点前一版）也要写出来：只写「26.2+ 走系统材质」而不写低版本
  //    走 Metal，等于漏掉一档 —— 低版本用户会以为开关无效果。
  const [maj, min] = guardVer.split('.')
  const prev = min == null ? null : `${maj}.${Number(min) - 1}`
  if (prev && !head.includes(prev)) {
    problems.push({ id: 'head-lower', desc: `头注释未写出 Metal 档上界 ${prev}（分档点 ${guardVer} 的前一版）` })
  }

  return problems
}

// --- 不变量 5（反例）：篡改任一处事实源都必须被报出来 ---
{
  const srcLang = fs.readFileSync(path.join(ROOT, COPY_FILES.lang), 'utf8')
  const srcToggle = fs.readFileSync(path.join(ROOT, COPY_FILES.toggle), 'utf8')
  const srcPod = fs.readFileSync(path.join(ROOT, COPY_FILES.podfile), 'utf8')
  const srcFactory = sources.find(([f]) => f === FILES.swift)[1]
  const CASES = [
    // 原生守卫调档到 26.5，文案仍写 26.2 → 必须报
    { name: '原生守卫调档 26.2→26.5', over: { factory: srcFactory.replace(/iOS 26\.2, \*\)/, 'iOS 26.5, *)') } },
    // 区间重叠（同一版本落在两个区间）= 本项目真实犯过的写法 → 必须报
    {
      name: '文案写成区间重叠（26.2 既液态又磨砂）',
      over: { lang: srcLang.replace('iOS 14～26.1 为液态玻璃', 'iOS 14～26.2 为液态玻璃') },
    },
    // 部署下限上调到 15，文案仍写 14 → 必须报
    { name: '部署下限 14→15', over: { pod: srcPod.replace(/platform :ios, '14\.0'/, "platform :ios, '15.0'") } },
    // 文案 key 存在但组件不渲染 → 必须报
    { name: '组件未渲染文案', over: { toggle: srcToggle.replace(`'${COPY_KEY}'`, "'removed'") } },
  ]
  const results = CASES.map((c) => ({ name: c.name, hits: checkCopyContract(c.over).map((p) => p.id) }))
  // 每个反例都必须至少命中一条；且四例的命中集合不能全都一样（否则说明检查在乱报同一条）
  const allDetected = results.every((r) => r.hits.length > 0)
  const distinct = new Set(results.map((r) => r.hits.join(','))).size
  check(
    '不变量5 反例：篡改文案/下限/原生守卫后必须报错（且各例命中不同规则）',
    allDetected && distinct === CASES.length,
    results.map((r) => `${r.name} → ${r.hits.length ? r.hits.join('+') : '未报错(失效)'}`).join('；'),
  )
}

// --- 不变量 6：vendored 宿主头注释的材质契约与原生分档一致 ---
{
  const headProblems = checkVendorHeaderContract()
  check(
    '不变量6 宿主头注释材质契约 = 原生分档点 + 磨砂档不点名原生玻璃 + 含 Metal 档上界（3 条子规则）',
    headProblems.length === 0,
    headProblems.length === 0
      ? `${FILES.mm} 的 Usage contract 与 LGGlassViewFactory.swift 分档一致`
      : headProblems.map((p) => `\n        断点 [${p.id}] ${p.desc}`).join(''),
  )
}

// --- 不变量 7（反例）：篡改头注释或原生守卫都必须被报出来 ---
// 每个反例都要求替换**真的命中**（replace 没命中会静默返回原文，反例就成了空跑）。
{
  const srcMm = sources.find(([f]) => f === FILES.mm)[1]
  const srcFactory = sources.find(([f]) => f === FILES.swift)[1]
  const FROSTED_OLD = '系统磨砂 —— **全版本统一** UIBlurEffect(.systemMaterial)'
  const FROSTED_STALE = '系统磨砂 —— iOS 26+ `UIGlassEffect(.regular)`、其余 `UIBlurEffect(.systemMaterial)`'
  const CASES = [
    // 分档点被抹掉（分档落地、注释没跟上 —— 本项目真实发生过的形态）
    { name: '头注释抹掉分档点版本 26.2', over: { mm: srcMm.replace(/26\.2/g, '99.9') }, src: srcMm },
    // 磨砂档被写回旧契约（「26+ 走原生玻璃」）
    { name: '磨砂档改回「26+ 走 UIGlassEffect」', over: { mm: srcMm.replace(FROSTED_OLD, FROSTED_STALE) }, src: srcMm },
    // 原生守卫调档，注释仍写旧分档点（注释 → 工厂方向也要能报）
    { name: '原生守卫调档 26.2→26.5', over: { factory: srcFactory.replace(/iOS 26\.2, \*\)/, 'iOS 26.5, *)') }, src: srcFactory },
  ]
  const results = CASES.map((c) => {
    const injected = Object.values(c.over)[0]
    return {
      name: c.name,
      injected: injected !== c.src, // 替换是否真的命中
      hits: checkVendorHeaderContract(c.over).map((p) => p.id),
    }
  })
  const allInjected = results.every((r) => r.injected)
  const allDetected = results.every((r) => r.hits.length > 0)
  const distinct = new Set(results.map((r) => r.hits.join(','))).size
  check(
    '不变量7 反例：篡改头注释/原生守卫后必须报错（替换生效 + 各例命中不同规则）',
    allInjected && allDetected && distinct === CASES.length,
    results
      .map((r) => `${r.name} → ${r.injected ? (r.hits.length ? r.hits.join('+') : '未报错(失效)') : '替换未命中(反例失效)'}`)
      .join('；'),
  )
}

// --- 不变量 8：26.2+ 液态玻璃门控契约（2026-09-30 定案）---
// UIGlassEffect(.regular) 在白底/图底页面切换瞬间闪烁（Tab 切换即复现），根治方案：
// 26.2+ 强制系统磨砂、从设置页隐藏液态玻璃开关、只留「玻璃不透明度」滑杆；
// 14~26.1 开关与行为保持现状。这条契约横跨 6 个文件：
//   tools.ts（版本判定）→ LiquidGlass.tsx（组件兜底）→ LiquidGlassToggle（开关隐藏）
//   → ThemeScreen（滑杆常显）→ ModernTabBar / PlayerBar（消费点门控）。
// 任何一处被删/被改，26.2+ 用户就会重新看到闪烁或看到失效开关，而 tsc/eslint 全绿。
function checkIOS26Gate(over = {}) {
  const problems = []
  const read = (key) => over[key] ?? fs.readFileSync(path.join(ROOT, GATE_FILES[key]), 'utf8')
  // 「注释同形」教训第三次出现（前两次是守卫假阴性，这次是假阳性）：tools.ts 的
  // 26.2 判定注释里**故意写着**反模式示例（`Number(osVer) >= 26.2` 的说明文字），
  // 直接整文匹配会把注释当反模式误报。检查前剥掉整行注释与 JSDoc 行（代码行不会
  // 以 //、*、/* 开头）。反例注入的都是真实代码行，剥注释不影响检出。
  const readCode = (key) =>
    read(key).split('\n').filter((l) => !/^[ \t]*(\/\/|\*|\/\*)/.test(l)).join('\n')

  // ① 版本判定必须按 major.minor 分量比较：
  //    `Number.parseInt('26.2') === 26`，整数比较区分不了 26.1/26.2；
  //    浮点比较（Number(osVer) >= 26.2）对 '26.10' 这类小数位 ≥10 的版本会误判。
  if (!/major\s*>\s*26\s*\|\|\s*\(major\s*===\s*26\s*&&\s*minor\s*>=\s*2\)/.test(readCode('tools'))) {
    problems.push({ id: 'gate-compare', desc: 'tools.ts 的 26.2 判定不是 major.minor 分量比较（整数比较区分不了 26.1/26.2）' })
  }
  // ② 禁止浮点比较反模式（同上理由）
  if (/>=\s*26\.2/.test(readCode('tools'))) {
    problems.push({ id: 'gate-float', desc: 'tools.ts 出现 >= 26.2 浮点比较（对 26.10 这类版本会误判的反模式）' })
  }
  // ③ 组件内兜底：任何调用方漏门控（残留 theme.liquidGlass=true）也不得穿透到原生
  if (!/const effectiveLiquid\s*=\s*liquid\s*&&\s*!isIOS26_2OrAbove/.test(readCode('comp'))) {
    problems.push({ id: 'gate-fallback', desc: 'LiquidGlass 组件缺 effectiveLiquid 兜底（26.2+ 液态 prop 可穿透到原生 UIGlassEffect）' })
  }
  // ④ 开关 26.2+ 整行隐藏
  if (!/if\s*\(isIOS26_2OrAbove\)\s*return\s*null/.test(readCode('toggle'))) {
    problems.push({ id: 'gate-toggle-hide', desc: 'LiquidGlassToggle 未在 26.2+ return null（失效开关仍显示）' })
  }
  // ⑤ 玻璃不透明度滑杆 26.2+ 常显（26.2+ 强制磨砂，滑杆全程有意义）
  if (!/showGlassOpacity\s*=\s*!liquidGlass\s*\|\|\s*isIOS26_2OrAbove/.test(readCode('themeScreen'))) {
    problems.push({ id: 'gate-opacity', desc: 'ThemeScreen 的玻璃不透明度滑杆未在 26.2+ 常显（残留开关值会把它藏掉）' })
  }
  // ⑥⑦ 两个消费点必须门控残留开关值（同时控制玻璃形态与 LiquidLens 渲染）
  const consumers = [
    ['tabbar', 'gate-tabbar', 'ModernTabBar'],
    ['playerbar', 'gate-playerbar', 'PlayerBar'],
  ]
  for (const [key, id, name] of consumers) {
    if (!/useSettingValue\('theme\.liquidGlass'\)\s*&&\s*!isIOS26_2OrAbove/.test(readCode(key))) {
      problems.push({ id, desc: `${name} 未门控残留开关值（26.2+ 会走液态/UIGlassEffect 闪烁）` })
    }
  }
  return problems
}

const GATE_FILES = {
  tools: 'src/utils/tools.ts',
  comp: 'src/components/common/LiquidGlass.tsx',
  toggle: 'src/screens/Home/Views/Setting/settings/Theme/LiquidGlassToggle.tsx',
  themeScreen: 'src/screens/Home/Views/Setting/settings/ThemeScreen.tsx',
  tabbar: 'src/components/layout/ModernTabBar.tsx',
  playerbar: 'src/components/player/PlayerBar/index.tsx',
}

{
  const gateProblems = checkIOS26Gate()
  check(
    '不变量8 26.2+ 门控契约：版本分量比较 + 组件兜底 + 开关隐藏 + 滑杆常显 + 两消费点门控（7 条子规则）',
    gateProblems.length === 0,
    gateProblems.length === 0
      ? '26.2+ 强制磨砂链路在 6 个文件中全部贯通'
      : gateProblems.map((p) => `\n        断点 [${p.id}] ${p.desc}`).join(''),
  )
}

// --- 不变量 9（反例）：抹掉/篡改任一门控点都必须被报出来 ---
{
  const srcTools = fs.readFileSync(path.join(ROOT, GATE_FILES.tools), 'utf8')
  const srcComp = fs.readFileSync(path.join(ROOT, GATE_FILES.comp), 'utf8')
  const srcToggle = fs.readFileSync(path.join(ROOT, GATE_FILES.toggle), 'utf8')
  const srcThemeScreen = fs.readFileSync(path.join(ROOT, GATE_FILES.themeScreen), 'utf8')
  const srcTabbar = fs.readFileSync(path.join(ROOT, GATE_FILES.tabbar), 'utf8')
  const srcPlayerbar = fs.readFileSync(path.join(ROOT, GATE_FILES.playerbar), 'utf8')
  const CASES = [
    // 版本判定退化成整数比较（parseInt('26.2')===26，26.1/26.2 不再区分）→ 必须报
    {
      name: 'tools 判定退化为整数比较',
      over: { tools: srcTools.replace(/major\s*>\s*26\s*\|\|\s*\(major\s*===\s*26\s*&&\s*minor\s*>=\s*2\)/, 'major >= 26') },
      src: srcTools,
    },
    // 引入浮点比较反模式（只追加、不破坏分量比较）→ 必须报
    {
      name: 'tools 引入浮点比较反模式',
      over: { tools: srcTools + '\nexport const badGate = Number(osVer) >= 26.2\n' },
      src: srcTools,
    },
    // 组件兜底被绕过（透传残留开关值）→ 必须报
    {
      name: '组件兜底被抹掉',
      over: { comp: srcComp.replace(/const effectiveLiquid\s*=\s*liquid\s*&&\s*!isIOS26_2OrAbove/, 'const effectiveLiquid = liquid') },
      src: srcComp,
    },
    // 开关恢复显示（26.2+ 用户看到失效开关）→ 必须报
    {
      name: '开关恢复 26.2+ 显示',
      over: { toggle: srcToggle.replace(/if\s*\(isIOS26_2OrAbove\)\s*return\s*null/, 'if (false) return null') },
      src: srcToggle,
    },
    // 滑杆重新跟随残留开关值（26.2+ 滑杆凭空消失）→ 必须报
    {
      name: '滑杆常显被抹掉',
      over: { themeScreen: srcThemeScreen.replace(/!liquidGlass\s*\|\|\s*isIOS26_2OrAbove/, '!liquidGlass') },
      src: srcThemeScreen,
    },
    // 消费点恢复直读设置值（26.2+ 重新走 UIGlassEffect 闪烁）→ 必须报
    {
      name: 'ModernTabBar 门控被抹掉',
      over: { tabbar: srcTabbar.replace(/useSettingValue\('theme\.liquidGlass'\)\s*&&\s*!isIOS26_2OrAbove/, "useSettingValue('theme.liquidGlass')") },
      src: srcTabbar,
    },
    {
      name: 'PlayerBar 门控被抹掉',
      over: { playerbar: srcPlayerbar.replace(/useSettingValue\('theme\.liquidGlass'\)\s*&&\s*!isIOS26_2OrAbove/, "useSettingValue('theme.liquidGlass')") },
      src: srcPlayerbar,
    },
  ]
  const results = CASES.map((c) => {
    const injected = Object.values(c.over)[0] !== c.src // 注入是否真的生效（replace 未命中会静默返回原文）
    return {
      name: c.name,
      injected,
      hits: checkIOS26Gate(c.over).map((p) => p.id),
    }
  })
  const allInjected = results.every((r) => r.injected)
  const allDetected = results.every((r) => r.hits.length > 0)
  const distinct = new Set(results.map((r) => r.hits.join(','))).size
  check(
    '不变量9 反例：篡改任一门控点后必须报错（替换生效 + 各例命中不同规则）',
    allInjected && allDetected && distinct === CASES.length,
    results
      .map((r) => `${r.name} → ${r.injected ? (r.hits.length ? r.hits.join('+') : '未报错(失效)') : '注入未命中(反例失效)'}`)
      .join('；'),
  )
}

// --- 输出 ---
let failed = 0
for (const c of checks) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`)
  if (c.detail) console.log(`      ${c.detail}`)
  if (!c.pass) failed++
}
console.log(`\n===== ${checks.length - failed}/${checks.length} 项通过 =====`)

if (failed > 0) {
  console.error(`\n跨层契约被破坏 ${failed} 项，退出码 1`)
  process.exit(1)
}
