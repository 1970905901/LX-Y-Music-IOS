/**
 * sim-cover-shape.js
 *
 * 「方形封面」契约不变量。
 *
 * 背景：播放详情页设置里新增「方形封面」开关，语义 = 开则封面为方形**且不旋转**。
 * 这条语义有三个必须同时成立、彼此却没有编译期联系的落点：
 *   ① 设置键与默认值（`src/config/defaultSetting.ts` 的 `playDetail.style.coverShape`）；
 *   ② 类型声明（`src/types/app_setting.d.ts`，'circle' | 'square'）；
 *   ③ 两个封面组件（竖屏 `Vertical/Pic.tsx`、横屏 `Horizontal/Pic.tsx`）
 *      必须把「方形」同时作用于**两个**维度：圆角改小 + 旋转停掉。
 *
 * 为什么不能只做一半（只改圆角、不关旋转，或反之）：
 * 方形绕中心旋转时四角扫出 2√2 倍外接范围，即使容器裁切也只见抖动残角；
 * 圆形之所以能旋转，是因为旋转后与自身重合。故「方形 + 旋转」不是「不好看」，
 * 而是**没有观感自洽的实现**——两个维度必须一起改。
 *
 * 为什么需要机械守卫：`tsc`/`eslint` 对「圆角分支漏改」「动画启停漏改」
 * 完全无感（两边都是 boolean 表达式，类型永远对），而症状只在不旋转的真机上
 * 才看得见。本脚本把三处落点绑在一起，并带反例自检。
 *
 * 运行：node scripts/sim-cover-shape.js
 * 退出码：不变量 1~6 全过、且 6 例反例全被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const DEFAULTS = 'src/config/defaultSetting.ts'
const TYPES = 'src/types/app_setting.d.ts'
const VERTICAL = 'src/screens/PlayDetail/Vertical/Pic.tsx'
const HORIZONTAL = 'src/screens/PlayDetail/Horizontal/Pic.tsx'
const SETTING = 'src/screens/PlayDetail/components/SettingPopup/settings/SettingCoverShape.tsx'
const POPUP = 'src/screens/PlayDetail/components/SettingPopup/index.tsx'
const LANG = 'src/lang/zh-cn.json'

const REAL = {
  defaults: read(DEFAULTS),
  types: read(TYPES),
  vertical: read(VERTICAL),
  horizontal: read(HORIZONTAL),
  setting: read(SETTING),
  popup: read(POPUP),
  lang: JSON.parse(read(LANG)),
}

/** 去行注释与块注释：否则「把某行注释掉」的篡改会被当成仍然存在（NOTES-conventions 记过这个坑） */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const SQUARE_RADIUS = 4
// 形状字面量（保留作语义说明用；校验逻辑直接读源码字符串）
const _CIRCLE_SHAPE = 'circle'
const _SQUARE_SHAPE = 'square'

/**
 * 封面组件的不变量。`src` = 组件源码，`lang` = 词条表。
 * 拆成函数是为了反例能对**篡改后的源码**跑同一套判断，而不是只验证替换本身。
 */
function coverInvariants(name, src, lang) {
  const out = []
  const add = (n, ok, detail = '') => out.push({ name: `${name} · ${n}`, ok, detail })
  const code = stripComments(src)

  // 1. 方形判定必须来自设置值，且必须有 allowSpin = spin && !square 这一处合流
  {
    const reads = /useSettingValue\(['"]playDetail\.style\.coverShape['"]\)/.test(code)
    const isSquare = /const\s+isSquare\s*=\s*coverShape\s*===\s*'square'/.test(code)
    const allowSpin = /const\s+allowSpin\s*=\s*isCoverSpin\s*&&\s*!isSquare/.test(code)
    add(
      'invariant 1: 读 coverShape 设置且 isSquare / allowSpin 判定成形',
      reads && isSquare && allowSpin,
      `读设置=${reads} isSquare=${isSquare} allowSpin=${allowSpin}`,
    )
  }

  // 2. **旋转维度**：动画启停的每一处都必须走最终的旋转门 `spinAllowed`，且
  //    spinAllowed 必须以 allowSpin（方形互斥）为前提合流：
  //      allowSpin    = isCoverSpin && !isSquare              （方形不旋转）
  //      spinAllowed  = allowSpin && !covered && appActive     （不可见即停，2026-10-01）
  //    只做后者、丢掉方形判定，等于把「方形不旋转」又放回去了；
  //    只做前者、丢掉不可见门，则方形判定成立但锁屏/被覆盖时照转。
  //    合法的 `isCoverSpin` 出现位置只有两处：① useSettingValue 读取行；② allowSpin 合流行。
  {
    const readLine = /const\s+isCoverSpin\s*=\s*useSettingValue\([^)]*\)/
    const body = code
      .replace(readLine, '') // 去掉读取行
      .replace(/const\s+allowSpin\s*=\s*isCoverSpin[^;\n]*;?/, '') // 去掉 allowSpin 合流行
    const leftover = [...body.matchAll(/isCoverSpin/g)].length
    const hasRead = readLine.test(code)
    // 最终门必须以 allowSpin（而非裸 isCoverSpin）为前提合流
    const gateOk = /const\s+spinAllowed\s*=\s*allowSpin\s*&&\s*!covered\s*&&\s*appActive/.test(code)
    const guards = [...code.matchAll(/!\s*spinAllowed/g)].length // startAnimation 守卫
    const gates = [...code.matchAll(/isPlay\s*&&\s*spinAllowed/g)].length // 两个 effect 的启停门控
    add(
      'invariant 2: 旋转启停全部走 spinAllowed（= allowSpin && !covered && appActive；守卫 1 + 门控 2）',
      hasRead && leftover === 0 && gateOk && guards === 1 && gates === 2,
      `读取行=${hasRead} 残留=${leftover} 合流=${gateOk} 守卫=${guards} 门控=${gates}`,
    )
  }

  // 3. **圆角维度**：方形分支必须给出小圆角，圆形分支仍为半径。
  //    竖屏写命名常量 SQUARE_RADIUS、横屏写字面量 4 —— 两种都接受。
  //    必须锚在**不带取反**的 `isSquare ?` 上：`!isSquare ? 4 : ...` 是把判断写反了，
  //    那种写法虽然也「出现了 isSquare 和 4」，但方形拿到的是二分之一、圆形拿到小圆角。
  {
    const squareRadius = new RegExp(`(?<!!)\\bisSquare\\s*\\?\\s*(?:SQUARE_RADIUS|${SQUARE_RADIUS})\\b`).test(code)
    // 竖屏 size/2、横屏 imgWidth/2 两种写法都算「圆形分支 = 二分之一」
    const circleRadius = /:\s*(?:size|imgWidth)\s*\/\s*2\b/.test(code)
    // 反向写法：!isSquare ? 小圆角（判断写反）
    const inverted = new RegExp(`!\\s*isSquare\\s*\\?\\s*(?:SQUARE_RADIUS|${SQUARE_RADIUS})\\b`).test(code)
    add(
      'invariant 3: 圆角分支 = 方形取小圆角 / 圆形取二分之一（两个维度都改、且未写反）',
      squareRadius && circleRadius && !inverted,
      `方形分支=${squareRadius} 圆形分支=${circleRadius} 判断写反=${inverted}`,
    )
  }

  // 3b. 若用了命名常量，其值必须就是 4（否则「常量」把守卫架空了）
  {
    const named = /const\s+SQUARE_RADIUS\s*=\s*(\d+)/.exec(code)
    add(
      `invariant 3b: SQUARE_RADIUS 常量（若存在）必须等于 ${SQUARE_RADIUS}`,
      named == null || Number(named[1]) === SQUARE_RADIUS,
      named == null ? '未用命名常量（字面量写法，跳过）' : `SQUARE_RADIUS=${named[1]}`,
    )
  }

  // 4. 竖/横屏两处的方形圆角必须是同一个观感值（否则横竖屏切一下封面形状就不一致）。
  //    由调用方在下方 crossInvariants 里统一比对，这里仅断言本文件取到的是 4。
  {
    const m = /(?<!!)\bisSquare\s*\?\s*(SQUARE_RADIUS|\d+)/.exec(code)
    const used = m ? m[1] : null
    const resolved = used === 'SQUARE_RADIUS'
      ? Number((/const\s+SQUARE_RADIUS\s*=\s*(\d+)/.exec(code) ?? [])[1])
      : Number(used)
    add(
      `invariant 4: 方形圆角解析值 = ${SQUARE_RADIUS}`,
      resolved === SQUARE_RADIUS,
      `取到 ${used} → 解析为 ${resolved}`,
    )
  }

  // 5. 依赖数组必须带上 isSquare（漏了则切形状后圆角不重算）。
  //    不能用「对象字面量 + 依赖数组」的正则一把抓：样式对象里有嵌套的
  //    `transform: [{ rotate: spin }]`，`[^\]]*` 会在第一个 `]` 处截断。
  //    改为按 useMemo 起止切片，再取该段**最后一个** `], [ ... ])` 的依赖数组。
  {
    const deps = []
    const starts = [...code.matchAll(/useMemo\(\(\)\s*=>/g)].map((m) => m.index)
    for (let i = 0; i < starts.length; i++) {
      const seg = code.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : code.length)
      if (!/borderRadius/.test(seg)) continue
      const m = /,\s*\[([^\]]*)\]\)/.exec(seg)
      if (m) deps.push(m[1])
    }
    // 依赖数组里必须有一个「形状的真值来源」：
    //   - 直接依赖 isSquare（横屏主样式写法）；或
    //   - 依赖 radius —— 它已由 `isSquare ? ... : ...` 推导（竖屏写法）；或
    //   - 依赖 imageContainerStyle.borderRadius —— 派生自上一层已含形状的样式（横屏内层写法）。
    //     三者都没有 = 切形状后圆角不重算（真 bug）。
    const shapeSource = (d) => /\bisSquare\b|\bradius\b|imageContainerStyle\.borderRadius/.test(d)
    const ok = deps.length > 0 && deps.every(shapeSource)
    add(
      'invariant 5: 含 borderRadius 的 useMemo 依赖数组含 isSquare 或 radius（形状真值来源）',
      ok,
      deps.length ? deps.map((d) => `[${d.trim()}]`).join(' ') : '未找到含 borderRadius 的 useMemo',
    )
  }

  // 6. 设置组件：写入 'square' / 'circle'，且说明文案真被引用
  {
    const writesSquare = /'playDetail\.style\.coverShape':\s*isOn\s*\?\s*'square'\s*:\s*'circle'/.test(
      stripComments(REAL.setting),
    )
    const hasDesc = /t\(['"]play_detail_setting_cover_shape_desc['"]\)/.test(stripComments(REAL.setting))
    const descExists = lang.play_detail_setting_cover_shape_desc != null &&
      lang.play_detail_setting_cover_shape_desc !== ''
    const descSaysNoSpin = /不旋转/.test(String(lang.play_detail_setting_cover_shape_desc ?? ''))
    add(
      'invariant 6: 设置组件写入 square/circle，且「不旋转」被写进说明文案（文案不得与实现脱节）',
      writesSquare && hasDesc && descExists && descSaysNoSpin,
      `写值=${writesSquare} 引用文案=${hasDesc} 词条存在=${descExists} 含「不旋转」=${descSaysNoSpin}`,
    )
  }

  return out
}

/** 全局不变量：默认值 / 类型 / 弹层注册 / 文案（与组件无关，只跑一次） */
function globalInvariants() {
  const out = []
  const add = (n, ok, detail = '') => out.push({ name: n, ok, detail })

  {
    const hasKey = /'playDetail\.style\.coverShape':\s*'circle'/.test(REAL.defaults)
    add(
      "invariant 7: defaultSetting 有 'playDetail.style.coverShape' 且默认 'circle'（保持既有观感）",
      hasKey,
    )
  }

  {
    const decl = /'playDetail\.style\.coverShape':\s*'circle'\s*\|\s*'square'/.test(REAL.types)
    add("invariant 8: 类型声明为 'circle' | 'square'（与 defaultSetting 字面量一致）", decl)
  }

  {
    const imported = /import\s+SettingCoverShape\s+from/.test(REAL.popup)
    const rendered = /<SettingCoverShape\s*\/>/.test(REAL.popup)
    add('invariant 9: 弹层已 import 并渲染 <SettingCoverShape />', imported && rendered,
      `import=${imported} render=${rendered}`)
  }

  {
    const label = REAL.lang.play_detail_setting_cover_shape
    add('invariant 10: 词条 play_detail_setting_cover_shape 存在（否则开关无文字，UI 空白）',
      label != null && label !== '', String(label ?? '缺失'))
  }

  return out
}

/** 反例：把篡改后的源码喂回**同一套** coverInvariants，必须真的被拦下 */
function tamperCases(src) {
  // 竖屏写成命名常量、横屏写成字面量 4；两种形态都要能挂上反例
  const radiusRe = /const radius = isSquare \? (SQUARE_RADIUS|\d+) : (size|imgWidth) \/ 2/
  if (!src.includes('const allowSpin = isCoverSpin && !isSquare') || !radiusRe.test(src)) {
    throw new Error('反例锚点未命中：源码已变，反例需同步')
  }
  return [
    {
      label: '① 只改圆角、不关旋转（方形仍会转 —— 最危险的一半）',
      mutate: (s) => s.replace(
        'const allowSpin = isCoverSpin && !isSquare',
        'const allowSpin = isCoverSpin',
      ),
    },
    {
      label: '② 只关旋转、不改圆角（方形看不出是方形）',
      mutate: (s) => s.replace(/const radius = isSquare \? (?:SQUARE_RADIUS|\d+) : (size|imgWidth) \/ 2/,
        'const radius = $1 / 2'),
    },
    {
      label: '③ 圆角判断反了（圆形取小圆角、方形取半径）',
      mutate: (s) => s.replace(/const radius = isSquare \? (SQUARE_RADIUS|\d+)/,
        'const radius = !isSquare ? $1'),
    },
    {
      // 两种写法都要能挂上：横屏依赖 isSquare、竖屏依赖 radius（由 isSquare 推导）。
      // 抹掉形状真值来源后，依赖数组里只剩 size/spin 之类的「非形状」项。
      label: '④ 依赖数组漏掉形状真值来源（切形状后圆角不重算）',
      mutate: (s) => s
        .replace(/(\},\s*\[winWidth, winHeight, statusBarHeight, )isSquare(, coverSize, layout\])/, '$1$2')
        .replace(/(\} as any\), \[size, )radius(, spin\])/, '$1$2'),
    },
    {
      label: '⑤ 旋转门丢了方形判定（spinAllowed 以裸 isCoverSpin 为前提，方形仍会转）',
      mutate: (s) => s.replace(
        'const spinAllowed = allowSpin && !covered && appActive',
        'const spinAllowed = isCoverSpin && !covered && appActive',
      ),
    },
    {
      label: '⑥ 把 allowSpin 定义注释掉（去注释后必须失效）',
      mutate: (s) => s.replace('const allowSpin = isCoverSpin && !isSquare',
        '// const allowSpin = isCoverSpin && !isSquare'),
    },
    {
      label: '⑦ 启停门控绕过 spinAllowed 直接用 isCoverSpin（同时丢掉方形门与不可见门）',
      mutate: (s) => s.replace('if (isPlay && spinAllowed) {', 'if (isPlay && isCoverSpin) {'),
    },
  ]
}

// ---------- 主流程 ----------
const results = []
const push = (r) => results.push(r)

for (const [label, _file, src] of [
  ['竖屏 Pic', VERTICAL, REAL.vertical],
  ['横屏 Pic', HORIZONTAL, REAL.horizontal],
]) {
  for (const r of coverInvariants(label, src, REAL.lang)) push({ group: '不变量', ...r })

  for (const c of tamperCases(src)) {
    const patched = c.mutate(src)
    if (patched === src) {
      push({
        group: '反例',
        name: `${label} · 反例 ${c.label}`,
        ok: false,
        detail: '替换未命中：源码已变，反例失效需同步',
      })
      continue
    }
    const failed = coverInvariants(label, patched, REAL.lang).filter((r) => !r.ok)
    push({
      group: '反例',
      name: `${label} · 反例 ${c.label} 被拦下`,
      ok: failed.length > 0,
      detail: failed.length
        ? `命中：${failed.map((r) => r.name.split('· ')[1].split(':')[0]).join('、')}`
        : '未被任何不变量拦下（守卫无效）',
    })
  }
}

for (const r of globalInvariants()) push({ group: '不变量', ...r })

// 全局反例：默认值改错、类型漏 square、弹层未注册、文案与实现脱节
{
  const g = [
    {
      label: '⑦ defaultSetting 默认值改成 square（会悄悄改掉所有用户的既有观感）',
      run: () => {
        const patched = {
          ...REAL,
          defaults: REAL.defaults.replace(
            "'playDetail.style.coverShape': 'circle'", "'playDetail.style.coverShape': 'square'"),
        }
        return patched
      },
    },
    {
      label: '⑧ 类型声明漏掉 square（与 defaultSetting 字面量脱节）',
      run: () => ({ ...REAL, types: REAL.types.replace(/'circle'\s*\|\s*'square'/, "'circle'") }),
    },
    {
      label: '⑨ 弹层未渲染 <SettingCoverShape />（开关根本点不到）',
      run: () => ({ ...REAL, popup: REAL.popup.replace('<SettingCoverShape />', '') }),
    },
    {
      // 注意：必须真的把「不旋转」抹掉。第一版替换串漏了原文里的「，且」，
      // replace 未命中 → 值没变 → 反例 ⑩ 假绿（守卫自身没有生效）。
      label: '⑩ 文案删掉「不旋转」（说明与实现脱节，用户以为能叠着开）',
      run: () => ({
        ...REAL,
        lang: {
          ...REAL.lang,
          play_detail_setting_cover_shape_desc:
            String(REAL.lang.play_detail_setting_cover_shape_desc ?? '').replace(/不旋转/g, ''),
        },
      }),
    },
  ]
  for (const c of g) {
    const patch = c.run()
    const changed = Object.keys(patch).some((k) => patch[k] !== REAL[k])
    if (!changed) {
      push({ group: '反例', name: `反例 ${c.label}`, ok: false, detail: '替换未命中：源码已变' })
      continue
    }
    // 临时把 REAL 换成 patch，把**全局**与**组件级**两套不变量都跑一遍
    // （文案断言 invariant 6 住在组件级那套里，只跑全局会漏判 —— 反例 ⑩ 第一版就这么假绿的）
    const saved = { ...REAL }
    Object.assign(REAL, patch)
    const failed = [
      ...globalInvariants(),
      ...coverInvariants('竖屏 Pic', REAL.vertical, REAL.lang),
      ...coverInvariants('横屏 Pic', REAL.horizontal, REAL.lang),
    ].filter((r) => !r.ok)
    Object.assign(REAL, saved)
    push({
      group: '反例',
      name: `反例 ${c.label} 被拦下`,
      ok: failed.length > 0,
      detail: failed.length
        ? `命中：${failed.map((r) => r.name.split(':')[0]).join('、')}`
        : '未被任何不变量拦下（守卫无效）',
    })
  }
}

// ---------- 输出 ----------
let pass = 0
let fail = 0
let lastGroup = ''
for (const r of results) {
  if (r.group !== lastGroup) {
    console.log(`\n--- ${r.group} ---`)
    lastGroup = r.group
  }
  if (r.ok) {
    pass++
    console.log(`  PASS  ${r.name}`)
  } else {
    fail++
    console.log(`  FAIL  ${r.name}`)
  }
  if (r.detail) console.log(`        ${r.detail}`)
}

console.log('\n' + '='.repeat(70))
console.log(`结果：${pass} 通过 / ${fail} 失败`)
console.log('='.repeat(70))
process.exit(fail ? 1 : 0)
