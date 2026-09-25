import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated } from 'react-native'

export const DEFAULT_DURATION = 800

export const useAnimateNumber = (
  val: number,
  duration = DEFAULT_DURATION,
  useNativeDriver = true
) => {
  const anim = useMemo(() => new Animated.Value(0), [val])
  const [finished, setFinished] = useState(true)
  const currentNumber = useRef(val)
  const nextNumber = useMemo(() => val, [val])

  const animNumber = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [currentNumber.current, nextNumber],
  })

  useEffect(() => {
    setFinished(false)
    Animated.timing(anim, {
      toValue: 1,
      duration,
      useNativeDriver,
      // 全局 Text 的补间不占用 InteractionManager 队列：页面挂载/主题变化时
      // 会爆发式产生大量实例，占住队列会让列表单元格渲染被无限期推迟
      isInteraction: false,
    }).start((finished) => {
      if (!finished) return
      // currentNumber.current = nextNumber
      setFinished(true)
    })
    requestAnimationFrame(() => {
      currentNumber.current = nextNumber
    })
  }, [nextNumber])

  return [animNumber, finished] as const
}

export const useAnimateOnecNumber = (
  val: number,
  toVal: number,
  duration = DEFAULT_DURATION,
  useNativeDriver = true
) => {
  const anim = useMemo(() => new Animated.Value(0), [])
  const [finished, setFinished] = useState(true)

  const animNumber = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [val, toVal],
  })

  useEffect(() => {
    setFinished(false)
    Animated.timing(anim, {
      toValue: 1,
      duration,
      useNativeDriver,
      isInteraction: false,
    }).start((finished) => {
      if (!finished) return
      // currentNumber.current = nextNumber
      setFinished(true)
    })
  }, [])

  return [animNumber, finished] as const
}
