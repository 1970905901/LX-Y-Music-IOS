/**
 * sim-bluetooth-lyric.js
 *
 * 「显示蓝牙歌词」契约不变量。
 *
 * 背景：播放设置页新增「显示蓝牙歌词」开关，语义 = 开则把当前歌词行推送到系统
 * 媒体信息（MPNowPlayingInfoCenter 的 artist 字段，控制中心/锁屏/车机/蓝牙音箱
 * 读的都是同一份），关则只显示「歌名 · 歌手」。
 *
 * 关键点：iOS 上「歌词行出现在车机/音箱」有**两条彼此独立**的通路：
 *   ① JS 逐行钩子（`core/init/player/lyric.ts` 的 onLyricPlay → updateMetaData），
 *      把行文本作为 artist 发布；
 *   ② 原生歌词时间轴时钟（`setNowPlayingLyrics` → AppDelegate.mm 的
 *      LXNowPlayingLyricStep），原生按锚点外推位置自行把当前行写进 artist——
 *      这条通路**完全不经过 JS 定时器**（正是为控制中心/锁屏时 JS 停转而设计的）。
 *
 * 因此只关一条通路 = 车机照样显示歌词（另一条仍在写 artist）。本脚本把
 * 「设置键/默认值/类型/两条通路门控/开关 UI 注册/文案」绑成一组不变量，
 * 并带反例自检——tsc/eslint 对这种「boolean 门控漏了一处」完全无感。
 *
 * 运行：node scripts/sim-bluetooth-lyric.js
 * 退出码：不变量 1~7 全过、且全部反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')

const DEFAULTS = 'src/config/defaultSetting.ts'
const TYPES = 'src/types/app_setting.d.ts'
const LYRIC_INIT = 'src/core/init/player/lyric.ts'
const SETTING_UI = 'src/screens/Home/Views/Setting/settings/Player/IsShowBluetoothLyric.tsx'
const PLAYER_INDEX = 'src/screens/Home/Views/Setting/settings/Player/index.tsx'
const LANG = 'src/lang/zh-cn.json'

const KEY = 'player.isShowBluetoothLyric'
const LABEL_KEY = 'setting_play_show_bluetooth_lyric'

const REAL = {
  defaults: read(DEFAULTS),
  types: read(TYPES),
  lyricInit: read(LYRIC_INIT),
  settingUi: read(SETTING_UI),
  playerIndex: read(PLAYER_INDEX),
  lang: JSON.parse(read(LANG)),
}

/** 去行注释与块注释：否则「把某行注释掉」的篡改会被当成仍然存在（NOTES-conventions 记过这个坑） */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

// ---------------------------------------------------------------------------
// 判断逻辑（对传入源码求值，反例可对篡改后的源码跑同一套）
// ---------------------------------------------------------------------------

/**
 * lyric.ts 的不变量：两条通路都必须被 isShowBluetoothLyric() 门控。
 * 返回 { ok, reasons }。
 */
const lyricInitInvariants = (src) => {
  const code = stripComments(src)
  const reasons = []

  // 1) 取值函数存在，且判据是「!== false」（默认开：undefined 也视为开）
  if (!/const isShowBluetoothLyric\s*=\s*\(\s*\)\s*=>/.test(code)) {
    reasons.push('缺少 isShowBluetoothLyric() 取值函数（不能模块级快照，否则切换不生效）')
  }
  if (!/const isShowBluetoothLyric\s*=\s*\(\s*\)\s*=>\s*settingState\.setting\[['"]player\.isShowBluetoothLyric['"]\]\s*\?\?\s*true/.test(code)) {
    reasons.push('取值函数未按「settingState.setting[...] ?? true」判定（默认开语义：undefined 应视为开）')
  }

  // 2) 通路①：onLyricPlay 里歌词行必须经 isShowBluetoothLyric() 门控
  const playHook = code.slice(code.indexOf('onLyricPlay('), code.indexOf('global.app_event.on'))
  if (!playHook) {
    reasons.push('未找到 onLyricPlay 回调（JS 逐行通路）')
  } else {
    // 关时 artist 必须为 undefined：形如 `isShowBluetoothLyric() ? (...) : undefined`
    if (!/isShowBluetoothLyric\s*\(\s*\)\s*\?/.test(playHook)) {
      reasons.push('通路①未门控：onLyricPlay 未按开关决定是否发布歌词行')
    }
    if (!/:\s*undefined/.test(playHook)) {
      reasons.push('通路①关闭分支未回退到 undefined（artist 会残留上一行）')
    }
    // 真实当前行必须与开关无关地记录（否则关闭期间丢行号，重开后要等下一行才恢复）
    if (!/realCurrentLyric\s*=\s*text\s*\|\|\s*undefined/.test(playHook)) {
      reasons.push('通路①未记录 realCurrentLyric（开关与真实行解耦）')
    }
  }

  // 2b) 切歌必须清 realCurrentLyric（否则切歌瞬间开开关会补发上一首最后一行）
  const toggled = code.slice(code.indexOf("global.app_event.on('musicToggled'"))
  if (!toggled) {
    reasons.push('缺少 musicToggled 处理')
  } else if (!/realCurrentLyric\s*=\s*undefined/.test(toggled)) {
    reasons.push('musicToggled 未清 realCurrentLyric（切歌瞬间开开关会补发上一首的歌词行）')
  }

  // 3) 通路②：lyricUpdated 里的 setNowPlayingLyrics 必须经同一开关门控（关时传空数组）
  const updated = code.slice(code.indexOf("global.app_event.on('lyricUpdated'"))
  if (!updated) {
    reasons.push('未找到 lyricUpdated 处理（原生时间轴通路）')
  } else {
    if (!/isShowBluetoothLyric\s*\(\s*\)/.test(updated)) {
      reasons.push('通路②未门控：lyricUpdated 未按开关决定是否提交原生时间轴（车机会照显歌词）')
    }
    if (!/:\s*\[\s*\]/.test(updated)) {
      reasons.push('通路②关闭分支未传空数组（原生时钟仍会写 artist）')
    }
  }

  // 4) applyBluetoothLyricSetting 必须同时对齐两条通路，且关闭时清 lastLyric
  const applyIdx = code.indexOf('applyBluetoothLyricSetting')
  if (applyIdx < 0 || !/export const applyBluetoothLyricSetting/.test(code)) {
    reasons.push('缺少 applyBluetoothLyricSetting 导出（切换开关无法即时生效）')
  } else {
    const applyBody = code.slice(applyIdx)
    if (!/setNowPlayingLyrics\s*\(\s*\[\s*\]\s*\)/.test(applyBody)) {
      reasons.push('apply 的关闭分支未清原生时间轴（setNowPlayingLyrics([])）')
    }
    if (!/setLastLyric\s*\(\s*undefined\s*\)/.test(applyBody)) {
      reasons.push('apply 的关闭分支未清 state.lastLyric（后续 pause/调速重发会把旧歌词写回 artist）')
    }
    // 打开分支必须用 realCurrentLyric 补发（不能等下一行变化）
    if (!/setLastLyric\s*\(\s*realCurrentLyric\s*\)/.test(applyBody)) {
      reasons.push('apply 的打开分支未用 realCurrentLyric 补发当前行')
    }
  }

  return { ok: reasons.length === 0, reasons }
}

/** 全局不变量：设置键/默认值/类型/UI/文案四处的对应关系 */
const globalInvariants = (sources = REAL) => {
  const reasons = []
  const { defaults, types, settingUi, playerIndex, lang } = sources

  // 5) 默认值存在且为 true（默认开 = 保持既有行为）
  const defRe = new RegExp(`'${KEY.replace(/\./g, '\\.')}'\\s*:\\s*(true|false)`)
  const defMatch = defaults.match(defRe)
  if (!defMatch) reasons.push(`defaultSetting 缺少 ${KEY} 默认值`)
  else if (defMatch[1] !== 'true') reasons.push(`${KEY} 默认值应为 true（默认开，保持既有行为），实为 ${defMatch[1]}`)

  // 6) 类型声明为 boolean
  const typeRe = new RegExp(`'${KEY.replace(/\./g, '\\.')}'\\s*:\\s*boolean`)
  if (!typeRe.test(types)) reasons.push(`app_setting.d.ts 缺少 '${KEY}': boolean 声明`)

  // 7) 开关 UI：读同一设置键 + 写同一设置键 + 调用 apply + 用已有文案 key
  const uiCode = stripComments(settingUi)
  if (!uiCode) reasons.push('缺少开关 UI 组件')
  else {
    if (!new RegExp(`useSettingValue\\('${KEY.replace(/\./g, '\\.')}'\\)`).test(uiCode)) {
      reasons.push('开关 UI 未读取同一设置键')
    }
    if (!new RegExp(`'${KEY.replace(/\./g, '\\.')}'\\s*:`).test(uiCode)) {
      reasons.push('开关 UI 未写入同一设置键')
    }
    if (!/applyBluetoothLyricSetting\s*\(\s*\)/.test(uiCode)) {
      reasons.push('开关 UI 未调用 applyBluetoothLyricSetting（切换不即时生效）')
    }
    if (!new RegExp(`t\\('${LABEL_KEY}'\\)`).test(uiCode)) {
      reasons.push(`开关 UI 未使用文案 key ${LABEL_KEY}`)
    }
  }

  // 8) 注册到播放设置页
  const idxCode = stripComments(playerIndex)
  if (!/from\s+'\.[/\w]*IsShowBluetoothLyric'/.test(idxCode)) {
    reasons.push('播放设置页未 import IsShowBluetoothLyric')
  }
  if (!/<IsShowBluetoothLyric\s*\/>/.test(idxCode)) {
    reasons.push('播放设置页未渲染 <IsShowBluetoothLyric />')
  }

  // 9) 文案词条存在且非空
  if (typeof lang[LABEL_KEY] !== 'string' || !lang[LABEL_KEY].trim()) {
    reasons.push(`zh-cn.json 缺少文案词条 ${LABEL_KEY}`)
  }

  return { ok: reasons.length === 0, reasons }
}

// ---------------------------------------------------------------------------
// 反例：篡改真源码后必须被拦下（证明每条不变量真的在起作用）
// ---------------------------------------------------------------------------

/** 对单条源码做替换；替换必须命中（未命中 = 反例本身失效，抛错） */
const tamper = (src, from, to) => {
  if (!src.includes(from)) throw new Error(`反例锚点未命中: ${from}`)
  return src.replace(from, to)
}

const cases = []

/** 反例①：通路①去掉门控（直接用原文） */
cases.push(['① 通路①未门控（直接用 text 发布歌词行）', () => {
  const broken = tamper(REAL.lyricInit, 'isShowBluetoothLyric() ? realCurrentLyric : undefined', 'realCurrentLyric')
  return lyricInitInvariants(broken).ok === false
}])

/** 反例①b：通路①不再记录 realCurrentLyric（关闭期间丢行号） */
cases.push(['①b 通路①未记录 realCurrentLyric', () => {
  const broken = tamper(REAL.lyricInit, 'realCurrentLyric = text || undefined', '// realCurrentLyric = text || undefined')
  return lyricInitInvariants(broken).ok === false
}])

/** 反例①c：打开分支不用 realCurrentLyric 补发（改回 lastLyric，重开后要等下一行） */
cases.push(['①c apply 打开分支误用 lastLyric 补发', () => {
  const broken = tamper(REAL.lyricInit, 'setLastLyric(realCurrentLyric)', 'setLastLyric(playerState.lastLyric)')
  return lyricInitInvariants(broken).ok === false
}])

/** 反例①d：切歌未清 realCurrentLyric */
cases.push(['①d musicToggled 未清 realCurrentLyric', () => {
  const broken = tamper(REAL.lyricInit, 'realCurrentLyric = undefined\n    stop()', 'stop()')
  return lyricInitInvariants(broken).ok === false
}])

/** 反例②：通路②去掉门控（恢复成只判断 lrc） */
cases.push(['② 通路②未门控（原生时钟仍写 artist）', () => {
  const broken = tamper(
    REAL.lyricInit,
    'playerState.musicInfo.lrc && isShowBluetoothLyric() ? getCurrentLyricLines() : []',
    'playerState.musicInfo.lrc ? getCurrentLyricLines() : []',
  )
  return lyricInitInvariants(broken).ok === false
}])

/** 反例③：apply 关闭分支不清 lastLyric */
cases.push(['③ apply 关闭时未清 lastLyric', () => {
  const broken = tamper(REAL.lyricInit, 'setLastLyric(undefined)', '// setLastLyric(undefined)')
  return lyricInitInvariants(broken).ok === false
}])

/** 反例④：默认值被改成 false（改变了既有行为） */
cases.push(['④ 默认值改成 false', () => {
  const broken = tamper(REAL.defaults, `'${KEY}': true`, `'${KEY}': false`)
  return globalInvariants({ ...REAL, defaults: broken }).ok === false
}])

/** 反例⑤：类型声明被删 */
cases.push(['⑤ 类型声明被删', () => {
  const broken = REAL.types.replace(new RegExp(`'${KEY.replace(/\./g, '\\.')}'\\s*:\\s*boolean`), '/* removed */')
  return globalInvariants({ ...REAL, types: broken }).ok === false
}])

/** 反例⑥：开关 UI 不再调用 apply（切换不即时生效） */
cases.push(['⑥ 开关 UI 未调用 apply', () => {
  const broken = tamper(REAL.settingUi, 'applyBluetoothLyricSetting()', '// applyBluetoothLyricSetting()')
  return globalInvariants({ ...REAL, settingUi: broken }).ok === false
}])

/** 反例⑦：播放设置页漏渲染 */
cases.push(['⑦ 播放设置页漏渲染 <IsShowBluetoothLyric />', () => {
  const broken = tamper(REAL.playerIndex, '<IsShowBluetoothLyric />', '{/* removed */}')
  return globalInvariants({ ...REAL, playerIndex: broken }).ok === false
}])

/** 反例⑧：文案词条被删 */
cases.push(['⑧ 文案词条被删', () => {
  const broken = { ...REAL.lang }
  delete broken[LABEL_KEY]
  return globalInvariants({ ...REAL, lang: broken }).ok === false
}])

/** 反例⑨：取值函数快照化（模块级读一次，切换不生效） */
cases.push(['⑨ 取值函数快照化（模块级读一次）', () => {
  const broken = tamper(
    REAL.lyricInit,
    "const isShowBluetoothLyric = () => settingState.setting['player.isShowBluetoothLyric'] ?? true",
    'const isShowBluetoothLyric = () => true',
  )
  return lyricInitInvariants(broken).ok === false
}])

// ---------------------------------------------------------------------------

let failed = 0
const report = (pass, name, detail) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
  if (detail) console.log(`      ${detail}`)
  if (!pass) failed++
}

console.log('「显示蓝牙歌词」契约不变量\n')

// 先跑正例
const lyric = lyricInitInvariants(REAL.lyricInit)
report(lyric.ok, '不变量(lyric.ts) 两条通路均按开关门控 + apply 同时对齐两路',
  lyric.ok ? 'onLyricPlay / lyricUpdated / applyBluetoothLyricSetting 均正确门控' : lyric.reasons.join('\n      '))

const global = globalInvariants()
report(global.ok, '不变量(全局) 设置键/默认值/类型/UI/注册/文案 六处一致',
  global.ok ? `${KEY}（默认 true）在 6 处落点全部对齐` : global.reasons.join('\n      '))

// 再跑反例
cases.forEach(([name, run]) => {
  let pass = false
  try {
    pass = run()
  } catch (e) {
    report(false, `反例 ${name}`, `执行异常：${e.message}`)
    return
  }
  report(pass, `反例 ${name}`, pass ? '已被拦下' : '**未被拦下**（不变量形同虚设）')
})

const total = 2 + cases.length
const passed = total - failed
console.log('\n====================')
console.log(`结果：${passed} 通过 / ${failed} 失败（共 ${total}）`)
console.log('====================')

if (failed > 0) process.exit(1)
