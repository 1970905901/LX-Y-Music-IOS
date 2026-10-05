/**
 * sim-native-decl-order.js
 *
 * 「AppDelegate.mm 里 LX* C/C++ 函数不得在声明/定义之前调用」契约。
 *
 * 背景（2026-10-06 CI run#951/#952 构建失败）：AppDelegate.mm 是 ObjC++（.mm），C++ 不允许隐式
 * 函数声明 —— 在定义之前调用、又没写前置声明，Xcode 直接报
 *   error: use of undeclared identifier 'LXApplyNowPlayingInfo'
 * 本机（Windows）无法编译 iOS，这个文本级检查把这条编译规则搬进本地门禁：
 * 每个 LX* 调用点都必须早于它（或已有前置声明 / 同名头文件声明）。
 *
 * 识别规则（避免误报）：
 *   · 定义/声明行 = 行尾是 `{` / `{}` / `;` 且名字前只可能是类型前缀（含 C++ 构造、模板参数、~ 析构）；
 *   · 其余出现 LX*(...) 的行视为调用；
 *   · 注释与字符串先剥离；ios/LxMusicMobile/*.h 里的 LX* 声明视为全局可用。
 *
 * 运行：node scripts/sim-native-decl-order.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const TARGET = 'ios/LxMusicMobile/AppDelegate.mm'
const raw = fs.readFileSync(path.join(ROOT, TARGET), 'utf8').replace(/\r\n/g, '\n')

const stripCommentsAndStrings = (src) => {
  let out = ''
  let i = 0
  let inLine = false
  let inBlock = false
  let inStr = false
  let inChar = false
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (inLine) { if (c === '\n') { inLine = false; out += '\n' } else out += ' '; i++; continue }
    if (inBlock) {
      if (c === '*' && n === '/') { inBlock = false; out += '  '; i += 2; continue }
      out += c === '\n' ? '\n' : ' '
      i++
      continue
    }
    if (inStr || inChar) {
      if (c === '\\') { out += '  '; i += 2; continue }
      if ((inStr && c === '"') || (inChar && c === "'")) { inStr = false; inChar = false; out += ' '; i++; continue }
      out += c === '\n' ? '\n' : ' '
      i++
      continue
    }
    if (c === '/' && n === '/') { inLine = true; out += '  '; i += 2; continue }
    if (c === '/' && n === '*') { inBlock = true; out += '  '; i += 2; continue }
    if (c === '"') { inStr = true; out += ' '; i++; continue }
    if (c === "'") { inChar = true; out += ' '; i++; continue }
    out += c
    i++
  }
  return out
}

const namesFromHeaders = () => {
  const names = new Set()
  const dir = path.join(ROOT, 'ios/LxMusicMobile')
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.h')) continue
    const text = stripCommentsAndStrings(fs.readFileSync(path.join(dir, entry), 'utf8'))
    for (const m of text.matchAll(/\b(LX[A-Za-z0-9_]*)\s*\(/g)) names.add(m[1])
  }
  return names
}

// 语句关键字：出现这些词说明是调用语句而不是声明/定义
const STATEMENT_KEYWORDS = /\b(return|if|while|for|switch|else|do|sizeof|delete|new|throw|catch|case|goto|continue|break|assert)\b/

// 该行是否是 name 的「定义 / 声明」（而不是调用）
const isDefinitionOrDeclarationLine = (trimmed, name) => {
  const endsDef = /\{\s*$/.test(trimmed) || /\{[^}]*\}\s*$/.test(trimmed)
  const endsDecl = /;\s*$/.test(trimmed)
  if (!endsDef && !endsDecl) return false
  const idx = trimmed.indexOf(name + '(')
  if (idx < 0) return false
  const before = trimmed.slice(0, idx).trim()
  // 裸 Name(); 是调用语句；裸 Name() : init {} 才是 C++ 构造函数定义
  if (before === '') return endsDef
  if (STATEMENT_KEYWORDS.test(before)) return false
  // 声明/定义的名字前面只可能是类型前缀（允许指针 *、模板 <>、命名空间 ::、析构 ~、引用 &）
  if (!/^[\w\s*<>:~&]+$/.test(before)) return false
  if (!/[A-Za-z_]/.test(before)) return false
  return true
}

// 两遍扫描：先登记每个名字「最早」出现的定义/声明行，再检查更早的调用
// 本地 #include/#import 的文件（同编译单元）提供的 LX* 名字：从 include 行起视为已声明。
// 例：AppDelegate.mm #import "LXEmbeddedMetadataHelpers.mm"，后者的 static 函数在本 TU 内可见。
const namesFromLocalInclude = (includeTarget, seen = new Set()) => {
  const names = new Set()
  const baseDir = path.join(ROOT, 'ios/LxMusicMobile')
  const resolved = path.join(baseDir, includeTarget)
  if (seen.has(resolved) || !fs.existsSync(resolved)) return names
  seen.add(resolved)
  const text = stripCommentsAndStrings(fs.readFileSync(resolved, 'utf8'))
  for (const m of text.matchAll(/\b(LX[A-Za-z0-9_]*)\s*\(/g)) names.add(m[1])
  for (const m of text.matchAll(/^#\s*(?:include|import)\s+"([^"]+)"/gm)) {
    for (const nested of namesFromLocalInclude(m[1], seen)) names.add(nested)
  }
  return names
}

const collectViolations = (src) => {
  const code = stripCommentsAndStrings(src)
  const lines = code.split('\n')
  // include 行必须从「原始」文本里解析：剥离字符串后文件名会变成空白
  const rawLines = src.split('\n')
  const fromHeaders = namesFromHeaders()
  const firstDeclLine = new Map()
  for (const name of fromHeaders) firstDeclLine.set(name, 0)

  lines.forEach((line, idx) => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.startsWith('#')) {
      const inc = /^#\s*(?:include|import)\s+"([^"]+)"/.exec((rawLines[idx] || '').trim())
      if (inc) {
        for (const name of namesFromLocalInclude(inc[1])) {
          if (!firstDeclLine.has(name)) firstDeclLine.set(name, idx + 1)
        }
      }
      return
    }
    for (const m of line.matchAll(/\b(LX[A-Za-z0-9_]*)\s*\(/g)) {
      const name = m[1]
      if (!isDefinitionOrDeclarationLine(trimmed, name)) continue
      if (!firstDeclLine.has(name)) firstDeclLine.set(name, idx + 1)
    }
  })

  const violations = []
  lines.forEach((line, idx) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    for (const m of line.matchAll(/\b(LX[A-Za-z0-9_]*)\s*\(/g)) {
      const name = m[1]
      if (isDefinitionOrDeclarationLine(trimmed, name)) continue
      const declLine = firstDeclLine.get(name)
      // 只报「直到文件结束都没有任何定义/声明」的前向调用（这才是编译错误）
      if (declLine == null) violations.push({ line: idx + 1, name, text: trimmed.slice(0, 96) })
      else if (declLine > idx + 1) violations.push({ line: idx + 1, name, declLine, text: trimmed.slice(0, 96) })
    }
  })

  return violations
}
const realViolations = collectViolations(raw)

let tamperCaught = false
let tamperDetail = ''
const declLine = 'static void LXApplyNowPlayingInfo(void);\n'
if (!raw.includes(declLine)) {
  tamperDetail = '找不到 LXApplyNowPlayingInfo 前置声明（契约锚点失效）'
} else {
  const v = collectViolations(raw.replace(declLine, ''))
  const hit = v.find((x) => x.name === 'LXApplyNowPlayingInfo')
  tamperCaught = Boolean(hit)
  tamperDetail = hit ? `已拦下（行 ${hit.line}）` : '未拦下'
}

console.log('声明顺序检查')
console.log(`  文件：${TARGET}（${raw.split('\n').length} 行）`)
if (realViolations.length) {
  for (const v of realViolations) console.error(`  ✗ 行${v.line}: 调用 ${v.name}() 早于其定义/声明（首次声明在第 ${v.declLine} 行）—— ${v.text}`)
} else {
  console.log('  ✓ 所有 LX* 调用都有更早的定义或前置声明')
}
console.log('')
console.log('反例自检')
console.log(`${tamperCaught ? 'PASS' : 'FAIL'}  拿掉 LXApplyNowPlayingInfo 前置声明 —— ${tamperDetail}`)

if (realViolations.length || !tamperCaught) {
  console.error('\nFAIL  原生声明顺序契约未通过（.mm 为 ObjC++：定义前调用会直接构建失败）')
  process.exit(1)
}
console.log('\nPASS  原生声明顺序契约（ObjC++ 不允许隐式声明）')
process.exit(0)
