import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated } from 'react-native'

const ANIMATION_DURATION = 800

export const useAnimateColor = (color: string) => {
  const anim = useMemo(() => {
    void color
    return new Animated.Value(0)
  }, [color])
  const [finished, setFinished] = useState(true)
  const currentColor = useRef(color)
  const nextColor = useMemo(() => color, [color])

  const animColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [currentColor.current, nextColor],
  })

  useEffect(() => {
    setFinished(false)
    Animated.timing(anim, {
      toValue: 1,
      duration: ANIMATION_DURATION,
      // 颜色插值（backgroundColor/color）在原生驱动下受支持，转 true 后
      // 主题切换的颜色过渡不再占用 JS 线程——ProMotion 120Hz 上不再因 JS
      // 每帧计算颜色插值而掉帧（本 hook 在主题变化时被大量组件调用）。
      useNativeDriver: true,
      // 主题色过渡动画不占用 InteractionManager 队列，避免阻塞列表渲染
      isInteraction: false,
    }).start((finished) => {
      if (!finished) return
      // currentColor.current = nextColor
      setFinished(true)
    })
    requestAnimationFrame(() => {
      currentColor.current = nextColor
    })
  }, [nextColor, anim])

  return [animColor, finished] as const
}
