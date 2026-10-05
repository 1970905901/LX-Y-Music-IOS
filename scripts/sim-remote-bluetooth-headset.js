/**
 * sim-remote-bluetooth-headset.js
 *
 * 「连接蓝牙后，蓝牙耳机控制失效」契约（2026-10-05 用户反馈）。
 *
 * 两条已定位机制（本脚本逐条守）：
 *   ① ios/LxMusicMobile/AppDelegate.mm 的 LXSyncRemoteCommandAvailability() 旧实现按缓存的
 *      LXNowPlayingState 把 play / pause 互斥置反。Apple 文档（MPRemoteCommand.isEnabled）原文：
 *      「When set to false, events for this command are not sent to your app」——disabled 的
 *      命令被系统直接吞掉。蓝牙耳机（AVRCP）按键发的是显式 play / pause，而这份缓存态是
 *      JS 异步发布的、天然滞后引擎一拍（连接蓝牙时的引擎重建 / 后台桥接窗口更明显）：
 *      一旦耳机侧状态与缓存态相反，被按下的那个命令正好是 disabled → 按键完全无响应；
 *      控制中心合并按钮走一直启用的 togglePlayPauseCommand，所以同一时刻控制中心仍可用。
 *      修法：有 Now Playing 信息时所有传输类命令常开，只按「有没有歌」决定可用性；
 *      播放/暂停方向由 JS 按引擎真实状态判定（play / pause 本身幂等，最坏是重复一次
 *      已满足的动作，不会再吞掉真实按压）。
 *   ② src/core/init/player/remoteCommand.ts 的 toggle 分支 await getUnifiedPlaybackState()：
 *      查询**挂起**（不是 reject）时 .catch 永远不触发，这一次按压被静默吞掉。蓝牙单键耳机
 *      只发 toggle，连接蓝牙时的引擎重建 / 后台桥接停摆都可能让查询悬着 —— 与 dfcaa92 的
 *      「在途 Promise 永不 settle → 按键永久失效」同类。修法：TOGGLE_STATE_QUERY_TIMEOUT_MS
 *      超时兜底 togglePlay() + 单次结算守卫（晚到结果丢弃，不会补出第二次动作）。
 *   ③ 诊断：###LXRemote### recv= 行带 bt= 与各命令 enabled 状态。蓝牙耳机再报「没反应」时：
 *      没有 recv= → 命令没到 App（disabled 吞掉 / Now Playing 被别的 App 抢走）；
 *      有 recv= 无 deliver= → UtilsModule → JS 投递链。
 *
 * 运行：node scripts/sim-remote-bluetooth-headset.js
 * 退出码：不变量全过、且所有反例被拦下时为 0，否则 1。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const FILES = {
  appDelegate: 'ios/LxMusicMobile/AppDelegate.mm',
  remoteCommand: 'src/core/init/player/remoteCommand.ts',
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const REAL = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]))

const extractAvailability = (mm) => {
  const match = mm.match(/static void LXSyncRemoteCommandAvailability\(void\) \{[\s\S]*?\n\}/)
  return match ? match[0] : ''
}

const structuralReasons = (files) => {
  const reasons = []
  const mm = files.appDelegate
  const ts = files.remoteCommand

  const avail = extractAvailability(mm)
  if (!avail) {
    reasons.push('AppDelegate 里找不到 LXSyncRemoteCommandAvailability()（可用性门控被搬走/改名，本契约失效）')
    return reasons
  }

  // ① 有信息分支：六个传输类命令必须常开，且不得再按缓存的播放态门控
  const hasInfoPart = avail.slice(avail.indexOf('return;'))
  for (const key of ['play', 'pause', 'togglePlayPause', 'nextTrack', 'previousTrack', 'changePlaybackPosition']) {
    if (!hasInfoPart.includes('commandCenter.' + key + 'Command.enabled = YES;')) {
      reasons.push('有 Now Playing 信息时 ' + key + 'Command 没有保持启用（蓝牙耳机按键会被系统吞掉）')
    }
  }
  if (/playCommand\.enabled\s*=\s*!/.test(avail) || /pauseCommand\.enabled\s*=\s*isPlaying/.test(avail)) {
    reasons.push('play / pause 的可用性又绑回缓存播放态（状态滞后时按键被系统吞掉）')
  }

  // ② 无信息分支：仍必须全关 + 结束接收遥控事件（没有歌时不得抢媒体键）
  const noInfoIndex = avail.indexOf('if (!hasInfo)')
  const noInfoPart = noInfoIndex >= 0 ? avail.slice(noInfoIndex, avail.indexOf('return;')) : ''
  if (!noInfoPart) {
    reasons.push('找不到 !hasInfo 分支（没歌时必须交出遥控命令）')
  } else {
    for (const key of ['play', 'pause', 'togglePlayPause', 'nextTrack', 'previousTrack', 'changePlaybackPosition']) {
      if (!noInfoPart.includes('commandCenter.' + key + 'Command.enabled = NO;')) {
        reasons.push('!hasInfo 分支漏了把 ' + key + 'Command 关掉（没歌时仍抢媒体键）')
      }
    }
    if (!noInfoPart.includes('LXEndReceivingRemoteControlEvents();')) {
      reasons.push('!hasInfo 分支没有结束接收遥控事件')
    }
  }

  // ③ 诊断：recv 行必须带蓝牙路由与各命令 enabled 状态
  if (!/###LXRemote### recv=[\s\S]{0,600}?bt=%d/.test(mm)) {
    reasons.push('###LXRemote### recv= 诊断行没有 bt= 路由标记（下次「耳机没反应」无法区分是否到达 App）')
  }
  if (!/###LXRemote### recv=[\s\S]{0,900}?enabled\(play=%d pause=%d toggle=%d next=%d\)/.test(mm)) {
    reasons.push('###LXRemote### recv= 诊断行没有各命令 enabled 状态（无法区分是否被 disabled 吞掉）')
  }
  if (!/LXHasBluetoothAudioRoute\(\) \? 1 : 0/.test(mm)) {
    reasons.push('recv= 的 bt= 没有调用 LXHasBluetoothAudioRoute()（路由标记不可信）')
  }

  // ④ toggle 分支：必须有超时兜底 + 单次结算，且方向仍读引擎真实状态
  if (!/TOGGLE_STATE_QUERY_TIMEOUT_MS/.test(ts)) {
    reasons.push('toggle 没有引擎状态查询超时兜底（查询挂起时这次按压被静默吞掉）')
  }
  if (!/const fallbackTimer = setTimeout\(\(\) => \{\s*\n\s*settle\(togglePlay\)/.test(ts)) {
    reasons.push('toggle 的超时兜底没有落到 togglePlay()（查询挂起时按键仍无动作）')
  }
  if (!/if \(settled\) return/.test(ts)) {
    reasons.push('toggle 没有单次结算守卫（晚到的查询结果会补出第二次动作）')
  }
  if (!/getUnifiedPlaybackState\(\)/.test(ts) || !/state === 'playing' \|\| state === 'buffering'/.test(ts)) {
    reasons.push('toggle 方向判断不再读引擎真实状态（退回滞后的 playerState.isPlay）')
  }
  if (/case 'toggle':\s*\n\s*togglePlay\(\)/.test(ts)) {
    reasons.push('toggle 分支又直接同步 togglePlay()（读滞后的 playerState.isPlay）')
  }

  return reasons
}

const realReasons = structuralReasons(REAL)

// ---------------------------------------------------------------------------
// 行为模型（复刻两条机制）
// ---------------------------------------------------------------------------
const models = []

// 模型 A：disabled 命令被系统吞掉（Apple 文档行为）——一次按键最多投递 1 次
const deliverCount = (availability, opcode) => (availability[opcode] ? 1 : 0)
const legacyAvailability = (cachedPlaying) => ({ play: !cachedPlaying, pause: cachedPlaying })
const fixedAvailability = () => ({ play: true, pause: true })

// 模型 B 的假时钟 + 微任务排空：promise 回调与定时器的先后顺序必须与真实事件循环一致
const createClock = () => {
  let now = 0
  const timers = []
  return {
    setTimeout(fn, ms) {
      const timer = { fn, at: now + ms, canceled: false, fired: false }
      timers.push(timer)
      return timer
    },
    clearTimeout(timer) {
      if (timer) timer.canceled = true
    },
    tick(ms) {
      now += ms
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (!timer.canceled && !timer.fired && timer.at <= now) {
          timer.fired = true
          timer.fn()
        }
      }
    },
  }
}

const drainMicrotasks = async() => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

const runLegacyToggle = async({ clock, getState }) => {
  const actions = []
  void getState()
    .then((state) => actions.push(state === 'playing' || state === 'buffering' ? 'pause' : 'play'))
    .catch(() => actions.push('fallback'))
  await drainMicrotasks()
  clock.tick(10000)
  await drainMicrotasks()
  return actions
}

const runFixedToggle = async({ clock, getState }) => {
  const actions = []
  let settled = false
  const settle = (action) => {
    if (settled) return
    settled = true
    clock.clearTimeout(fallbackTimer)
    actions.push(action())
  }
  const fallbackTimer = clock.setTimeout(() => settle(() => 'fallback'), 250)
  void getState()
    .then((state) => settle(() => (state === 'playing' || state === 'buffering' ? 'pause' : 'play')))
    .catch(() => settle(() => 'fallback'))
  await drainMicrotasks()
  clock.tick(10000)
  await drainMicrotasks()
  return actions
}

const cases = []

const main = async() => {
  {
    // 耳机侧状态与 App 缓存态相反（AVRCP 通知 / JS 发布滞后一拍）：耳机按 PAUSE，
    // 旧门控在「缓存已暂停」时把 pause 置为 disabled → 系统不投递；修后必达。
    const legacy = deliverCount(legacyAvailability(false), 'pause')
    const fixed = deliverCount(fixedAvailability(), 'pause')
    models.push(['模型A 缓存态滞后（缓存=暂停、耳机发 pause）：旧门控被系统吞掉（0 次投递），修后投递 1 次', legacy === 0 && fixed === 1])
  }
  {
    // 对照：缓存态与耳机一致时旧模型也能投递 —— 说明「常开」不是无差别放行，而是补上滞后窗口
    const legacy = deliverCount(legacyAvailability(true), 'pause')
    const fixed = deliverCount(fixedAvailability(), 'pause')
    models.push(['模型A 对照 缓存态一致（缓存=播放、耳机发 pause）：旧/新模型都投递 1 次', legacy === 1 && fixed === 1])
  }
  {
    const hanging = () => new Promise(() => {})
    const legacy = await runLegacyToggle({ clock: createClock(), getState: hanging })
    const fixed = await runFixedToggle({ clock: createClock(), getState: hanging })
    models.push(['模型B 查询永不 settle：旧模型 0 个动作（按压被吞），新模型超时兜底出 1 个动作', legacy.length === 0 && fixed.length === 1 && fixed[0] === 'fallback'])
  }
  {
    const fast = () => Promise.resolve('playing')
    const actions = await runFixedToggle({ clock: createClock(), getState: fast })
    models.push(['模型B 查询及时返回（引擎在播）：新模型按引擎状态 pause，且只有 1 个动作（超时无补发）', actions.length === 1 && actions[0] === 'pause'])
  }
  {
    const clock = createClock()
    const late = () => new Promise((resolve) => clock.setTimeout(() => resolve('paused'), 900))
    const actions = await runFixedToggle({ clock, getState: late })
    models.push(['模型B 查询晚到（>250ms）：超时兜底已动作，晚到结果被单次结算丢弃（仍只有 1 个动作）', actions.length === 1 && actions[0] === 'fallback'])
  }

  // -------------------------------------------------------------------------
  // 结构反例（必须被拦下）
  // -------------------------------------------------------------------------
  {
    const tampered = {
      ...REAL,
      appDelegate: REAL.appDelegate.replace(
        /commandCenter\.playCommand\.enabled = YES;/,
        'commandCenter.playCommand.enabled = !isPlaying;',
      ),
    }
    const caught = structuralReasons(tampered).some((r) => r.includes('又绑回缓存播放态') || r.includes('没有保持启用'))
    cases.push(['C1 play 可用性绑回缓存播放态', caught])
  }
  {
    const tampered = {
      ...REAL,
      appDelegate: REAL.appDelegate.replace(
        /commandCenter\.pauseCommand\.enabled = YES;/,
        'commandCenter.pauseCommand.enabled = isPlaying;',
      ),
    }
    const caught = structuralReasons(tampered).some((r) => r.includes('又绑回缓存播放态') || r.includes('没有保持启用'))
    cases.push(['C2 pause 可用性绑回缓存播放态', caught])
  }
  {
    const tampered = {
      ...REAL,
      appDelegate: REAL.appDelegate.replace(
        /commandCenter\.togglePlayPauseCommand\.enabled = YES;/,
        'commandCenter.togglePlayPauseCommand.enabled = NO;',
      ),
    }
    const caught = structuralReasons(tampered).some((r) => r.includes('togglePlayPauseCommand 没有保持启用'))
    cases.push(['C3 有信息时关掉 toggle（控制中心/蓝牙单键都失效）', caught])
  }
  {
    const tampered = {
      ...REAL,
      appDelegate: REAL.appDelegate.replace('bt=%d infoCount', 'infoCount'),
    }
    const caught = structuralReasons(tampered).some((r) => r.includes('没有 bt= 路由标记'))
    cases.push(['C4 recv= 诊断去掉蓝牙路由标记', caught])
  }
  {
    const tampered = {
      ...REAL,
      remoteCommand: REAL.remoteCommand.replace(
        /const fallbackTimer = setTimeout\(\(\) => \{\s*\n\s*settle\(togglePlay\)\s*\n\s*\}, TOGGLE_STATE_QUERY_TIMEOUT_MS\)/,
        'const fallbackTimer = null',
      ),
    }
    const caught = structuralReasons(tampered).some((r) => r.includes('超时兜底没有落到 togglePlay'))
    cases.push(['C5 删掉 toggle 的超时兜底', caught])
  }
  {
    const tampered = {
      ...REAL,
      remoteCommand: REAL.remoteCommand.replace(
        /let settled = false\s*\n\s*const settle = \(action: \(\) => void\) => \{\s*\n\s*if \(settled\) return/,
        'let settled = true\n        const settle = (action: () => void) => {',
      ),
    }
    const caught = structuralReasons(tampered).some((r) => r.includes('单次结算守卫'))
    cases.push(['C6 去掉 toggle 的单次结算守卫', caught])
  }
  {
    const tampered = {
      ...REAL,
      remoteCommand: REAL.remoteCommand.replace(
        /case 'toggle': \{[\s\S]*?break\s*\n\s*\}/,
        "case 'toggle':\n        togglePlay()\n        break",
      ),
    }
    const caught = structuralReasons(tampered).some((r) => r.includes('又直接同步 togglePlay'))
    cases.push(['C7 toggle 退回直接同步 togglePlay()', caught])
  }

  const failedModels = models.filter(([, pass]) => !pass)
  const failedCases = cases.filter(([, caught]) => !caught)

  // -------------------------------------------------------------------------
  console.log('行为模型（蓝牙耳机为什么失效 / 为什么修好）')
  for (const [name, pass] of models) console.log((pass ? 'PASS' : 'FAIL') + '  ' + name)
  console.log('')
  console.log('反例自检')
  for (const [name, caught] of cases) console.log((caught ? 'PASS' : 'FAIL') + '  ' + name + ' —— ' + (caught ? '已拦下' : '未拦下'))
  console.log('')

  let failed = 0
  if (realReasons.length) {
    console.error('FAIL  蓝牙耳机遥控契约未通过（' + realReasons.length + ' 项）：')
    for (const reason of realReasons) console.error('        - ' + reason)
    failed++
  }
  if (failedModels.length) {
    console.error('FAIL  行为模型未通过（' + failedModels.length + ' 项）')
    failed++
  }
  if (failedCases.length) {
    console.error('FAIL  有反例未被拦下（' + failedCases.length + ' 项，断言无区分力）')
    failed++
  }

  if (!failed) {
    console.log('PASS  蓝牙耳机遥控命令不被系统吞掉且查询挂起也有兜底（结构不变量 4 组 + 行为模型 ' + models.length + ' 例 + 反例 ' + cases.length + ' 例）')
    process.exit(0)
  }
  process.exit(1)
}

void main()