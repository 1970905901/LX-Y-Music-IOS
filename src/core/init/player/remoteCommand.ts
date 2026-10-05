import { onRemoteCommand } from '@/utils/nativeModules/utils'
import { pause, playNext, playPrev, requestPlay } from '@/core/player/player'
import { markTimeoutExitInteraction } from '@/core/player/timeoutExit'
import { getUnifiedPlaybackState } from '@/plugins/player/engine'
import type { UnifiedPlaybackState } from '@/plugins/player/engine/types'
import playerState from '@/store/player/state'

// 上一曲 / 下一曲的去重必须是**时间窗**，不能用「在途布尔量」。
//
// 历史坑（用户实锤：控制中心 / 灵动岛的上一首、下一首完全不生效，播放/暂停仍可用）：
// 旧实现用一个布尔量表示「切歌命令在路上」，只在该命令的 Promise settle 时才复位。
// 只要这条 Promise 因后台挂起/引擎切换一直不 settle（控制中心、灵动岛本来就只在
// App 非活跃时使用），或者 run() 在 set 之前同步抛错（连 .finally 都挂不上），
// 布尔量就永久停在 true —— 这两个键从此彻底失效，直到重启 App。
// 时间窗只需要压掉「一次物理按键被重复投递」（越狱 CarPlay 实锤），窗口过后自然恢复。
const NAV_COMMAND_DEDUP_MS = 350
// toggle 的引擎状态查询兜底窗口（见 toggle 分支）：查询挂起时不能吞掉这次按压
const TOGGLE_STATE_QUERY_TIMEOUT_MS = 250

// toggle 的目标状态：把「按一下」表达成明确意图。超时兜底与晚到校正都只沿同一意图执行 ——
// 既不反转用户意图，也不会补出第二次 toggle。
type ToggleIntent = 'play' | 'pause'
const applyToggleIntent = (intent: ToggleIntent) => {
  if (intent === 'pause') void pause()
  else requestPlay()
}
const intentFromEngineState = (state: UnifiedPlaybackState): ToggleIntent =>
  state === 'playing' || state === 'buffering' ? 'pause' : 'play'
let lastNavCommandAt = 0
const runNavCommand = (run: () => Promise<void>) => {
  const now = Date.now()
  if (now - lastNavCommandAt < NAV_COMMAND_DEDUP_MS) return
  lastNavCommandAt = now
  const settleGuard = (error: unknown) => {
    // 切歌失败不能把后续按键一起带走；失败本身由播放链路自己的错误处理兜
    void error
  }
  try {
    void run().catch(settleGuard)
  } catch (error) {
    settleGuard(error)
  }
}

export default () => {
  onRemoteCommand((event) => {
    markTimeoutExitInteraction()

    switch (event.command) {
      case 'play':
        // 手动播放必须一次生效：走「播放意图」（首次 play 被中断吞掉时按短延迟复查并补发）
        requestPlay()
        break
      case 'pause':
        void pause()
        break
      case 'toggle': {
        // 播放/暂停方向：快速路径以**引擎真实状态**为准（图标可能滞后一拍）；
        // 超时兜底按**镜像意图**先动作，晚到结果只在「兜底是空操作」时对齐一次。
        // 任何路径都只沿同一意图（pause/play）执行，不会反转、也不会补出第二次 toggle。
        const mirrorIntent: ToggleIntent = playerState.isPlay ? 'pause' : 'play'
        let settled = false
        let fallbackIntent: ToggleIntent | null = null
        let corrected = false

        const settle = (action: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(fallbackTimer)
          action()
        }
        const fallbackTimer = setTimeout(() => {
          if (settled) return
          settle(() => { applyToggleIntent(mirrorIntent) })
          fallbackIntent = mirrorIntent
          console.log(`###LXRemoteJS### toggle fallback intent=${mirrorIntent} after ${TOGGLE_STATE_QUERY_TIMEOUT_MS}ms`)
        }, TOGGLE_STATE_QUERY_TIMEOUT_MS)

        void getUnifiedPlaybackState()
          .then((state) => {
            const engineIntent = intentFromEngineState(state)
            if (!settled) {
              console.log(`###LXRemoteJS### toggle resolved state=${state} intent=${engineIntent}`)
              settle(() => { applyToggleIntent(engineIntent) })
              return
            }
            // 兜底已执行：引擎状态仍指向同一意图 = 兜底是空操作（镜像滞后），
            // 只做一次同方向幂等对齐；若已在目标态则什么都不做。
            if (!corrected && fallbackIntent != null && engineIntent === fallbackIntent) {
              corrected = true
              console.log(`###LXRemoteJS### toggle fallback missed (state=${state}), re-apply intent=${fallbackIntent}`)
              applyToggleIntent(fallbackIntent)
            }
          })
          .catch(() => {
            console.log(`###LXRemoteJS### toggle state query failed, fallback intent=${mirrorIntent}`)
            settle(() => { applyToggleIntent(mirrorIntent) })
          })

        break
      }
      case 'next':
        runNavCommand(playNext)
        break
      case 'previous':
        runNavCommand(playPrev)
        break
      case 'seek':
        if (typeof event.position == 'number') {
          global.app_event.setProgress(event.position)
        }
        break
    }
  })
}
