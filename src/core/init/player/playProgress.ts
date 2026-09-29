import { updateListMusics } from '@/core/list'
import { setMaxplayTime, setNowPlayTime } from '@/core/player/progress'
import { getTimelineDuration } from '@/core/player/timeline'
import { setCurrentTime, getDuration, getPosition, getPositionStamped, getPlaybackEngineState } from '@/plugins/player/utils'
import { formatPlayTime2 } from '@/utils/common'
import { savePlayInfo } from '@/utils/data'
import { throttleBackgroundTimer } from '@/utils/tools'
import BackgroundTimer from 'react-native-background-timer'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { onScreenStateChange, onPlayerPosition, onPlayerSeeked } from '@/utils/nativeModules/utils'
import { reanchorNowPlayingLyric } from '@/utils/nativeModules/nowPlaying'
import { syncNowPlayingState } from '@/core/player/nowPlaying'
import { AppState } from 'react-native'
// UI 平滑时钟：仅服务于逐字歌词高亮与歌词连续滚动的每帧插值，
// 不参与歌词行同步（行高亮已交由歌词引擎内部 ticker 驱动）。
import { audioClock } from '@/core/player/audioClock'
// 行级高亮对齐上游 usePlayerEvent 事件对：歌词引擎内部 ticker 推进（lrc.play 绝对时间
// 重锚），引擎 playing/buffering 事件驱动重锚/冻结，本模块不再做任何行级同步
// （此前的 rAF 每帧前向推进与轮询行同步随旧轮询架构一并删除）。
import { play as resyncLyricToEngine, handlePlay as anchorLyricToEngineTime, verifyLyricLineSync } from '@/core/lyric'
import { onUnifiedPlayerEvent } from '@/plugins/player/engine'

import {
  updateScrobbleInfo,
  updateScrobblePlayTime,
  updateScrobbleTotalTime,
} from '@/core/player/scrobble'

// 对齐上游 usePlaybackPersistence 的保存语义：始终持久化播放位置，
// time 按开关取值——「记住播放进度」开启存真实进度，关闭存 0（下次从头播）。
// 旧实现开关关闭时完全不保存，残留上次开启时的旧进度，重开后恢复到过期位置。
const delaySavePlayInfo = throttleBackgroundTimer(() => {
  void savePlayInfo({
    time: settingState.setting['player.isSavePlayTime'] ? playerState.progress.nowPlayTime : 0,
    maxTime: playerState.progress.maxPlayTime,
    listId: playerState.playMusicInfo.listId!,
    index: playerState.playInfo.playIndex,
  })
}, 2000)

export default () => {
  // const updateMusicInfo = useCommit('list', 'updateMusicInfo')

  let updateTimeout: number | null = null

  let isScreenOn = true

  // 进度条拖动期间暂停 1s 慢校准轮询：每次 tick 都有 getPositionStamped/getPlaybackEngineState
  // 两次原生桥往返 + setNowPlayTime → playProgressChanged 连锁的 PlayInfo 子树 React
  // 重渲染（4 次/秒）+ playHistory/playStatus/preloadNextMusic 监听器执行。拖动的
  // 手势事件同样走 JS 线程，这些负载会把 move 事件挤到排队（表现为拖动不跟手），
  // 拖动期间整体跳过，JS 帧全部让给手势。播放继续走 audioClock 锚点外推，位置无感知
  // 停顿；拖动结束的 setProgress 会统一重锚，无状态残留。
  let isProgressDragging = false

  // 快慢双路径：
  // - 快路径：原生歌词时钟 4Hz 外推位置事件（仅前台播放时发布），免桥接查询直接
  //   驱动进度 UI 与歌词行同步；
  // - 慢路径（2s）：引擎真实位置查询，负责校准（含回传原生重锚）、引擎状态/缓冲
  //   检测、seek 生效窗口、scrobble 与进度持久化。
  // 快路径仅在慢路径确认引擎在播后启用；缓冲 hold / seek 窗口 / 拖动期间冻结。
  let engineConfirmedPlaying = false
  let isBufferingHold = false

  const isRestoringCurrentMusic = () => {
    const restorePlayInfo = global.lx.restorePlayInfo
    if (!restorePlayInfo) return false
    return restorePlayInfo.listId == playerState.playMusicInfo.listId &&
      restorePlayInfo.index == playerState.playInfo.playIndex
  }

  const getCurrentTime = () => {
    // 后台（音频后台播放时 JS 线程仍存活）跳过全部轮询工作：
    // 位置桥往返、React 渲染、进度条补间重启、存储写入在后台都没有意义，
    // 只会持续占用 JS 线程，返回前台后叠加成明显的触摸延迟。
    // 前台恢复后下一次 tick 会用引擎真实位置重锚时钟，状态无残留。
    if (AppState.currentState !== 'active') return
    let id = playerState.musicInfo.id
    // 带快照时间信息的位置快照：nativeFlac 原生时钟戳 / AVPlayer 年龄估计。
    // 重锚时把歌词时钟锚点回放到快照时刻（reanchorNowPlayingLyric 第三参），
    // 消除「快照位置被钉在现在」造成的灵动岛/控制中心歌词恒定滞后（~100-300ms）
    const calibStartedAt = Date.now()
    void getPositionStamped().then(async stamped => {
      const position = stamped.position
      if (!position || id != playerState.musicInfo.id) return

      // seek 生效窗口内：引擎可能仍回报 seek 前的旧位置（seek 异步生效）。
      // 此时绝不能把旧位置发布进 UI 状态（setNowPlayTime → playProgressChanged
      // → 进度条/时间标签/歌词监听器）——否则进度条先跳回旧位置、窗口结束后再
      // 跳回落点，表现为快进/快退后进度条抽帧。只拦截 UI 发布；歌词时钟不干涉，
      // 继续跟随正在出声的旧音频（对齐上游：seek 不碰歌词，等引擎出声才重锚）。
      if (seekTargetPosition != null && Date.now() < seekHoldUntil) {
        if (Math.abs(position - seekTargetPosition) >= 1.5) return
        seekTargetPosition = null
        seekHoldUntil = 0
      }

      setNowPlayTime(position)

      // 先检查引擎状态：buffering 期间音频没有真正渲染，getPosition() 返回的是
      // seek 目标而非实际播放位置。此时冻结 audioClock（scrollToActiveContinuous
      // 与逐字插值不会外推超前）；行级歌词由 app_event.pause（controller 对
      // buffering 状态发出，≈上游 waiting→pause）冻结。恢复出声后由引擎 playing
      // 事件（syncFromEngine）用带戳绝对位置统一重锚。
      const engineState = await getPlaybackEngineState()
      const isBuffering = engineState === 'buffering' || engineState === 'loading'
      const wasBufferingHold = isBufferingHold
      isBufferingHold = isBuffering
      engineConfirmedPlaying = !isBuffering && engineState === 'playing' && !!playerState.isPlay

      if (!playerState.isPlay) return

      if (isBuffering) {
        // 解码器还在 buffering（音频没有真正出声）：冻结时钟，不外推。
        // 时钟已有锚点（播放中/暂停中）→ 自冻结在当前位置：nativeFlac 缓冲期
        // getPosition 回报的是 seek 目标而非实际位置，直接 hold(position) 会把歌词
        // 提前拽到目标行（上游 waiting→pause 的语义正是「歌词停在当前行」）；
        // 时钟尚无锚点（恢复进度起播/新歌起播）→ 锚到引擎位置，逐字插值才有基准。
        // 不能用 seek 窗口判定：窗口与缓冲结束可能同拍，清窗后仍需保持自冻结。
        // 恢复出声由引擎 playing 事件（syncFromEngine）统一重锚，此处不再做行同步。
        audioClock.hold((audioClock.hasAnchor ? audioClock.getTime() : position) * 1000)
        return
      }

      audioClock.setAnchor(position * 1000, settingState.setting['player.playbackRate'], playerState.isPlay)
      // 回传引擎真实位置：重锚原生歌词/位置时钟（控制中心/灵动岛歌词与进度 UI 同源
      // 校准）。nativeFlac 路径带原生时钟戳精确回放；AVPlayer 路径无原生戳——快照
      // 产生于发起后 stamped.ageMs（往返半程）处，重锚发起时快照年龄 = 已流逝总时长
      // − stamped.ageMs（对称往返假设，残余 ≈ reanchor 单程，远小于旧行为的整段往返）
      const ageMs = stamped.snapshotAt > 0 ? 0 : Math.max(0, Date.now() - calibStartedAt - stamped.ageMs)
      void reanchorNowPlayingLyric(position * 1000, stamped.snapshotAt, ageMs)

      // 行级自愈探针（慢校准层，≤1s 收敛）：上游行级重锚的最终保证是 HTMLMediaElement
      // 「seek 完成后必发 playing」的引擎级契约，我们的引擎没有——AVPlayer 对无状态
      // 变化的 seek 不发事件、任一引擎的 playing 事件都可能被 syncFromEngine 的状态
      // 查询守卫丢弃（快照恰逢微卡顿 re-buffering）。事件驱动重锚全部落空时行级
      // ticker 会永久冻在旧行而音频照常出声（真机实锤的「快进/快退后一直不同步」）。
      // 此处引擎已确认 playing 且不在 seek 窗口/缓冲/拖动，position 即引擎真相：
      // 「应有行 ≠ 当前行」只可能是事件丢失，立即以引擎时间重锚（正常播放时恒一致，
      // 零开销二分比对；seek 窗口内不会走到这里）。
      verifyLyricLineSync(position * 1000)

      updateScrobblePlayTime(position)

      // 缓冲恢复出声（长距离 seek 超过 300ms 快路径窗口、网络卡顿后）：缓冲期间
      // 控制中心进度基线外推已偏且无人重设——nativeFlac 路径无原生 seek 事件、
      // 快路径贴「playing 才重锚」语义在 buffering 时跳过了发布。恢复瞬间补一次
      // 带戳基线发布兜底（nativeFlac 走 getPositionStamped 原生戳精确回放；
      // AVPlayer 路径原生事件已重设基线，此处重复发布被推进吸收，无害）。
      if (wasBufferingHold) void syncNowPlayingState('play')

      // 对齐上游：保存不前置开关条件（开关只决定存真实进度还是 0），
      // 否则关闭开关后残留上次开启时的旧进度，重开开关会恢复到过期位置
      if (!playerState.playMusicInfo.isTempPlay) {
        delaySavePlayInfo()
      }
    })
  }
  const getMaxTime = async() => {
    const duration = await getDuration()
    const timelineDuration = getTimelineDuration(playerState.playMusicInfo.musicInfo, duration)
    setMaxplayTime(timelineDuration)
    updateScrobbleTotalTime(timelineDuration)

    if (playerState.playMusicInfo.musicInfo && 'source' in playerState.playMusicInfo.musicInfo && !playerState.playMusicInfo.musicInfo.interval) {
      // console.log(formatPlayTime2(playProgress.maxPlayTime))

      if (playerState.playMusicInfo.listId) {
        void updateListMusics([{
          id: playerState.playMusicInfo.listId,
          musicInfo: {
            ...playerState.playMusicInfo.musicInfo,
            interval: formatPlayTime2(playerState.progress.maxPlayTime),
          },
        }])
      }
    }
  }

  const clearUpdateTimeout = () => {
    if (!updateTimeout) return
    BackgroundTimer.clearInterval(updateTimeout)
    updateTimeout = null
  }
  const startUpdateTimeout = () => {
    if (!isScreenOn) return
    clearUpdateTimeout()
    // 慢速校准 tick（1s）：引擎真实位置重锚（快路径由原生 4Hz 位置事件驱动）+
    // 引擎状态/缓冲检测 + seek 生效窗口确认 + scrobble/播放记录/进度持久化。
    // 周期即控制中心歌词外推的最大漂移窗口，过大会表现为"同步一句停一会"
    updateTimeout = BackgroundTimer.setInterval(() => {
      if (isProgressDragging) return
      getCurrentTime()
    }, 1000)
    getCurrentTime()
  }

  // 对齐上游 usePlayerEvent 事件对的时钟侧（onPlaying → lrc.play(currentTime)）：
  // 引擎 playing 事件到达时，用引擎【带戳绝对位置】一次性完成
  //   时钟锚定（audioClock.setAnchor）→ 行级歌词重锚（handlePlay，重启 ticker）
  //   → 进度 UI 发布 → 原生歌词/位置时钟带戳回放 → 控制中心进度基线发布
  //   → seek 窗口解除（引擎已在新位置，旧位置拦截失去意义）
  // 行级冻结由 app_event.pause（controller 对 buffering/paused 都发出 ≈ 上游
  // waiting→pause）完成。seek 落点确认 / 缓冲恢复 / 暂停恢复由此统一为
  // 「引擎事件即真相」，同步延迟从「≤1s 轮询 + 300ms 快路径」压到原生事件
  // 传播延迟（~10-50ms）——这正是旧架构下快进/快退后歌词跟音频不同步的根源。
  // 行级重锚必须在这里做而不只靠 app_event.play：HTMLMediaElement 保证 seek 完成
  // 后必发 playing（上游歌词靠它跟上本地 seek），而我们的引擎对「不引起状态变化
  // 的 seek」（AVPlayer 本地文件）不发任何事件——syncFromEngine 就是这个保证的
  // 等价物（scheduleFastResync 在 seek 后 ~300ms 调用兜底）。
  // playing 信号重试链（「事件永不丢失」消费侧等价物，见 syncFromEngine 内注释）
  let syncRetryTimer: number | null = null
  const clearSyncRetry = () => {
    if (syncRetryTimer == null) return
    BackgroundTimer.clearTimeout(syncRetryTimer)
    syncRetryTimer = null
  }
  const syncFromEngine = (musicId: string, genAtCall = seekGen, attempt = 0) => {
    const calibStartedAt = Date.now()
    void getPositionStamped().then(async(stamped) => {
      if (!playerState.isPlay || playerState.musicInfo.id != musicId) return
      // 代际守卫：调用后用户又发起了新 seek——这份快照描述的是旧落点，
      // 丢弃，新 seek 的窗口/快路径会接管。
      if (genAtCall != seekGen) return
      // 事件过期守卫：state 事件与位置快照之间引擎可能又进入 buffering（seek 后
      // 重新解码），此刻快照位置不是真实出声位置，丢弃——但不再静默丢弃：
      // 200ms 后重试同一信号（fresh 代际/切歌/暂停守卫天然中止，重试有界），
      // 耗尽后仍有 4Hz 快路径与 1s 慢校准自愈探针兜底。上游的对应保证是
      // HTMLMediaElement 的事件永不丢失；这是把丢失语义改写成「延迟而非丢失」。
      const engineState = await getPlaybackEngineState()
      if (!playerState.isPlay || playerState.musicInfo.id != musicId) return
      if (genAtCall != seekGen) return
      if (engineState !== 'playing') {
        if (attempt < 6) {
          clearSyncRetry()
          syncRetryTimer = BackgroundTimer.setTimeout(() => {
            syncRetryTimer = null
            syncFromEngine(musicId, genAtCall, attempt + 1)
          }, 200)
        }
        return
      }
      seekTargetPosition = null
      seekHoldUntil = 0
      engineConfirmedPlaying = true
      isBufferingHold = false
      audioClock.setAnchor(stamped.position * 1000, settingState.setting['player.playbackRate'], true)
      setNowPlayTime(stamped.position)
      anchorLyricToEngineTime(stamped.position * 1000)
      const ageMs = stamped.snapshotAt > 0 ? 0 : Math.max(0, Date.now() - calibStartedAt - stamped.ageMs)
      void reanchorNowPlayingLyric(stamped.position * 1000, stamped.snapshotAt, ageMs)
      void syncNowPlayingState('play')
    })
  }

  // 引擎状态事件订阅（上游 usePlayerEvent 的时钟侧等价物）：
  // - playing → syncFromEngine 即时重锚（覆盖 seek 落点 / 缓冲恢复 / 暂停恢复全部场景）
  // - buffering/loading → 快路径停发 + 时钟冻结在当前位置（行级冻结由 controller 的
  //   app_event.pause → core/lyric.pause 完成，与上游 waiting→pause 同构）
  // - paused/stopped → 快路径停发、缓冲解除（用户暂停经 app_event.pause → handlePause）
  onUnifiedPlayerEvent((event) => {
    if (event.type != 'state') return
    const musicId = playerState.musicInfo.id
    if (!musicId) return
    switch (event.state) {
      case 'playing': {
        // 锚定先行（上游 usePlayerEvent 与 usePlayProgress 是两个独立订阅：playing
        // 既重锚歌词/时钟也做回拉——此前回拉分支 break 跳过锚定，全靠 300ms 快路径兜）。
        syncFromEngine(musicId)
        // 出声回拉（上游 handlePlaying 的音频侧校正）：引擎报告位置=解码器播放头
        // （两引擎皆是），报告位置与 seek 意图（restorePlayTime）的偏差即「歌词与
        // 音频差固定偏移」的直接来源——偏差超过阈值才回拉（落点精确时不做无意义的
        // 二次 seek，nativeFlac 重启解码会再缓冲一轮）；卡住位置（mediaBuffer.playTime）
        // 的恢复同径。回拉后清空记录；看门狗探测 seek 已主动清卡点，不会被回拉撤销。
        const resumeTime = restorePlayTime ?? mediaBuffer.playTime
        clearBufferTimeout()
        restorePlayTime = null
        // 新鲜度守卫：playing 事件丢失时 restorePlayTime 会滞留（探针已自愈行级），
        // 迟到的 playing 若还拿陈旧意图做偏差比较，会把音频拉回早已过去的旧目标——
        // 意图超过 15s 一律作废（正常 seek 的 playing 都在秒级到达）。
        if (resumeTime != null && pullBackCount < 3 && Date.now() - lastSeekIntentAt < 15000) {
          void getPosition().then((position) => {
            if (!playerState.isPlay || playerState.musicInfo.id != musicId) return
            if (Math.abs((position || 0) - resumeTime) <= 0.3) return
            pullBackCount++
            lastSeekIntentAt = Date.now()
            void setCurrentTime(resumeTime).catch(() => {})
          })
        }
        break
      }
      case 'buffering':
      case 'loading': {
        engineConfirmedPlaying = false
        isBufferingHold = true
        startBuffering()
        // 与慢校准缓冲分支同一冻结策略：有锚点 → 自冻结在当前位置（seek 缓冲期
        // getPosition 回报的是 seek 目标，不可采信）；无锚点（恢复进度起播/新歌
        // 起播首帧即缓冲）→ 取引擎位置为逐字插值基准，与行级 setLyric 的重锚同源。
        // 迟到的引擎位置需复核：playing 可能已先行重锚（hasAnchor）、用户可能已
        // 暂停/切歌——任一变化都丢弃，绝不覆盖新状态。
        if (audioClock.hasAnchor) {
          audioClock.hold(audioClock.getTime() * 1000)
        } else {
          void getPosition().then((position) => {
            if (!isBufferingHold || audioClock.hasAnchor || !playerState.isPlay) return
            if (playerState.musicInfo.id != musicId) return
            audioClock.hold((position || 0) * 1000)
          })
        }
        break
      }
      case 'paused':
      case 'stopped':
        engineConfirmedPlaying = false
        isBufferingHold = false
        // 真实暂停/停止才清看门狗（上游 handlePause 语义：waiting 引发的 pause
        // 要保留看门狗与重试预算——我们的事件订阅天然区分真实 paused 与 buffering）
        clearBufferTimeout()
        break
    }
  })

  // seek 生效窗口：从发起到引擎在落点恢复播放之间，引擎的 getPosition() 可能仍回报
  // seek 前的旧位置（seek 是异步生效的，普通音质下尤其明显）。窗口内不能用旧位置
  // 刷新 UI 状态（进度条/时间标签），否则「点击歌词行 / 拖动进度条」后进度条先跳回
  // 旧位置、窗口结束后再跳回落点。歌词时钟在窗口内不受干涉：继续跟随正在出声的
  // 旧音频，引擎在落点出声时统一重锚（对齐上游 seek 不碰歌词的语义）。
  // 窗口超时自愈（2s），引擎在落点附近恢复播放时提前结束窗口（见 getCurrentTime
  // 与 syncFromEngine）。seekGen 代际计数：在途的位置快照/状态查询返回后，若期间
  // 用户又发起了新 seek，旧快照直接丢弃，防旧落点覆盖新窗口。
  let seekTargetPosition: number | null = null
  let seekHoldUntil = 0
  let seekGen = 0

  // —— 缓冲看门狗 + 出声回拉（完整移植上游 usePlayProgress 的 restorePlayTime/mediaBuffer）——
  // 上游行为（桌面版 usePlayProgress.ts）：
  //   setProgress：restorePlayTime = seek 目标（意图位置）；
  //   playerWaiting（进入缓冲）：startBuffering——连续缓冲 3s 记录卡住位置，每轮向后
  //     跳 3~6s 探测逃离卡死区间（getBufferRecoveryPosition，绝不跳到结尾），10 次失败
  //     放弃（上游按 autoSkipOnError 设置决定是否跳下一首，本项目无此设置=仅放弃）；
  //   playerPlaying（出声）：resumeTime = restorePlayTime || mediaBuffer.playTime →
  //     setCurrentTime(resumeTime) 把【音频】强制拉回目标位置。
  // 为什么必须校正音频而不是歌词：引擎落点与 seek 意图位置可能存在偏差（高码率大文件
  // 的 range 不精确 / 解码器恢复偏移），此时引擎报告位置≠可听内容位置——歌词/进度/
  // 控制中心若忠实锚到报告位置，全部与可听内容差固定偏移且无规律（真机实测：仅高码率
  // 复现、128k/320k 正常、两套引擎都复现）。上游在每次出声时回拉音频，落点偏差被消除，
  // 后续所有锚定自然正确。restorePlayTime 在出声回拉后清空（回拉引发的后续 playing
  // 不再回拉，天然无循环）。
  let restorePlayTime: number | null = null
  // seek 意图时刻（setProgress / 出声回拉 / 看门狗探测都会刷新）：缓冲看门狗的宽限
  // 基准——慢缓冲（高码率 FLAC 单次 seek 缓冲 5~8s 很常见）期间绝不记录卡点/向前
  // 探测，否则探测越过 seek 目标并与出声回拉互相拉锯（回拉引发的新缓冲又被探测，
  // 永不收敛）——「泪海 FLAC 快进快退后始终不同步」的实锤根因
  let lastSeekIntentAt = 0
  // 单次 seek 意图的回拉预算：回拉后的落点若仍偏差（极端引擎/网络），最多再拉 2 次
  // 就接受引擎位置并锚定，防慢缓冲长曲上回拉-探测无限拉锯；每次用户 seek 重置
  let pullBackCount = 0
  const mediaBuffer: { timeout: number | null, playTime: number | null, attempts: number } = {
    timeout: null, playTime: null, attempts: 0,
  }
  const clearBufferTimeout = () => {
    if (mediaBuffer.timeout != null) BackgroundTimer.clearTimeout(mediaBuffer.timeout)
    mediaBuffer.timeout = null
    mediaBuffer.playTime = null
    mediaBuffer.attempts = 0
  }
  // 上游 bufferRecovery：探测点=当前位置向前 step（3~6s）且绝不越过结尾（避免制造 ended）
  const getBufferRecoveryPosition = (current: number, duration: number, step: number): number | null => {
    if (!Number.isFinite(current) || current < 0 || !Number.isFinite(duration) || duration <= current || !Number.isFinite(step) || step <= 0) return null
    const remaining = duration - current
    if (remaining < 0.25) return null
    return current + Math.min(step, remaining / 2)
  }
  const startBuffering = () => {
    if (mediaBuffer.timeout != null) return
    const track = playerState.musicInfo.id
    if (!track) return
    mediaBuffer.timeout = BackgroundTimer.setTimeout(() => {
      mediaBuffer.timeout = null
      if (track != playerState.musicInfo.id || !playerState.isPlay) return
      // seek 意图宽限期（10s）：高码率 FLAC 单次 seek 缓冲可达 5~8s，宽限期内绝不
      // 记录卡点/向前探测——探测会越过用户 seek 目标、并与出声回拉互相拉锯（回拉
      // 引发的新缓冲又被探测，永不收敛）。宽限后仍持续缓冲才按真卡死处理。
      if (Date.now() - lastSeekIntentAt < 10000) {
        startBuffering()
        return
      }
      void getPosition().then((currentTime) => {
        if (track != playerState.musicInfo.id || !playerState.isPlay) return
        mediaBuffer.playTime ??= currentTime
        // 记录卡点=一次新的恢复意图：刷新宽限/回拉的新鲜度基准，出声回拉据此放行
        lastSeekIntentAt = Date.now()
        if (++mediaBuffer.attempts >= 10) {
          clearBufferTimeout()
          return
        }
        void getDuration().then((duration) => {
          if (track != playerState.musicInfo.id || !playerState.isPlay) return
          const skipTime = getBufferRecoveryPosition(currentTime, duration || playerState.progress.maxPlayTime, 3 + Math.random() * 3)
          // 探测 seek：刷新宽限基准（探测后的新缓冲不再立刻被下一轮探测/回拉干扰），
          // 并清掉卡点记录——探测后的 playing 若还带着卡点，会被出声回拉拉回卡死区，
          // 探测就白做了。探测后若仍卡死，看门狗按新轮次继续（attempts 保留）。
          lastSeekIntentAt = Date.now()
          mediaBuffer.playTime = null
          startBuffering()
          if (skipTime != null) void setCurrentTime(skipTime)
        }).catch(() => { startBuffering() })
      }).catch(() => {})
    }, 3000)
  }

  // seek 落点确认 / 暂停恢复后的快路径兜底：正常情况下引擎 playing 事件已即时重锚
  // （syncFromEngine 订阅），这里 ~300ms 后补一次，覆盖「seek 未引起引擎状态变化
  // 而没有 playing 事件」（AVPlayer 本地文件 seek）与事件丢失的场景。
  const scheduleFastResync = (musicId: string) => {
    BackgroundTimer.setTimeout(() => {
      if (!playerState.isPlay || playerState.musicInfo.id != musicId) return
      syncFromEngine(musicId)
      getCurrentTime()
    }, 300)
  }

  const setProgress = (time: number, maxTime?: number) => {
    if (!playerState.musicInfo.id) return
    const musicId = playerState.musicInfo.id
    // console.log('setProgress', time, maxTime)
    // 出声回拉记录（上游 restorePlayTime）：seek 意图位置，出声时把音频拉回这里。
    // 同时刷新看门狗宽限基准与回拉预算（每次用户 seek 都是新一轮）。
    restorePlayTime = time
    lastSeekIntentAt = Date.now()
    pullBackCount = 0
    if (mediaBuffer.timeout != null || mediaBuffer.playTime != null) {
      // 缓冲看门狗进行中又 seek：清旧轮次，以新目标为回拉基准重启看门狗（上游同语义）
      clearBufferTimeout()
      mediaBuffer.playTime = time
      startBuffering()
    }
    setNowPlayTime(time)
    // 对齐上游 seek→歌词时序（usePlayProgress.setProgress 只做 setNowPlayTime +
    // setCurrentTime，不碰歌词）：seek 只立即跳进度条，歌词不动——时钟继续外推
    // 当前（旧）位置，歌词跟着正在出声的音频走；引擎真正从落点出声时 playing
    // 事件统一重锚（≈上游 onPlaying → lrc.play(currentTime)）。seekTargetPosition
    // 窗口保留：窗口内引擎旧位置不得刷进进度条 UI（防拖动/seek 后进度条抽帧）。
    seekTargetPosition = time
    seekHoldUntil = Date.now() + 2000
    seekGen++

    void setCurrentTime(time).then((targetPosition) => {
      if (!playerState.musicInfo.id) return
      if (targetPosition > 0) {
        setNowPlayTime(targetPosition)
        seekTargetPosition = targetPosition
        seekHoldUntil = Date.now() + 2000
        // 硬保证对齐（≈上游 seeked）：setCurrentTime 内部的稳定化轮询在【引擎位置
        // 到达落点】之后才 resolve——此刻立即尝试重锚，等价于上游「seeked → playing
        // → lrc.play」里 playing 的即时性，不再等 300ms 快路径/1s 慢校准。
        // syncFromEngine 自带代际/引擎状态守卫：仍在缓冲则安全丢弃，交给后续
        // playing 事件 / 快路径 / 行级自愈探针的网。
        syncFromEngine(musicId)
        // 落点确认快路径：~300ms 后兜底重锚（覆盖 resolve 后引擎状态短暂波动被
        // 上面的立即尝试丢弃、或无状态变化引擎的 seek 事件缺失场景）
        scheduleFastResync(musicId)
      }
    })

    if (maxTime != null) setMaxplayTime(getTimelineDuration(playerState.playMusicInfo.musicInfo, maxTime))

    // if (!isPlay) audio.play()
  }


  const handlePlay = () => {
    void getMaxTime()
    // prevProgressStatus = 'normal'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    audioClock.setPlaying(true)
    startUpdateTimeout()

    // 行级歌词重锚由 core/lyric 的 app_event.play 订阅完成（ticker 从引擎绝对时间
    // 重新出发）；时钟/原生时钟/基线的即时重锚由引擎状态事件订阅（syncFromEngine）
    // 完成。这里保留 300ms 快路径兜底：覆盖 playing 事件的快照恰逢状态抖动被丢弃、
    // 或引擎无状态变化（无事件）的 seek 场景。
    if (playerState.musicInfo.id) scheduleFastResync(playerState.musicInfo.id)
  }
  const handlePause = () => {
    // prevProgressStatus = 'paused'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    // clearBufferTimeout()
    audioClock.setPlaying(false)
    clearUpdateTimeout()
    clearSyncRetry()
    // 快路径随暂停冻结（engineConfirmedPlaying/isBufferingHold/seek 窗口由引擎状态
    // 事件订阅维护——buffering 也会走到这里（controller 对 buffering 发 app_event.pause，
    // ≈上游 waiting→pause），此处不能清 seek 窗口，否则 seek 中途的缓冲会让引擎旧
    // 位置解除拦截、进度条抽帧回归）
  }

  const handleStop = () => {
    clearUpdateTimeout()
    seekTargetPosition = null
    seekHoldUntil = 0
    seekGen++
    clearSyncRetry()
    clearBufferTimeout()
    restorePlayTime = null
    lastSeekIntentAt = 0
    pullBackCount = 0
    // 切歌/停播可能没有任何引擎状态事件（尤其 nativeFlac stop 不走状态机），
    // 快路径门控必须显式复位，否则残留的 engineConfirmedPlaying 会让 4Hz 位置
    // 事件/自愈探针在上首歌曲的原生时钟位置上继续工作。
    engineConfirmedPlaying = false
    audioClock.reset()
    setNowPlayTime(0)
    setMaxplayTime(0)
    engineConfirmedPlaying = false
    isBufferingHold = false
    // prevProgressStatus = 'none'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
  }

  const handleError = () => {
    // if (!restorePlayTime) restorePlayTime = getCurrentTime() // 记录出错的播放时间
    // console.log('handleError')
    // prevProgressStatus = 'error'
    // handleSetTaskBarState(playProgress.progress, prevProgressStatus)
    clearUpdateTimeout()
  }


  const handleSetPlayInfo = () => {
    // restorePlayTime = playProgress.nowPlayTime
    // void setCurrentTime(playerState.progress.nowPlayTime)
    // setMaxplayTime(playProgress.maxPlayTime)
    handlePause()
    updateScrobbleInfo()
    // Skip the startup restore transition so we don't overwrite saved progress with 0.
    if (isRestoringCurrentMusic()) return
    if (!playerState.playMusicInfo.isTempPlay) {
      void savePlayInfo({
        time: playerState.progress.nowPlayTime,
        maxTime: playerState.progress.maxPlayTime,
        listId: playerState.playMusicInfo.listId!,
        index: playerState.playInfo.playIndex,
      })
    }
  }

  // watch(() => playerState.progress.nowPlayTime, (newValue, oldValue) => {
  //   if (settingState.setting['player.isSavePlayTime'] && !playMusicInfo.isTempPlay) {
  //     delaySavePlayInfo({
  //       time: newValue,
  //       maxTime: playerState.progress.maxPlayTime,
  //       listId: playMusicInfo.listId as string,
  //       index: playInfo.playIndex,
  //     })
  //   }
  // })
  // watch(() => playerState.progress.maxPlayTime, maxPlayTime => {
  //   if (!playMusicInfo.isTempPlay) {
  //     delaySavePlayInfo({
  //       time: playerState.progress.nowPlayTime,
  //       maxTime: maxPlayTime,
  //       listId: playMusicInfo.listId as string,
  //       index: playInfo.playIndex,
  //     })
  //   }
  // })

  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys, _settings) => {
    if (keys.includes('player.playbackRate')) startUpdateTimeout()
    // 对齐上游：开关本身持久化于设置存储；这里立即把切换后的位置语义落盘——
    // 关闭「记住播放进度」时马上存 0（下次从头播），开启时存当前真实进度
    if (keys.includes('player.isSavePlayTime') && playerState.musicInfo.id && !playerState.playMusicInfo.isTempPlay) {
      void savePlayInfo({
        time: settingState.setting['player.isSavePlayTime'] ? playerState.progress.nowPlayTime : 0,
        maxTime: playerState.progress.maxPlayTime,
        listId: playerState.playMusicInfo.listId!,
        index: playerState.playInfo.playIndex,
      })
    }
  }

  const handleScreenStateChanged: Parameters<typeof onScreenStateChange>[0] = (state) => {
    isScreenOn = state == 'ON'
    if (isScreenOn) {
      if (playerState.isPlay && playerState.musicInfo.id) {
        startUpdateTimeout()
        // 熄屏期间系统节流定时器：歌词引擎内部 ticker 的锚点已过期，行级高亮与
        // 逐字插值都需要以引擎绝对位置重新出发（≈上游 onVisibilityChange 恢复处理）。
        // syncFromEngine 重锚时钟/原生时钟/基线；resyncLyricToEngine 以引擎时间
        // 重启行级 ticker。
        syncFromEngine(playerState.musicInfo.id)
        resyncLyricToEngine()
      }
    } else {
      clearUpdateTimeout()
      // 对齐上游 beforeunload 兜底：熄屏（对应桌面端失活）瞬间把当前进度
      // 落盘一次——熄屏期间轮询停止无新进度，此后被杀进程也能恢复到熄屏前位置
      if (playerState.musicInfo.id && !playerState.playMusicInfo.isTempPlay) {
        void savePlayInfo({
          time: settingState.setting['player.isSavePlayTime'] ? playerState.progress.nowPlayTime : 0,
          maxTime: playerState.progress.maxPlayTime,
          listId: playerState.playMusicInfo.listId!,
          index: playerState.playInfo.playIndex,
        })
      }
    }
  }

  // 修复在某些设备上屏幕状态改变事件未触发导致的进度条未更新的问题
  AppState.addEventListener('change', (state) => {
    if (state == 'active' && !isScreenOn) handleScreenStateChanged('ON')
  })

  // 原生位置事件快路径（4Hz，仅前台播放时由歌词时钟发布）：免桥接查询驱动进度 UI，
  // ≈上游 timeupdate → setNowPlayTime（进度条唯一驱动源）。行级歌词不由它驱动
  // （上游同构：歌词行由引擎内部 ticker 推进）。启用条件：慢路径/事件已确认引擎在播、
  // 非缓冲 hold、非进度拖动、非 seek 生效窗口、App 前台。
  onPlayerPosition((position, rate) => {
    if (AppState.currentState !== 'active') return
    if (!engineConfirmedPlaying || isBufferingHold) return
    if (isProgressDragging) return
    if (!playerState.isPlay || !playerState.musicInfo.id) return
    if (seekTargetPosition != null) {
      if (Date.now() < seekHoldUntil) {
        // 硬保证对齐（≈上游 playing，4Hz 粒度）：位置事件已看到引擎到达落点——
        // 立即清窗并重锚，不等 1s 慢校准。syncFromEngine 自带全套守卫（代际/状态）。
        if (Math.abs(position - seekTargetPosition) < 1.5) {
          seekTargetPosition = null
          seekHoldUntil = 0
          syncFromEngine(playerState.musicInfo.id)
        } else return
      } else {
        seekTargetPosition = null
        seekHoldUntil = 0
      }
    }
    setNowPlayTime(position)
    audioClock.setAnchor(position * 1000, rate || settingState.setting['player.playbackRate'], true)
    // 行级自愈探针（快路径层，≤250ms 收敛）：守卫条件（确认在播/非缓冲/非拖动/非
    // seek 窗口）已在上方逐条检查，position 为原生歌词时钟外推的引擎位置。覆盖
    // 「playing 事件被丢弃但快路径已复活」的窗口，比 1s 慢校准更快自愈。
    verifyLyricLineSync(position * 1000)
  })

  // ≈ 上游 `seeked` 事件（AVPlayer seek completion，源级无条件触发，AVPlayer 路径）：
  // 引擎真正到达落点时原生转发，立即重锚——这是落点确认链路里延迟最低的一层
  // （nativeFlac 路径由其 playing 状态事件「出声即发」承担同一职责；暂停中 seek 由
  // syncFromEngine 的 isPlay 守卫自然丢弃，与上游一致：seeked 不携带 playing）。
  onPlayerSeeked(() => {
    const musicId = playerState.musicInfo.id
    if (!musicId || !playerState.isPlay) return
    syncFromEngine(musicId)
  })

  global.app_event.on('play', handlePlay)
  global.app_event.on('pause', handlePause)
  global.app_event.on('stop', handleStop)
  global.app_event.on('error', handleError)
  global.app_event.on('setProgress', setProgress)
  global.app_event.on('progressDragState', (dragging: boolean) => {
    isProgressDragging = dragging
  })
  // global.app_event.on(eventPlayerNames.restorePlay, handleRestorePlay)
  // global.app_event.on('playerLoadeddata', handleLoadeddata)
  // global.app_event.on('playerCanplay', handleCanplay)
  // global.app_event.on('playerWaiting', handleWating)
  // global.app_event.on('playerEmptied', handleEmpied)
  global.app_event.on('musicToggled', handleSetPlayInfo)
  global.state_event.on('configUpdated', handleConfigUpdated)

  onScreenStateChange(handleScreenStateChanged)
}
