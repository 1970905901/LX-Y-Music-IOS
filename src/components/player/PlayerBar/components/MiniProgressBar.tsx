import { memo, useEffect, useRef } from 'react'
import { Animated, Easing, View } from 'react-native'
import { useProgress } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { clamp01, createStyle } from '@/utils/tools'
import { designRadius } from '@/theme/DesignTokens'

// Animated.Value 没有公开的读取接口，__getValue() 是内部实现。
// 这里包一层兜底，避免读到 undefined / NaN 让后续动画失效。
const readAnimValue = (value: Animated.Value): number => {
  try {
    const raw = (value as unknown as { __getValue?: () => number }).__getValue?.()
    return typeof raw == 'number' && Number.isFinite(raw) ? raw : 0
  } catch {
    return 0
  }
}

const MiniProgressBar = () => {
  const theme = useTheme()
  const { progress } = useProgress()
  const progressAnim = useRef(new Animated.Value(clamp01(progress))).current
  const animRef = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => {
    const target = clamp01(progress)
    const current = readAnimValue(progressAnim)

    // 切歌 / 后退 seek / 重播：进度回退时直接落位。
    // 否则会播出一段从右往左的反向动画，迷你条看起来像在「倒放」。
    if (target < current - 1e-6) {
      animRef.current?.stop()
      animRef.current = null
      progressAnim.setValue(target)
      return
    }

    // 跨度较大（轻触跳转 / 换歌）时缩短补间，避免慢吞吞地追。
    const isJump = target - current > 0.05

    // 先停掉在飞的补间：连续 tick 叠加多个 timing 会让进度条来回抖动。
    animRef.current?.stop()
    animRef.current = Animated.timing(progressAnim, {
      toValue: target,
      duration: isJump ? 200 : 1000,
      easing: Easing.linear,
      useNativeDriver: false,
      // 关键：不占用 InteractionManager 交互句柄。播放时本补间每 250ms 接力、
      // 永远在飞，若持有句柄会阻塞 runAfterInteractions 队列，导致所有列表页
      // 的 VirtualizedList 单元格停止渲染（表现为播放时列表只出一部分、暂停即恢复）。
      isInteraction: false,
    })
    animRef.current.start()
  }, [progress, progressAnim])

  // 卸载时停掉补间，避免驱动已卸载节点。
  useEffect(
    () => () => {
      animRef.current?.stop()
      animRef.current = null
    },
    []
  )

  const progressStyle = {
    width: progressAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['0%', '100%'],
    }),
    backgroundColor: theme['c-primary'],
  }

  return (
    <View style={{ ...styles.track, backgroundColor: 'transparent' }}>
      <Animated.View style={[styles.progress, progressStyle]} />
    </View>
  )
}

const styles = createStyle({
  track: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  progress: {
    height: '100%',
    borderTopLeftRadius: designRadius.pill,
    borderTopRightRadius: designRadius.pill,
  },
})

export default memo(MiniProgressBar)
