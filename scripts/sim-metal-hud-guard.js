/**
 * sim-metal-hud-guard.js
 *
 * 「Metal Performance HUD 只许被清除、不许被本 App 打开」契约。
 *
 * 背景（2026-10-16 真机反馈）：iOS 18.7.8 上主题设置打开「液态玻璃」后，玻璃上盖了一层黑色
 * 帧率浮层（Metal 设备名 + 分辨率 + 缩放/Compositing + FPS/帧间隔 + 120 帧柱状图），App 内
 * 无法关闭 —— 这是 Apple 的 Metal Performance HUD（Xcode 调试浮层），不是本工程画的：浮层只
 * 盖在 App 的 Metal 内容上，而本 App 唯一的 Metal 内容就是液态玻璃的 MTKView。
 *
 * Apple 文档（Xcode → Debugging → Monitoring your Metal app's graphics performance）列出的
 * 开启方式共 5 条，按「谁有权关」分三类：
 *   · 设备级：设置 → 开发者 → Graphics HUD → Show Graphics HUD —— App 无权关闭，只能在设备上关
 *   · 运行期：Xcode 运行方案 Show Graphics Overview（只作用于 Xcode 启动的那个进程）
 *   · 进程内：环境变量 MTL_HUD_ENABLED、App 自身 UserDefaults 的 MetalHUDForceEnabled、
 *             Info.plist 的 MetalHudEnabled —— 本 App 必须自己清干净
 *
 * 本契约守护 AppDelegate 里的清除门（LXDisableMetalPerformanceHudDiagnostic）：
 *   1) 门存在，且在 didFinishLaunchingWithOptions 里最先执行（早于任何 Metal 内容创建）；
 *   2) 门内同时清掉环境变量与 UserDefaults 两条进程内标记；
 *   3) 全仓搜索：这些键只允许出现在「读取 / 删除」形态里 —— 任何写入（setenv /
 *      setObject: / Info.plist 条目 / xcscheme 里的 Graphics HUD 选项）都是把调试浮层
 *      强开给所有安装包的通道，一律拦截。
 * 为什么方向必须单向：删除最多让浮层消失；写入则会把黑框强开给每一个用户（本 App 里它正好
 * 盖在 Tab 栏 / 迷你播放条上，用户还会以为是自己打开了什么开关）。
 *
 * 运行：node scripts/sim-metal-hud-guard.js
 * 退出码：全部通过 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

const APP_DELEGATE = 'ios/LxMusicMobile/AppDelegate.mm'
const PLIST = 'ios/LxMusicMobile/Info.plist'
const SCHEME = 'ios/LxMusicMobile.xcodeproj/xcshareddata/xcschemes/LxMusicMobile.xcscheme'

// 全仓扫描范围：本项目自己维护的源码 / 配置（vendored 的 LXLibFLAC 是上游 C 代码，与本契约无关）
const SCAN_DIRS = ['ios/LxMusicMobile', 'ios/Vendor/LiquidGlassKit', 'patches', 'src']
const SCAN_EXTS = new Set(['.mm', '.m', '.h', '.hpp', '.swift', '.plist', '.pbxproj', '.js', '.ts', '.tsx', '.json'])
const SCAN_EXTRA = ['ios/Podfile', SCHEME]

const KEY_RE = /\b(?:MetalHUD[A-Za-z]*|MetalHud[A-Za-z]*|MTL_HUD[A-Z_]*)\b/g
// 唯一被允许的形态：读取（getenv / objectForKey）或删除（unsetenv / removeObjectForKey）
const ALLOWED_RE = /(?:getenv\(|unsetenv\(|objectForKey:|removeObjectForKey:)/

const GUARD_FN = 'LXDisableMetalPerformanceHudDiagnostic'
const GUARD_CALL = GUARD_FN + '();'
const LAUNCH_SIG = 'didFinishLaunchingWithOptions'
const LAUNCH_FIRST_STMT = 'LXRegisterTrackPlayerLifecycleObserver();'
const ENV_CLEAR = 'unsetenv("MTL_HUD_ENABLED")'
const DEFAULTS_CLEAR = '[[NSUserDefaults standardUserDefaults] removeObjectForKey:@"MetalHUDForceEnabled"];'
const PLIST_ENABLER_RE = /<key>\s*MetalHudEnabled\s*<\/key>/
const SCHEME_HUD_RE = /Graphics\s*HUD|MetalHUD|showGraphicsOverview/i

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

// 去注释、保留字符串字面量：注释里提到这些键属于说明文字，不该触发写入检查
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

const listScannedFiles = () => {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!SCAN_EXTS.has(path.extname(entry.name))) continue
      files.push(full)
    }
  }
  for (const rel of SCAN_DIRS) walk(path.join(ROOT, rel))
  for (const rel of SCAN_EXTRA) files.push(path.join(ROOT, rel))
  return files
}

const sourceOf = (full) => ({ file: path.relative(ROOT, full).replace(/\\/g, '/'), text: stripComments(fs.readFileSync(full, 'utf8')) })

// ③ 写入式开启（含 JS/plist/pbxproj 等一切被扫描文件）——只允许读取/删除形态
const scanWriteViolations = (sources) => {
  const violations = []
  for (const { file, text } of sources) {
    text.split('\n').forEach((line, index) => {
      if (!KEY_RE.test(line)) return
      if (ALLOWED_RE.test(line)) return
      violations.push({ rule: 'write', where: `${file}:${index + 1}`, detail: `出现「写入式开启」形态：${line.trim()}` })
    })
  }
  return violations
}

const checkAll = ({ appDelegate, plist, scheme, sources }) => {
  const violations = []
  // 结构判定一律用「去注释」文本：注释里出现函数名/键名不算数（否则删掉代码留条注释也能过）
  const code = stripComments(appDelegate)

  // ① 清除门定义 + 调用
  const defIndex = code.search(new RegExp('^static void ' + GUARD_FN + '\\(void\\) \\{', 'm'))
  if (defIndex < 0) {
    violations.push({ rule: 'guard-def', where: APP_DELEGATE, detail: `缺少 ${GUARD_FN} 定义（Metal Performance HUD 清除门）` })
  }
  const fileCallIndex = code.indexOf(GUARD_CALL)
  if (fileCallIndex < 0) {
    violations.push({ rule: 'guard-call', where: APP_DELEGATE, detail: `全文件未见 ${GUARD_CALL} 调用` })
  } else if (defIndex >= 0 && fileCallIndex < defIndex) {
    violations.push({ rule: 'guard-order', where: APP_DELEGATE, detail: `${GUARD_FN} 调用早于定义（.mm 是 ObjC++，无隐式声明）` })
  }

  // ② 门内两条清理动作
  if (defIndex >= 0) {
    const bodyEnd = code.indexOf('\n}', defIndex)
    const body = code.slice(defIndex, bodyEnd < 0 ? undefined : bodyEnd)
    if (!body.includes(ENV_CLEAR)) {
      violations.push({ rule: 'guard-env', where: APP_DELEGATE, detail: `清除门未清环境变量：缺 ${ENV_CLEAR}` })
    }
    if (!body.includes(DEFAULTS_CLEAR)) {
      violations.push({ rule: 'guard-defaults', where: APP_DELEGATE, detail: `清除门未清 UserDefaults 标记：缺 ${DEFAULTS_CLEAR}` })
    }
  }

  // ①b 必须在 didFinishLaunchingWithOptions 里最先执行（早于任何 Metal 内容）
  const launchStart = code.indexOf(LAUNCH_SIG)
  const launchBodyEnd = launchStart >= 0 ? code.indexOf('\n}', launchStart) : -1
  const launchBody = launchStart >= 0 ? code.slice(launchStart, launchBodyEnd < 0 ? undefined : launchBodyEnd) : ''
  const launchCallIndex = launchBody.indexOf(GUARD_CALL)
  if (launchCallIndex < 0) {
    violations.push({ rule: 'guard-call', where: APP_DELEGATE, detail: `未在 ${LAUNCH_SIG} 内调用清除门` })
  } else {
    const firstStmtIndex = launchBody.indexOf(LAUNCH_FIRST_STMT)
    if (firstStmtIndex >= 0 && launchCallIndex > firstStmtIndex) {
      violations.push({ rule: 'guard-late', where: APP_DELEGATE, detail: `清除门晚于 ${LAUNCH_FIRST_STMT}，不再是启动首条语句` })
    }
  }

  // ③ 全仓不得有写入式开启（这三个被契约直接检查的文件用「传入文本」参与扫描，
  //    这样反例变异出的写入也走同一套判定，不会漏检）
  const overridden = new Set([APP_DELEGATE, PLIST, SCHEME])
  const scanTargets = [
    { file: APP_DELEGATE, text: code },
    { file: PLIST, text: stripComments(plist) },
    { file: SCHEME, text: stripComments(scheme) },
    ...sources.filter((source) => !overridden.has(source.file)),
  ]
  violations.push(...scanWriteViolations(scanTargets))

  // ④ Info.plist / xcscheme 这两个「一键强开给所有人」的入口
  if (PLIST_ENABLER_RE.test(stripComments(plist))) {
    violations.push({ rule: 'plist-enabler', where: PLIST, detail: 'Info.plist 出现 MetalHudEnabled —— 等于给所有安装包强开调试浮层' })
  }
  if (SCHEME_HUD_RE.test(stripComments(scheme))) {
    violations.push({ rule: 'scheme-hud', where: SCHEME, detail: 'xcscheme 打开了 Graphics HUD 运行诊断' })
  }

  return violations
}

// 行为模型：三类开启来源 × 清除门
const hudVisible = (state) => Boolean(state.env || state.defaults || state.device)
const applyGuard = (state) => ({ ...state, env: null, defaults: null })

const models = [
  ['进程内标记（env / defaults）被打开 → 用户看到黑色帧率浮层', hudVisible({ env: '1', defaults: null, device: false }) === true],
  ['清除门生效 → 进程内标记全清、浮层消失', hudVisible(applyGuard({ env: '1', defaults: '1', device: false })) === false],
  ['设备级 Graphics HUD 不受 App 影响（清除门后仍可见 → 只能在设备上关）', hudVisible(applyGuard({ env: null, defaults: null, device: true })) === true],
  ['清除门单向：任意输入都不会产生进程内标记（删除不可能把浮层打开）',
    [{ env: '1', defaults: '1' }, { env: null, defaults: null }, { env: '0', defaults: 'x' }]
      .every((state) => { const after = applyGuard(state); return after.env === null && after.defaults === null })],
]

const REAL_APP_DELEGATE = read(APP_DELEGATE)
const REAL_PLIST = read(PLIST)
const REAL_SCHEME = read(SCHEME)
const REAL_SOURCES = listScannedFiles().map(sourceOf)

const view = () => ({ appDelegate: REAL_APP_DELEGATE, plist: REAL_PLIST, scheme: REAL_SCHEME, sources: REAL_SOURCES })
const counterExamples = []
const expectCaught = (name, expectRule, mutate) => {
  let mutated
  try {
    mutated = { ...view(), ...mutate(view()) }
  } catch (err) {
    counterExamples.push([name, false, `变异执行失败：${err.message}`])
    return
  }
  const rules = checkAll(mutated).map((v) => v.rule)
  const hit = rules.includes(expectRule)
  counterExamples.push([name, hit, hit ? `已拦下（${expectRule}）` : `未拦下（rules=${JSON.stringify(rules)}）`])
}

expectCaught('C1 删掉环境变量清理', 'guard-env', (v) => ({ appDelegate: v.appDelegate.replace(ENV_CLEAR + ';', '/* removed */') }))
expectCaught('C2 把环境变量清理改成写入 setenv', 'write', (v) => ({ appDelegate: v.appDelegate.replace(ENV_CLEAR + ';', 'setenv("MTL_HUD_ENABLED", "1", 1);') }))
expectCaught('C3 删掉 UserDefaults 清理', 'guard-defaults', (v) => ({ appDelegate: v.appDelegate.replace(DEFAULTS_CLEAR, '') }))
expectCaught('C4 把 UserDefaults 清理改成写入', 'write', (v) => ({ appDelegate: v.appDelegate.replace(DEFAULTS_CLEAR, '[[NSUserDefaults standardUserDefaults] setObject:@1 forKey:@"MetalHUDForceEnabled"];') }))
expectCaught('C5 didFinishLaunchingWithOptions 不再调用清除门', 'guard-call', (v) => ({ appDelegate: v.appDelegate.replace(GUARD_CALL, '') }))
expectCaught('C6 Info.plist 被塞进 MetalHudEnabled', 'plist-enabler', () => ({ plist: REAL_PLIST.replace('</dict>', '<key>MetalHudEnabled</key><true/></dict>') }))
expectCaught('C7 xcscheme 打开 Graphics HUD', 'scheme-hud', () => ({ scheme: REAL_SCHEME.replace('<LaunchAction', '<LaunchAction showGraphicsHUD="YES"') }))

const violations = checkAll(view())
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
  console.error(`FAIL  Metal Performance HUD 契约未通过：违例 ${violations.length} 项、模型失败 ${failedModels.length} 例、反例漏检 ${missed.length} 例`)
  process.exit(1)
}
console.log(`PASS  Metal Performance HUD 只许被清除、不许被本 App 打开（规则 7 条 + 行为模型 ${models.length} 例 + 反例 ${counterExamples.length} 例）`)
process.exit(0)
