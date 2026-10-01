/**
 * check-i18n-keys.js
 *
 * 文案 key 存在性检查：源码里引用的翻译 key 必须都能在 zh-cn.json 里找到。
 *
 * 为什么需要它：`src/lang/i18n.ts` 的 `getMessage` 对缺失 key 返回 `''`
 * （`msg[key] ?? fallback[key] ?? ''`）—— 不抛错、不打 warning、不做兜底文案。
 * 结果是 UI 上直接**空白**，而 tsc / eslint 全绿（`t` 的签名是 `(key: string) => string`，
 * key 不在类型体系里）。真实事故：音效弹层的两个环境混响项
 * `setting_play_sound_effect_env_matrix_1` / `_matrix_2` 只有 labelKey、没有词条，
 * 环境混响列表里就多了两个「只有勾选框、没有文字」的项
 * （播放详情 → 音效，2026-09-30 修复）。
 *
 * 只检查**字面量 key**（`t('xxx')`、`labelKey: 'xxx'` 等）；模板字符串 / 变量拼接的
 * 动态 key 静态不可判定，直接跳过（宁可漏报，不可误报）。
 *
 * 运行：node scripts/check-i18n-keys.js
 * 退出码：有缺失 key 时为 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const MESSAGES = 'src/lang/zh-cn.json'
const SRC = 'src'

/** 匹配源码中的字面量 key */
const KEY_PATTERNS = [
  { re: /\bt\(\s*'([^'\\]*)'/g, kind: 't()' },
  { re: /\bt\(\s*"([^"\\]*)"/g, kind: 't()' },
  { re: /\b[A-Za-z_$][\w$]*[Kk]ey\s*:\s*'([^'\\]*)'/g, kind: 'xxxKey' },
  { re: /\b[A-Za-z_$][\w$]*[Kk]ey\s*:\s*"([^"\\]*)"/g, kind: 'xxxKey' },
]

/** key 的合法形态：小写字母开头，只含小写字母/数字/下划线。
 *  以下一律跳过 —— 避免把非文案 key 或动态 key 误报成缺失：
 *    - 模板串（含 `${}`）、大写开头、含中文/空格；
 *    - **含点的设置项路径**（如 `SliderRow` 的 `settingKey: 'theme.blur'` 会被
 *      `xxxKey:` 规则撞上）。实测 zh-cn.json 全部 769 个词条中没有任何含点的 key，
 *      故按形状排除是安全的。 */
const KEY_SHAPE = /^[a-z][a-z0-9_]*$/

function collectFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (name !== 'node_modules') collectFiles(p, out)
    } else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const FILES = collectFiles(path.join(ROOT, SRC)).map((p) => [
  path.relative(ROOT, p).replace(/\\/g, '/'),
  fs.readFileSync(p, 'utf8'),
])

/**
 * 收集字面量 key 引用。
 * @returns {Map<string, string[]>} key → ['相对路径:行号 (来源形态)']
 */
function collectRefs(files = FILES) {
  const refs = new Map()
  for (const [rel, text] of files) {
    const lines = text.split('\n')
    for (const { re, kind } of KEY_PATTERNS) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(text))) {
        const key = m[1]
        if (!KEY_SHAPE.test(key)) continue
        const line = text.slice(0, m.index).split('\n').length
        const list = refs.get(key) ?? []
        list.push(`${rel}:${line} (${kind})`)
        refs.set(key, list)
      }
    }
    void lines
  }
  return refs
}

/** @returns {Map<string, string[]>} 缺失的 key → 引用点 */
function findMissing(messages, refs = collectRefs()) {
  const missing = new Map()
  for (const [key, sites] of refs) {
    if (messages[key] == null) missing.set(key, sites)
  }
  return missing
}

// ---------------------------------------------------------------------------

const messages = JSON.parse(fs.readFileSync(path.join(ROOT, MESSAGES), 'utf8'))
const refs = collectRefs()
const missing = findMissing(messages, refs)

console.log('文案 key 存在性检查\n')

let failed = 0
const report = (pass, name, detail) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (detail) console.log(`      ${detail}`)
  if (!pass) failed++
}

report(
  missing.size === 0,
  `不变量1 源码引用的字面量 key 全部存在于 ${MESSAGES}`,
  missing.size === 0
    ? `${refs.size} 个不同 key / ${[...refs.values()].reduce((n, v) => n + v.length, 0)} 处引用，0 处缺失`
    : [...missing.entries()]
        .map(([key, sites]) => `\n        缺失 [${key}] ← ${sites.join('、')}\n          修法：在 ${MESSAGES} 补词条（缺失时 getMessage 返回空串，UI 上直接空白）`)
        .join(''),
)

// --- 不变量 2（反例）：删掉一个**被引用**的词条后必须报出来 ---
{
  const victim = [...refs.keys()].find((key) => messages[key] != null)
  if (!victim) {
    report(false, '不变量2 反例：删词条后必须报错', '找不到任何被引用的词条，检查逻辑可能失效')
  } else {
    const broken = { ...messages }
    const original = broken[victim]
    delete broken[victim]
    const detected = findMissing(broken, refs).has(victim)
    // 顺带确认词条确实存在（否则「删掉了」本身无从谈起）
    const existed = original != null
    report(
      detected && existed,
      '不变量2 反例：删掉一个被引用的词条后必须报错（否则规则形同虚设）',
      `删除 [${victim}]（原值「${original}」）后${detected ? '被报出' : '**未**被报出'}`,
    )
  }
}

// --- 不变量 3（反例）：形状过滤必须挡住动态 key，否则会大量误报 ---
{
  const legal = ['setting_ok_key', 'saved', 'understand']
  // eslint-disable-next-line no-template-curly-in-string -- 反例样本必须原样保留 ${...} 字面量
  const illegal = ['${dynamic}', 'Setting_Upper', '有中文', 'has space', 'theme.blur', '']
  const legalPass = legal.every((s) => KEY_SHAPE.test(s))
  const illegalPass = illegal.every((s) => !KEY_SHAPE.test(s))
  report(
    legalPass && illegalPass,
    '不变量3 反例：动态 key / 非法形态必须被跳过（避免误报）',
    `合法 ${legal.length} 个全通过、非法 ${illegal.length} 个全跳过` +
      (legalPass && illegalPass ? '' : '（形状过滤失效，会产生误报）'),
  )
}

console.log(`\n===== ${3 - failed}/3 项通过 =====`)

if (failed > 0) {
  console.error(`\n文案 key 检查未通过 ${failed} 项，退出码 1`)
  process.exit(1)
}
