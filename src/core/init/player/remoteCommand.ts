import { onRemoteCommand } from '@/utils/nativeModules/utils'
import { pause, play, playNext, playPrev, togglePlay } from '@/core/player/player'
import { markTimeoutExitInteraction } from '@/core/player/timeoutExit'

// 上一曲 / 下一曲的「在途去重」：
//   同一物理按键理论上应当只产生一条命令，但实测（越狱 CarPlay 方向盘切歌）会出现
//   **一次按键多次投递**：轻则跳两首，重则在少数几首之间来回循环。这里在命令处理期间
//   忽略重复的切歌命令——真实「连按两下」的间隔（≥100ms）远大于 playNext/playPrev 的
//   处理时间（一次 setStop + 切歌调度，几十 ms），因此不会吞掉用户真正的连续操作。
let navCommandInFlight = false
const runNavCommand = (run: () => Promise<void>) => {
  if (navCommandInFlight) return
  navCommandInFlight = true
  void run().finally(() => {
    navCommandInFlight = false
  })
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
        togglePlay()
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
