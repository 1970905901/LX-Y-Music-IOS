import { onRemoteCommand } from '@/utils/nativeModules/utils'
import { pause, play, playNext, playPrev, togglePlay } from '@/core/player/player'
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
        play()
        break
      case 'pause':
        void pause()
        break
      case 'toggle':
        // 播放/暂停方向以**引擎真实状态**为准，不看 playerState.isPlay。
        // 控制中心 / 灵动岛的按钮图标来自系统缓存的 playbackState，而 JS 侧的
        // playerState.isPlay 在系统中断、蓝牙路由抖动、nativeFlac 引擎切换后会滞后一拍；
        // 那一拍里 togglePlay() 会执行「其实已经满足」的动作（按下看起来没反应），
        // 要按第二下才生效 —— 用户 2026-10-03 反馈的「暂停/播放要按两下」即此。
        void getUnifiedPlaybackState()
          .then((state) => {
            if (state === 'playing' || state === 'buffering') void pause()
            else play()
          })
          .catch(() => {
            // 引擎状态查询失败时退回旧口径，至少保证按键有动作
            togglePlay()
          })
        break
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
