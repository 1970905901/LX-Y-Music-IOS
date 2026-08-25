/**
 * 拖拽排序时锁定祖先滚动容器的轻量工具（引用计数 + 订阅）。
 *
 * 背景：iOS 上 ScrollView 底层是原生 UIScrollView，其滚动由原生手势识别器驱动，
 * 仅靠子视图的 PanResponder 接管无法可靠阻止原生滚动。因此需要在拖拽进行中
 * 把相关滚动容器的 scrollEnabled 置为 false。
 *
 * 深层列表项通过本模块通知页面级（或本地）滚动容器在拖拽期间锁定滚动。
 * 使用引用计数以支持多个拖拽源并存，且避免重复 setState。
 */

type Listener = (locked: boolean) => void

let lockCount = 0
const listeners = new Set<Listener>()

const emit = (): void => {
  const locked = lockCount > 0
  listeners.forEach((listener) => listener(locked))
}

/** 请求锁定滚动（引用计数 +1）。首次锁定时通知订阅者。 */
export const acquireScrollLock = (): void => {
  lockCount += 1
  if (lockCount === 1) emit()
}

/** 释放锁定（引用计数 -1）。归零时通知订阅者。重复释放为安全空操作。 */
export const releaseScrollLock = (): void => {
  if (lockCount <= 0) return
  lockCount -= 1
  if (lockCount === 0) emit()
}

/** 当前是否处于锁定状态。 */
export const isScrollLocked = (): boolean => lockCount > 0

/** 订阅锁定状态变化，返回取消订阅函数。 */
export const subscribeScrollLock = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
