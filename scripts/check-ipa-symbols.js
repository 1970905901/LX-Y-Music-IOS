#!/usr/bin/env node
/**
 * 从 CI 产出的 ipa 中验证玻璃材质的原生符号契约（无需 mac / 无需 Xcode / 无需解包）。
 *
 * 为什么需要这个脚本：
 *   Windows 上编不了 iOS、跑不了模拟器，CI 绿灯只证明「能编译」。但有两件事 CI 从不告诉
 *   我们，而它们又直接决定真机行为：
 *     1. iOS 26 专属的 `UIGlassEffect` 代码到底有没有被编译进二进制？
 *        —— 它整段包在 `#if compiler(>=6.2)` 里。若 CI 的 Xcode 退回旧版，这段会被**静默跳过**，
 *        构建照样成功、ipa 照样产出，但 iPhone 上跑的是 fallback 分支，你却在等它出官方玻璃。
 *     2. `UIGlassEffect` 是**弱引用**还是**强引用**？
 *        —— 这是老系统能否启动的生死线。若为强引用，iOS 14~18 上 dyld 找不到该类，
 *        **App 启动即 crash**（不是玻璃不生效，是根本进不去）。`@available` / `#available`
 *        只挡运行时调用，挡不住 dyld 链接。唯一合法判据就是 Mach-O 符号表里的 N_WEAK_REF 位。
 *   两个判据都能从 ipa 里直接读出来 —— 所以这个脚本能让「等真机」提前到「拿到 ipa 就能查」。
 *   顺带还能查第三件：明暗（dark）链路有没有真的接进二进制（跨层断裂 tsc/eslint 抓不到）。
 *
 * 断言设计（都拿改动前一个提交的 ipa 实测过，具备区分力）：
 *   1. UIGlassEffect 存在        —— 改动前 0 次 / 改动后 2 次
 *   2. dark 链路符号存在         —— 改动前 0 次 / 改动后 2 次（createGlassBackingWithDark、setIsDarkMode:）
 *   3. 符号表能被正确读取（反例）—— 对照组必须为强引用，伪造符号必须查不到
 *   4. UIGlassEffect 为弱引用     —— 老系统不会启动即崩
 *
 *   ⚠️ UIBlurEffect / UIVisualEffectView 的字符串计数**没有区分力**（改动前后相同，来自其它依赖），
 *   故只作 INFO 打印、不作断言。想验证「回退分支有没有编译」应看断言 1：
 *   两个分支在 systemEffect() 同一个函数体内，函数编进去了就等于两分支都编进去了。
 *
 * 用法：
 *   node scripts/check-ipa-symbols.js                       # 自动找 ipa-artifact/ 下最新的 .ipa
 *   node scripts/check-ipa-symbols.js <path/to/x.ipa>       # 或用显式路径
 *
 * 退出码：断言全过 → 0；任一失败 → 1（可直接用于 CI 前置校验）。
 *
 * 实现说明：只用 Node 内置模块（`zlib` 解 zip、手写 Mach-O 解析），不引入任何依赖 ——
 * ipa 里就是一堆 deflate 流，读出来即可，不需要真的解包整个 app。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const N_WEAK_REF = 0x0040 // nlist_64.n_desc 里的「弱引用」标志位

const MH_MAGIC_64 = 0xfeedfacf // 小端 64 位 Mach-O（arm64 常见）
const MH_CIGAM_64 = 0xcffaedfe // 大端 64 位（需字节翻转）
const FAT_MAGIC = 0xcafebabe
const FAT_MAGIC_64 = 0xcafebabf
const LC_SYMTAB = 0x2

// ---------------------------------------------------------------------------
// zip：只读取目标条目，不落地解包
// ---------------------------------------------------------------------------

/** 在尾部限定范围内找 EOCD（ZIP64 场景本项目不涉及，不处理） */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  throw new Error('未找到 zip EOCD：这不是一个合法的 zip/ipa')
}

/** 列出 zip 中央目录里的所有条目 */
function listZipEntries(buf) {
  const eocd = findEocd(buf)
  const total = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)

  const entries = []
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('中央目录条目签名异常 @' + off)
    const compressedSize = buf.readUInt32LE(off + 20)
    const method = buf.readUInt16LE(off + 10)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('latin1', off + 46, off + 46 + nameLen)
    entries.push({ name, method, compressedSize, localOff })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 解出单个条目的原始内容 */
function readZipEntry(buf, entry) {
  const lo = entry.localOff
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('本地头签名异常 @' + lo)
  const method = buf.readUInt16LE(lo + 8)
  const nameLen = buf.readUInt16LE(lo + 26)
  const extraLen = buf.readUInt16LE(lo + 28)
  const start = lo + 30 + nameLen + extraLen
  const raw = buf.subarray(start, start + entry.compressedSize)
  if (method === 0) return Buffer.from(raw)
  if (method === 8) return zlib.inflateRawSync(raw)
  throw new Error('不支持的压缩方式 ' + method + '（条目 ' + entry.name + '）')
}

// ---------------------------------------------------------------------------
// Mach-O：取符号表，读 n_desc 的弱引用位
// ---------------------------------------------------------------------------

/** 拆出所有架构切片（fat 二进制返回多片，thin 返回一片） */
function machoSlices(buf) {
  const magic = buf.readUInt32BE(0)
  if (magic === FAT_MAGIC || magic === FAT_MAGIC_64) {
    const is64 = magic === FAT_MAGIC_64
    const n = buf.readUInt32BE(4)
    const slices = []
    for (let i = 0; i < n; i++) {
      const base = 8 + i * (is64 ? 32 : 20)
      const offset = is64 ? Number(buf.readBigUInt64BE(base + 8)) : buf.readUInt32BE(base + 8)
      const size = is64 ? Number(buf.readBigUInt64BE(base + 16)) : buf.readUInt32BE(base + 12)
      slices.push({ name: 'slice' + i, buf: buf.subarray(offset, offset + size) })
    }
    return slices
  }
  return [{ name: 'thin', buf }]
}

/** 解析一个 thin Mach-O，返回 Map<符号名, n_desc> */
function symbolTable(slice) {
  const magic = slice.buf.readUInt32LE(0)
  if (magic !== MH_MAGIC_64 && magic !== MH_CIGAM_64) {
    throw new Error('非 64 位 thin Mach-O（magic=0x' + magic.toString(16) + '）')
  }
  const buf = slice.buf
  const ncmds = buf.readUInt32LE(16)

  let off = 32
  let symoff = 0
  let nsyms = 0
  let stroff = 0
  for (let i = 0; i < ncmds; i++) {
    const cmd = buf.readUInt32LE(off)
    const cmdsize = buf.readUInt32LE(off + 4)
    if (cmd === LC_SYMTAB) {
      symoff = buf.readUInt32LE(off + 8)
      nsyms = buf.readUInt32LE(off + 12)
      stroff = buf.readUInt32LE(off + 16)
    }
    if (cmdsize === 0) break // 防御：损坏的 load command 会导致死循环
    off += cmdsize
  }
  if (!nsyms) throw new Error('未找到 LC_SYMTAB（二进制可能已被 strip）')

  const table = new Map()
  for (let i = 0; i < nsyms; i++) {
    const o = symoff + i * 16
    const nStrtx = buf.readUInt32LE(o)
    const nDesc = buf.readUInt16LE(o + 6)
    let end = buf.indexOf(0, stroff + nStrtx)
    if (end < 0) end = buf.length
    table.set(buf.toString('latin1', stroff + nStrtx, end), nDesc)
  }
  return { table, nsyms }
}

// ---------------------------------------------------------------------------
// 断言框架（与其它 sim-*.js 保持同一形态）
// ---------------------------------------------------------------------------

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name)
  if (detail) console.log('        ' + String(detail).replace(/\n/g, '\n        '))
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function findIpa() {
  const dirs = ['ipa-artifact', 'build']
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue
    const hits = fs
      .readdirSync(d)
      .filter((f) => f.toLowerCase().endsWith('.ipa'))
      .map((f) => path.join(d, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    if (hits.length) return hits[0]
  }
  return null
}

const ipaPath = process.argv[2] || findIpa()
if (!ipaPath) {
  console.error('找不到 ipa。请显式传入路径：node scripts/check-ipa-symbols.js <x.ipa>')
  console.error('（可先用 gh release download latest 取回 CI 产物）')
  process.exit(2)
}
if (!fs.existsSync(ipaPath)) {
  console.error('文件不存在：' + ipaPath)
  process.exit(2)
}

console.log('检查目标：' + ipaPath + '  (' + (fs.statSync(ipaPath).size / 1048576).toFixed(1) + ' MB)')
const zip = fs.readFileSync(ipaPath)

// 定位主可执行文件：Payload/<Name>.app/<Name>
const entries = listZipEntries(zip)
const execEntry = entries.find((e) => {
  const m = /^Payload\/([^/]+)\.app\/([^/]+)$/.exec(e.name)
  return m && m[1] === m[2]
})
if (!execEntry) {
  console.error('ipa 里找不到主可执行文件（Payload/<Name>.app/<Name>）')
  process.exit(2)
}
console.log('主可执行文件：' + execEntry.name)

const bin = readZipEntry(zip, execEntry)
console.log('可执行文件大小：' + (bin.length / 1048576).toFixed(1) + ' MB')
console.log()

const slices = machoSlices(bin)
console.log('架构切片：' + slices.map((s) => s.name).join(', '))
console.log()

/** 统计 needle 在 buf 中出现的次数（按字节） */
function countOf(buf, needle) {
  const pat = Buffer.from(needle)
  let n = 0
  for (let i = 0; (i = buf.indexOf(pat, i)) >= 0; i += 1) n++
  return n
}

// ---- 断言 1：UIGlassEffect 代码确实进了二进制（#if compiler(>=6.2) 分支真的编了）----
// 判据是原始字节里出现类名字符串。本仓库里对 UIGlassEffect 的**代码**引用只有
// LGGlassViewFactory.swift 一处（其余全是注释，不会进二进制），故这个计数专指该路径。
const glassRefs = countOf(bin, 'UIGlassEffect')
check(
  '断言1 iOS 26 的 UIGlassEffect 代码已编译进二进制（#if compiler(>=6.2) 分支未被跳过）',
  glassRefs > 0,
  glassRefs > 0
    ? '二进制中出现 ' + glassRefs + ' 次 UIGlassEffect 字样'
    : '未出现：说明编译时 Swift 版本 < 6.2，该分支被整段跳过，ipa 里跑的是 fallback',
)

// ---- 断言 2：明暗链路在二进制里闭合（本轮回归修复的产物）----
// 这两个符号都是本次改动**新增**的导出名，改动前的同名构建里恒为 0（已用 ed4a3ad 的 ipa 实测），
// 因此它们同时具备「必存在」与「有区分力」两个性质：
//   createGlassBackingWithDark —— Swift 工厂按 ObjC 命名规则导出的带参入口，证明 .mm 调的是带 dark 的版本
//   setIsDarkMode:            —— ObjC 侧 dark prop 的 setter，证明 prop 真的接到了 Swift 属性
// 只查一个不够：前者可能只是工厂签名变了、prop 仍是死线；两者齐备才说明链路闭合。
const darkFactory = countOf(bin, 'createGlassBackingWithDark')
const darkSetter = countOf(bin, 'setIsDarkMode:')
check(
  '断言2 明暗（dark）链路在二进制里闭合：工厂带参入口 + prop setter 都在',
  darkFactory > 0 && darkSetter > 0,
  'createGlassBackingWithDark=' + darkFactory + '，setIsDarkMode:=' + darkSetter +
    (darkFactory > 0 && darkSetter > 0
      ? ''
      : '\n缺失意味着「JS 传了 dark、原生没接」的跨层断裂又出现了——tsc/eslint 抓不到这类问题'),
)

// ---- 非断言信息：这两项在所有历史构建里都存在，没有区分力，仅作记录 ----
// UIBlurEffect / UIVisualEffectView 的字符串来自工程里的其它依赖，不能用来证明本仓的回退分支。
console.log(
  '  INFO  材质宿主符号（无区分力，仅供参考）：UIBlurEffect=' +
    countOf(bin, 'UIBlurEffect') +
    '，UIVisualEffectView=' +
    countOf(bin, 'UIVisualEffectView') +
    '\n        注：它们在改动前的构建里数量相同，源自其它依赖，故不能作为「回退分支已编译」的证据。' +
    '\n        回退分支与 iOS 26 分支在 systemEffect() 同一个函数体内，断言1 成立即两分支都编了。',
)

// ---- 断言 3：UIGlassEffect 必须是弱引用（老系统能否启动的生死线）----
const targets = {
  glass: '_OBJC_CLASS_$_UIGlassEffect',
  blur: '_OBJC_CLASS_$_UIBlurEffect',
  effectHost: '_OBJC_CLASS_$_UIVisualEffectView',
  control: '_OBJC_CLASS_$_UIView', // 纯对照：iOS 全版本都有，必为 strong
  bogus: '_OBJC_CLASS_$_NSCouldNotPossiblyExistXYZ123', // 反例：必须查不到
}

const missing = new Set(Object.values(targets))
const desc = new Map()
let parsedNsyms = 0
for (const s of slices) {
  const { table, nsyms } = symbolTable(s)
  parsedNsyms = Math.max(parsedNsyms, nsyms)
  for (const [name, d] of table) {
    if (missing.has(name)) {
      desc.set(name, d)
      missing.delete(name)
    }
  }
}

function isWeak(name) {
  if (!desc.has(name)) return null
  return (desc.get(name) & N_WEAK_REF) !== 0
}

const glassWeak = isWeak(targets.glass)
check(
  '断言3 反例：符号表能被正确读取（对照组必须为强引用，伪造符号必须查不到）',
  // 三者同时成立才说明「弱引用判定」不是恒真也不是恒假：一个 strong、一个查不到、一个弱
  isWeak(targets.control) === false && isWeak(targets.blur) === false && !desc.has(targets.bogus),
  [
    '符号表条目 ' + parsedNsyms + ' 个',
    '对照 ' + targets.control + ' → ' + (isWeak(targets.control) === false ? '强引用（符合预期）' : '异常'),
    '对照 ' + targets.blur + ' → ' + (isWeak(targets.blur) === false ? '强引用（符合预期）' : '异常'),
    '反例 ' + targets.bogus + ' → ' + (desc.has(targets.bogus) ? '竟然存在（检查器失效）' : '不存在（符合预期）'),
  ].join('\n'),
)

check(
  '断言4 UIGlassEffect 为弱引用 —— iOS 14~18 上不会因 dyld 找不到符号而启动崩溃',
  glassWeak === true,
  glassWeak === true
    ? '弱引用确认：@available/#available 才能真正挡住老系统调用（强引用会让 App 根本起不来）'
    : glassWeak === false
      ? '!! 强引用：老系统启动即 crash，必须检查 #if/#available 守卫写法'
      : '符号表中不存在：断言1 已说明代码可能未被编译',
)

// ---------------------------------------------------------------------------
console.log()
const failed = results.filter((r) => !r.ok)
if (failed.length) {
  console.error('失败 ' + failed.length + '/' + results.length + ' 项，退出码 1')
  process.exit(1)
}
console.log('全部通过 ' + results.length + '/' + results.length)
