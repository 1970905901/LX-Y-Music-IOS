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
      useNativeDriver: false,
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
