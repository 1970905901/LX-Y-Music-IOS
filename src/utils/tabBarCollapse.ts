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
let miniPlayerHeight = 0
const listeners = new Set<(v: boolean) => void>()
const heightListeners = new Set<(h: number) => void>()
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

/** 迷你播放器实际高度（收起按钮据此对齐高度）；未测量时返回 0（调用方用默认值兜底） */
export const useMiniPlayerHeight = (): number => {
  const [value, setValue] = useState(miniPlayerHeight)
  useEffect(() => {
    const listener = (h: number): void => {
      setValue(h)
    }
    heightListeners.add(listener)
    listener(miniPlayerHeight)
    return () => {
      heightListeners.delete(listener)
    }
  }, [])
  return value
}

/** PlayerBar 测量到自身高度后上报（供收起按钮对齐） */
export const setMiniPlayerHeight = (height: number): void => {
  if (!Number.isFinite(height) || height <= 0 || Math.abs(height - miniPlayerHeight) < 0.5) return
  miniPlayerHeight = height
  for (const listener of heightListeners) listener(height)
}
