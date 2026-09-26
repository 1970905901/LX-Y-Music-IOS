import { memo, useEffect, useRef, useState } from 'react'
import { Animated, Easing, View } from 'react-native'
import { useProgress } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { clamp01, createStyle } from '@/utils/tools'
import { designRadius } from '@/theme/DesignTokens'

const MiniProgressBar = () => {
  const theme = useTheme()
  const { progress } = useProgress()
  const progressAnim = useRef(new Animated.Value(clamp01(progress))).current
  const animRef = useRef<Animated.CompositeAnimation | null>(null)
  // 原生驱动后 JS 侧读不到逐帧值（__getValue 只在 start/stop 时同步），
  // 用「最近一次补间目标」代替实时值做回退判断（切歌/后退 seek 直接落位）。
  const lastTargetRef = useRef(clamp01(progress))
  // 轨道宽度：把宽度补间换成 transform 缩放后，需要实际宽度计算平移量
  const [trackWidth, setTrackWidth] = useState(0)

  useEffect(() => {
    const target = clamp01(progress)
    const current = lastTargetRef.current

    // 切歌 / 后退 seek / 重播：进度回退时直接落位。
    // 否则会播出一段从右往左的反向动画，迷你条看起来像在「倒放」。
    if (target < current - 1e-6) {
      animRef.current?.stop()
      animRef.current = null
      lastTargetRef.current = target
      progressAnim.setValue(target)
      return
    }

    // 跨度较大（轻触跳转 / 换歌）时缩短补间，避免慢吞吞地追。
    const isJump = target - current > 0.05

    // 先停掉在飞的补间：连续 tick 叠加多个 timing 会让进度条来回抖动。
    animRef.current?.stop()
    lastTargetRef.current = target
    animRef.current = Animated.timing(progressAnim, {
      toValue: target,
      duration: isJump ? 200 : 1000,
      easing: Easing.linear,
      // ⚠️ 必须原生驱动：width 布局属性不支持原生驱动，原先用 JS 补间逐帧改宽度，
      // 60fps 地走「JS rAF → 桥接 → 主线程布局 → 迷你播放器容器（带 shadow 且未设
      // shadowPath，iOS 按内容 alpha 重算阴影）重绘」管线，把主线程/JS 线程持续占满，
      // 表现为播放中（尤其后台播放返回后）整页触摸点击无响应、滚动正常，暂停即恢复。
      // 改为 scaleX transform 原生补间后，逐帧插值完全在原生层，JS 零参与、零布局。
      useNativeDriver: true,
      // 不占用 InteractionManager 交互句柄：播放时本补间每 250ms 接力、永远在飞，
      // 若持有句柄会阻塞 runAfterInteractions 队列。
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
    [],
  )

  // 全宽进度条 + scaleX 缩放（原生驱动只支持 transform/opacity 等非布局属性）。
  // 缩放默认以中心为原点，用 translateX = -W(1-p)/2 把左边缘钉回起点，
  // 两个插值都线性依赖同一个 Animated.Value，可在原生层完成。
  const progressStyle = {
    transform: [
      {
        translateX: progressAnim.interpolate({
          inputRange: [0, 1],
          outputRange: trackWidth ? [-trackWidth / 2, 0] : [0, 0],
        }),
      },
      { scaleX: progressAnim },
    ],
    backgroundColor: theme['c-primary'],
  }

  return (
    <View
      style={{ ...styles.track, backgroundColor: 'transparent' }}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width
        if (w > 0 && w !== trackWidth) setTrackWidth(w)
      }}
    >
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
    width: '100%',
    height: '100%',
    borderTopLeftRadius: designRadius.pill,
    borderTopRightRadius: designRadius.pill,
  },
})

export default memo(MiniProgressBar)
