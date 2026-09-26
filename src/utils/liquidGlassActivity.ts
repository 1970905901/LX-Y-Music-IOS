import { useEffect, useState } from 'react'

/**
 * 液态玻璃渲染活动状态（省电核心）。
 *
 * 玻璃静止时（背后内容不变）原生渲染时钟完全停止，只保留最后一帧；
 * 任何会改变玻璃背后内容且「无触摸交互」的行为都必须调用 pulseLiquidGlass()
 * 短暂恢复渲染。滚动/拖拽不需要 JS 参与——原生窗口级手势观察自动覆盖。
 *
 * 已接入的脉冲源：
 * - 切 Tab（ModernTabBar 的 activeId 变化）
 * - 换主题/明暗切换、迷你播放条透明度调整（theme 对象变化）
 * - 切歌（封面/歌名变化，PlayerBar 的 musicInfo）
 * - 旋转/横竖屏布局变化（safeAreaBottom / isHorizontalMode 变化）
 * - 原生挂载后自带约 1s 活跃窗（覆盖 RNN 转场与首帧，见 LiquidGlassEffectView.swift）
 */

let activeUntil = 0
let expireTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

const notify = (): void => {
  for (const listener of listeners) listener()
}

/**
 * 让所有液态玻璃背景恢复渲染一段时间。
 * @param duration 恢复时长 ms；需覆盖内容变化的动画时长（如换歌背景交叉淡入约 500ms）
 */
export const pulseLiquidGlass = (duration = 1200): void => {
  activeUntil = Date.now() + duration
  if (expireTimer) clearTimeout(expireTimer)
  // 到期后通知一次，把 active 翻回 false（触发原生暂停）
  expireTimer = setTimeout(() => {
    expireTimer = null
    notify()
  }, duration)
  notify()
}

export const isLiquidGlassActive = (): boolean => Date.now() < activeUntil

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 订阅活动状态。挂在 LiquidGlass 组件内部，业务代码不要直接用。 */
export const useLiquidGlassActive = (): boolean => {
  const [active, setActive] = useState<boolean>(isLiquidGlassActive)
  useEffect(() => {
    const listener = (): void => {
      setActive(isLiquidGlassActive())
    }
    // 订阅时立即同步一次：pulse 可能发生在 render 与 effect 之间
    listener()
    return subscribe(listener)
  }, [])
  return active
}
