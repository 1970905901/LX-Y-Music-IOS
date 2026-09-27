import { useEffect, useState } from 'react'
import { onTabBarCollapseChanged } from '@/utils/nativeModules/utils'

/**
 * 底部 Tab 栏收起状态（iOS 26 风格最小化）：
 * - 任何歌曲列表滚动离开顶部（offset > 48）→ 收起为左下角圆形按钮；
 * - 列表滚回顶部（offset ≤ 2）→ 自动展开；
 * - 点击收起按钮 → 手动展开，保持到下一次列表滚动离开顶部。
 * 状态由原生滚动跟踪器维护（全 App 列表统一生效，无需逐页接线），
 * 仅状态变化时通知 JS。消费方：ModernTabBar（Home）与 PlayerBar（isHome）。
 */

let collapsed = false
const listeners = new Set<(v: boolean) => void>()
let inited = false

const init = (): void => {
  if (inited) return
  inited = true
  onTabBarCollapseChanged((v) => {
    if (collapsed === v) return
    collapsed = v
    for (const listener of listeners) listener(v)
  })
}

export const useTabBarCollapsed = (): boolean => {
  const [value, setValue] = useState(collapsed)
  useEffect(() => {
    init()
    const listener = (v: boolean): void => {
      setValue(v)
    }
    listeners.add(listener)
    listener(collapsed)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return value
}
