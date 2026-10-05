import { onRemoteCommand } from '@/utils/nativeModules/utils'
import { pause, playNext, playPrev, requestPlay, togglePlay } from '@/core/player/player'
import { markTimeoutExitInteraction } from '@/core/player/timeoutExit'
import { getUnifiedPlaybackState } from '@/plugins/player/engine'

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
        // 播放/暂停方向以**引擎真实状态**为准，不看 playerState.isPlay。
        // 控制中心 / 灵动岛的按钮图标来自系统缓存的 playbackState，而 JS 侧的
        // playerState.isPlay 在系统中断、蓝牙路由抖动、nativeFlac 引擎切换后会滞后一拍；
        // 那一拍里 togglePlay() 会执行「其实已经满足」的动作（按下看起来没反应），
        // 要按第二下才生效 —— 用户 2026-10-03 反馈的「暂停/播放要按两下」即此。
        //
        // 但「查引擎状态」本身不能再变成一次永不结算的等待：查询**挂起**（不是 reject）
        // 时 catch 永远不触发，这一次按压被静默吞掉。蓝牙耳机（AVRCP 单键）只发 toggle，
        // 连接蓝牙时的引擎重建 / 后台桥接停摆都可能让查询悬着 —— 用户 2026-10-05 反馈的
        // 「连接蓝牙后蓝牙耳机控制失效」即这一类（同 dfcaa92 的「在途 Promise 永不 settle
        // → 按键永久失效」教训）。这里加超时兜底：到点查询仍没回来就按旧口径 togglePlay()
        // 保证按压有动作；晚到的结果因单次结算被丢弃，绝不会补出第二次动作。
        let settled = false
        const settle = (action: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(fallbackTimer)
          action()
        }
        const fallbackTimer = setTimeout(() => {
          settle(togglePlay)
        }, TOGGLE_STATE_QUERY_TIMEOUT_MS)
        void getUnifiedPlaybackState()
          .then((state) => {
            settle(() => {
              if (state === 'playing' || state === 'buffering') void pause()
              else requestPlay()
            })
          })
          .catch(() => {
            // 引擎状态查询失败时退回旧口径，至少保证按键有动作
            settle(togglePlay)
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
