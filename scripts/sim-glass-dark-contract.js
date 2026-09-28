/**
 * sim-glass-dark-contract.js
 *
 * 玻璃「App 主题明暗」这条跨层链路的契约检查。
 *
 * 为什么需要它：dark 从 JS 一路走到原生材质，跨了 4 个层（TSX → TS 组件 →
 * RN bridge prop → ObjC 宿主 → Swift backing），其中**只有前两层受 tsc/eslint 保护**。
 * 原生侧的 prop 名、selector 名不在 TS 类型体系里，写错或整条删掉，两个基线口径
 * 都是绿的。这个缺陷真实发生过：73c2e9c 把玻璃改成纯染色覆层时删掉了 dark 链路
 * （当时确实不需要——纯色块与系统 trait 无关），后续恢复系统材质时没有恢复它，
 * 结果是「App 深色 + 系统浅色」下材质渲染成亮色磨砂，与整体配色相反，
 * 而 tsc/eslint 全过。
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
 * 调用点检查：每个真正渲染 <LiquidGlass 的地方都必须传 dark。
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

console.log('玻璃「App 主题明暗」跨层契约检查\n')

// --- 不变量 1~3：链路贯通 ---
const problems = run(sources)
check(
  '不变量1 四层契约片段齐备（Swift 属性/重建 + ObjC prop/setter + JS 声明/透传）',
  problems.length === 0,
  problems.length === 0
    ? `7 条规则全部命中`
    : problems.map((p) => `\n        断点 [${p.id}] ${p.where}\n          ${p.desc}\n          修法：${p.hint}`).join(''),
)

// --- 不变量 2：所有调用点都传了 dark ---
// 必须扫 src 下**全部** tsx，而不是 FILES 里那三个：真正的调用点在
// ModernTabBar / PlayerBar 里，它们不在 FILES 中（漏扫会让这条断言永远假通过）。
const tsxSources = collectTsx(path.join(ROOT, 'src')).map((p) => [
  path.relative(ROOT, p).replace(/\\/g, '/'),
  fs.readFileSync(p, 'utf8'),
])
const { problems: siteProblems, callSites } = checkCallSites(tsxSources)
check(
  '不变量2 所有 <LiquidGlass 调用点都传 dark',
  siteProblems.length === 0 && callSites >= 3,
  callSites === 0
    ? '未发现任何调用点，检查逻辑可能失效'
    : `${callSites} 个调用点，${siteProblems.length} 个缺 dark` +
      (siteProblems.length ? siteProblems.map((p) => `\n        ${p.where} → ${p.hint}`).join('') : ''),
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
    return [f, s]
  })
  const brokenProblems = run(broken)
  const brokenTsx = tsxSources.map(([f, t]) => [f, t.replace(/dark=\{/g, 'X=')])
  const { problems: brokenSites } = checkCallSites(brokenTsx)
  // 反例成立：抹掉后必须能报出来，否则规则是空的
  const detected = brokenProblems.length >= 6 && brokenSites.length === callSites && callSites >= 3
  check(
    '不变量3 反例：抹掉链路后检查器必须报错（否则规则形同虚设）',
    detected,
    `抹掉后命中 ${brokenProblems.length}/7 条规则、调用点报错 ${brokenSites.length}/${callSites} 处` +
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
