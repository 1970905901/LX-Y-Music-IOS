import type { UnifiedPlayerEvent } from './types'

type Listener = (event: UnifiedPlayerEvent) => void

export class UnifiedPlayerEventBus {
  private readonly listeners = new Set<Listener>()

  emit(event: UnifiedPlayerEvent) {
    for (const listener of this.listeners) {
      // 单个监听器抛错不得饿死其余监听器：控制器 / 进度 / 歌词 / 预加载 / nowPlaying 发布
      // 都挂在同一辆车上，排在后面的监听器会因为一个未捕获异常整批收不到这次事件
      // （历史事故：一次异常之后 nowPlaying 发布链路静默停摆，只剩重启能恢复）。
      // 同「换源闸门 / 初始化粘滞标记」一类：任何一处静默停摆都会表现为永久失效。
      try {
        listener(event)
      } catch (error) {
        console.log('###LXPlayerBus### listener error:', error instanceof Error ? error.message : error)
      }
    }
  }

  on(listener: Listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

