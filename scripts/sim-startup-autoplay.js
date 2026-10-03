/**
 * sim-startup-autoplay.js
 *
 * 「启动软件自动播放」契约（2026-10-03 需求改造）。
 *
 * 需求：把播放设置里的「返回软件自动播放」改成「启动软件自动播放」，
 * 前提是**软件内有处于暂停状态的歌曲**（即启动时恢复出来的那首歌）。
 *
 * 事实：老键 player.autoPlayOnReturn 只有设置项与默认值、**没有任何消费方**
 * （返回前台自动播放从未接线），core/init/player/playInfo.ts 里却躺着一句
 * 引用不存在键的 `if (setting['player.startupAutoPlay']) setTimeout(play)`。
 * 本次把键、文案、设置项统一改名为 startupAutoPlay 并把那句接上，同时补前提校验。
 *
 * 本脚本断言（带反例自检）：
 *   ① 默认值/设置项/文案/组件全部改名，且老键只允许出现在一次性迁移里；
 *   ② playInfo 的自动播放必须显式校验前提：有恢复出来的歌 && 当前未在播；
 *   ③ 行为模型：设置关 / 无歌 / 已在播都不播，只有「开 + 有暂停中的歌」才播一次。
 *
 * 运行：node scripts/sim-startup-autoplay.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  defaultSetting: 'src/config/defaultSetting.ts',
  settingConfig: 'src/config/setting.ts',
  playInfo: 'src/core/init/player/playInfo.ts',
  playerSettings: 'src/screens/Home/Views/Setting/settings/Player/index.tsx',
  component: 'src/screens/Home/Views/Setting/settings/Player/IsAutoPlayOnStartup.tsx',
  messages: 'src/lang/zh-cn.json',
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

/** 去掉 // 与 /* *\/ 注释：允许代码注释里提到老键/老文案，只查真实引用 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n')
const REAL = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]))

const invariants = (files) => {
  const reasons = []
  const messages = JSON.parse(files.messages)

  // ① 键改名（默认值里不得再有老键）
  if (!/'player\.startupAutoPlay': false/.test(files.defaultSetting)) {
    reasons.push('defaultSetting 缺 player.startupAutoPlay 默认值（设置项无默认值会读到 undefined）')
  }
  if (/'player\.autoPlayOnReturn':/.test(files.defaultSetting)) {
    reasons.push('defaultSetting 仍留着老键 player.autoPlayOnReturn（键没改干净）')
  }

  // ② 老键只允许出现在一次性迁移里
  for (const key of ['defaultSetting', 'playInfo', 'playerSettings', 'component']) {
    if (/autoPlayOnReturn|auto_play_on_return/.test(stripComments(files[key]))) {
      reasons.push(`${FILES[key]} 仍引用老键/老文案（改名没改干净）`)
    }
  }
  if (!/setting\['player\.autoPlayOnReturn'\]/.test(files.settingConfig) ||
      !/setting\['player\.startupAutoPlay'\] = setting\['player\.autoPlayOnReturn'\]/.test(files.settingConfig)) {
    reasons.push('setting.ts 没有把老键 player.autoPlayOnReturn 迁移到 player.startupAutoPlay（老用户开关丢失）')
  }

  // ③ 设置项与文案
  if (!/import IsAutoPlayOnStartup from '\.\/IsAutoPlayOnStartup'/.test(files.playerSettings) ||
      !/<IsAutoPlayOnStartup \/>/.test(files.playerSettings)) {
    reasons.push('设置页没挂上 IsAutoPlayOnStartup（开关在界面上消失）')
  }
  if (!/useSettingValue\('player\.startupAutoPlay'\)/.test(files.component) ||
      !/updateSetting\(\{ 'player\.startupAutoPlay': startupAutoPlay \}\)/.test(files.component)) {
    reasons.push('设置项组件没接 player.startupAutoPlay（读写键不一致）')
  }
  if (!/t\('setting_player_auto_play_on_startup'\)/.test(files.component) ||
      !/t\('setting_player_auto_play_on_startup_tip'\)/.test(files.component)) {
    reasons.push('设置项文案 key 未改名（会读到空串）')
  }
  if (messages.setting_player_auto_play_on_startup == null || messages.setting_player_auto_play_on_startup_tip == null) {
    reasons.push('zh-cn.json 缺新文案词条（缺失时 UI 直接空白）')
  }
  if (messages.setting_player_auto_play_on_return != null || messages.setting_player_auto_play_on_return_tip != null) {
    reasons.push('zh-cn.json 仍留着老文案词条（已无引用）')
  }

  // ④ playInfo：自动播放必须带「前提=有暂停中的歌」校验
  const autoplay = files.playInfo
  if (!/if \(setting\['player\.startupAutoPlay'\]\) \{[\s\S]{0,500}?if \(playerState\.isPlay\) return[\s\S]{0,200}?if \(!playerState\.playMusicInfo\.musicInfo\) return[\s\S]{0,200}?play\(\)/.test(autoplay)) {
    reasons.push('playInfo 的启动自动播放没有校验前提（有歌且暂停中才播）')
  }
  if (!/if \(!info\?\.listId \|\| info\.index < 0\) return/.test(autoplay)) {
    reasons.push('playInfo 丢了「没有可恢复的歌就直接返回」（无歌也会走自动播放）')
  }

  return reasons
}

// ---------------------------------------------------------------------------
// 行为模型：1:1 复刻 playInfo 的启动分支
// ---------------------------------------------------------------------------
const startupModel = ({ settingOn, restoredSong, isPlaying }) => {
  let playCalls = 0
  const restored = restoredSong && settingOn
  if (restored) {
    if (isPlaying) return playCalls
    if (!restoredSong) return playCalls
    playCalls += 1
  }
  return playCalls
}

const models = [
  ['开 + 有暂停中的歌 → 自动播放一次', startupModel({ settingOn: true, restoredSong: true, isPlaying: false }) === 1],
  ['关 + 有暂停中的歌 → 不播放（保持暂停）', startupModel({ settingOn: false, restoredSong: true, isPlaying: false }) === 0],
  ['开 + 没有任何歌（没恢复出歌） → 不播放', startupModel({ settingOn: true, restoredSong: false, isPlaying: false }) === 0],
  ['开 + 已经在播 → 不重复播放', startupModel({ settingOn: true, restoredSong: true, isPlaying: true }) === 0],
]

const failedModels = models.filter(([, ok]) => !ok)

// ---------------------------------------------------------------------------
// 反例自检
// ---------------------------------------------------------------------------
const tamper = (src, find, replace) => {
  if (!src.includes(find)) throw new Error(`tamper 锚点未命中: ${find}`)
  return src.split(find).join(replace)
}
const cases = []
const checkCase = (name, mutated, expectSubstr) => {
  let reasons = []
  try {
    reasons = invariants({ ...REAL, ...mutated })
  } catch (err) {
    cases.push([name, false, `抛异常: ${err.message}`])
    return
  }
  const hit = reasons.some((r) => r.includes(expectSubstr))
  cases.push([name, hit, hit ? '已拦下' : `未拦下（reasons=${JSON.stringify(reasons)}）`])
}

checkCase('老键默认值复活（改名回退）', {
  defaultSetting: tamper(REAL.defaultSetting, "  'player.startupAutoPlay': false,", "  'player.autoPlayOnReturn': false,"),
}, '仍留着老键')

checkCase('去掉老键迁移（老用户开关丢失）', {
  settingConfig: tamper(REAL.settingConfig,
    "  if (setting && setting['player.startupAutoPlay'] === undefined && typeof setting['player.autoPlayOnReturn'] === 'boolean') {\n    setting['player.startupAutoPlay'] = setting['player.autoPlayOnReturn']\n  }\n",
    ''),
}, '没有把老键')

checkCase('自动播放退回无条件 setTimeout(play)（无歌/已在播也会播）', {
  playInfo: tamper(REAL.playInfo,
    "  if (setting['player.startupAutoPlay']) {\n    setTimeout(() => {\n      if (playerState.isPlay) return\n      if (!playerState.playMusicInfo.musicInfo) return\n      play()\n    })\n  }",
    "  if (setting['player.startupAutoPlay']) setTimeout(play)"),
}, '没有校验前提')

checkCase('设置项文案 key 漏改（UI 空白）', {
  component: tamper(REAL.component, "t('setting_player_auto_play_on_startup_tip')", "t('setting_player_auto_play_on_return_tip')"),
}, '文案 key 未改名')

const missed = cases.filter(([, ok]) => !ok)

console.log('行为模型（启动自动播放的前提）')
for (const [name, ok] of models) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
console.log('')
console.log('反例自检')
for (const [name, ok, detail] of cases) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} —— ${detail}`)
console.log('')

let failed = 0
const realReasons = invariants(REAL)
if (realReasons.length) {
  console.error(`FAIL  启动自动播放契约未通过（${realReasons.length} 项）：`)
  for (const r of realReasons) console.error(`        - ${r}`)
  failed += 1
}
if (failedModels.length) {
  console.error(`FAIL  行为模型未通过（${failedModels.length} 项）`)
  failed += 1
}
if (missed.length) {
  console.error(`FAIL  有反例未被拦下（${missed.length} 项，断言无区分力）`)
  failed += 1
}
if (!failed) {
  console.log(`PASS  启动软件自动播放契约通过（结构不变量 4 组 + 行为模型 ${models.length} 例 + 反例 ${cases.length} 例）`)
  process.exit(0)
}
process.exit(1)
