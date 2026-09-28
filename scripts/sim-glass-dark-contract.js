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
 * 检查的是**契约的存在与贯通**，不是观感——观感只能真机看。
 * 不变量（1~4）必过，退出码据此。
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
    hint: '液态分支缺失：iOS 26+ 开关打开也不会出现折射玻璃',
  },
  {
    id: 'mm-prop-liquid',
    file: 'mm',
    test: (s) => /RCT_CUSTOM_VIEW_PROPERTY\(\s*liquid\s*,/.test(s),
    desc: 'ObjC 宿主暴露 liquid prop（切换时重建背衬并重放缓存属性）',
    hint: '缺 liquid prop：JS 开关传了也丢，永远停在磨砂',
  },
  {
    id: 'mm-metal-setters',
    file: 'mm',
    count: (s) => (s.match(/setJsActive:|setPreferredFramesPerSecond:/g) || []).length,
    min: 2,
    desc: 'ObjC 保留 Metal 专有控制入口（setJsActive: / setPreferredFramesPerSecond:）',
    hint: '脉冲/fps 控制入口被删，液态玻璃的省电机制（按需渲染）断线',
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
    test: (s) => /liquid=\{liquid\}/.test(s),
    desc: 'JS 组件把 liquid 透传到原生组件',
    hint: '声明了但没透传，等于没接',
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
    s = s.replace(/setJsActive:|setPreferredFramesPerSecond:/g, 'removed:')
    s = s.replace(/liquid\?\s*:\s*boolean/g, 'removed')
    s = s.replace(/liquid=\{liquid\}/g, 'removed')
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
