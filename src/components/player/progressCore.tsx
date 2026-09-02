import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, PanResponder, View } from 'react-native'

import { useDrag } from '@/utils/hooks'
import { setPagerScrollEnabled } from '@/utils/pagerScrollControl'
import { useSettingValue } from '@/store/setting/hook'
import { clamp01, createStyle } from '@/utils/tools'

// 广播「进度条拖动中」状态：
// playProgress 的逐秒校准（tickCalibrate）依赖该标志让路，否则拖动期间每秒都会被
// 引擎真实位置重锚，把进度条和歌词从手指位置拽回去，表现为拖动时来回回跳。
const emitDragState = (isDrag: boolean) => {
  try {
    global.app_event.progressDragState(isDrag)
  } catch {}
}

// Animated.Value 没有公开的读取接口，__getValue() 是内部实现。
// 包一层兜底：任何异常 / 非有限值一律按 0 处理，避免 NaN 污染后续动画。
const readAnimValue = (value: Animated.Value): number => {
  try {
    const raw = (value as unknown as { __getValue?: () => number }).__getValue?.()
    return typeof raw == 'number' && Number.isFinite(raw) ? raw : 0
  } catch {
    return 0
  }
}

export interface ProgressDrag {
  /** 是否允许拖动 seek（由「允许拖动播放进度条跳转」开关控制） */
  seekEnabled: boolean
  /** 是否正在拖动 */
  draging: boolean
  /** 手指当前对应的进度（0~1） */
  dragProgress: number
  /** 非拖动时的补间进度值，直接用于 width 插值 */
  animProgress: Animated.Value
  onDragState: (drag: boolean) => void
  setDragProgress: (progress: number) => void
  onSetProgress: (progress: number) => void
  onPreview?: (progress: number) => void
}

/**
 * 播放器进度条的公共逻辑：平滑补间 + 拖动 seek + 歌词预览。
 * iPhone（ProgressBar）与 iPad（Progress）两份皮肤共用，避免一侧修了另一侧漏掉。
 */
export const useProgressDrag = (progress: number, duration: number): ProgressDrag => {
  // 「允许拖动进度条跳转」开关：关闭后进度条仅展示，不响应任何点击/拖动。
  const seekEnabled = useSettingValue('common.allowProgressBarSeek')

  const [draging, setDraging] = useState(false)
  const [dragProgress, setDragProgress] = useState(0)
  // 播放中 playProgressChanged 约每 1s 触发一次，进度条原本是秒级跳变。
  // 非拖动时用 Animated 在两次更新之间做线性补间，让进度条连续平滑滑动。
  const animProgress = useRef(new Animated.Value(clamp01(progress))).current
  const lastUpdateTimeRef = useRef(0)
  const wasDragingRef = useRef(false)

  useEffect(() => {
    if (draging) {
      wasDragingRef.current = true
      return
    }
    const target = clamp01(progress)
    const current = readAnimValue(animProgress)

    // 拖动刚结束：把补间值立即对齐到释放位置，避免「从拖动前旧值缓慢追到目标」
    // 造成的进度条回退 + 慢动画（表现为手动滑动进度条动画太慢）。
    if (wasDragingRef.current) {
      wasDragingRef.current = false
      animProgress.setValue(target)
      lastUpdateTimeRef.current = 0
      return
    }

    // 切歌 / 后退 seek / 重播等进度回退时直接跳到目标，避免反向补间把进度条往回拉。
    if (target < current - 1e-6) {
      animProgress.setValue(target)
      lastUpdateTimeRef.current = Date.now()
      return
    }

    const now = Date.now()
    const dt = lastUpdateTimeRef.current ? now - lastUpdateTimeRef.current : 1000
    lastUpdateTimeRef.current = now

    const anim = Animated.timing(animProgress, {
      toValue: target,
      duration: Math.min(Math.max(dt, 250), 1500),
      easing: Easing.linear,
      useNativeDriver: false,
    })
    anim.start()
    return () => anim.stop()
  }, [progress, draging, animProgress])

  const durationRef = useRef(duration)
  useEffect(() => {
    durationRef.current = duration
  }, [duration])

  // 总时长未就绪（缓冲中 / 直播流 / 时长为 0）时禁止跳转。
  // 否则 progress * 0 === 0，轻触一下就会把歌曲拖回开头，歌词也会跟着跳到第 0 行。
  const canSeek = useCallback(
    () => Number.isFinite(durationRef.current) && durationRef.current > 0,
    []
  )

  const onSetProgress = useCallback(
    (value: number) => {
      if (!canSeek()) return
      global.app_event.setProgress(clamp01(value) * durationRef.current)
    },
    [canSeek]
  )

  // 拖动中实时把歌词时钟重锚到手指位置（毫秒），避免高亮行与进度条错位。
  const onPreview = useCallback(
    (value: number) => {
      if (!canSeek()) return
      global.app_event.progressDragPreview(clamp01(value) * durationRef.current * 1000)
    },
    [canSeek]
  )

  return {
    seekEnabled,
    draging,
    dragProgress,
    animProgress,
    onDragState: setDraging,
    setDragProgress,
    onSetProgress,
    onPreview,
  }
}

/**
 * 进度条手势层。抽出来是为了让两侧皮肤共用同一套手势容错，
 * 避免 iPhone 侧修完的问题在 iPad 侧重现。
 */
export const ProgressTouchArea = memo(
  ({
    onDragState,
    setDragProgress,
    onSetProgress,
    onPreview,
  }: {
    onDragState: (drag: boolean) => void
    setDragProgress: (progress: number) => void
    onSetProgress: (progress: number) => void
    onPreview?: (progress: number) => void
  }) => {
    const { onLayout, onDragStart, onDragEnd, onDrag } = useDrag(
      onSetProgress,
      onDragState,
      setDragProgress,
      onPreview
    )

    // PanResponder.create 在首次渲染时生成，闭包内直接引用 props 会得到首次渲染的回调。
    // 用 ref 包一层，让手势回调永远读到最新函数，避免后续重渲染后 seek/preview 实际失效。
    const handlersRef = useRef({ onDragStart, onDragEnd, onDrag })
    handlersRef.current = { onDragStart, onDragEnd, onDrag }

    const panResponder = useRef(
      PanResponder.create({
        // capture 阶段拦截：手指刚落下就抢 responder，避免 PagerView / ScrollView 在 bubble 阶段抢走。
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,

        onPanResponderMove: (_evt, gestureState) => {
          handlersRef.current.onDrag(gestureState.dx)
        },
        onPanResponderGrant: (evt, gestureState) => {
          // 拖动进度条期间同步禁用 PagerView 原生横滑（直接 setNativeProps，绕过 state 异步），
          // 避免原生分页控件在左拖时抢占横向手势导致卡顿 / 误切歌词页。
          setPagerScrollEnabled(false)
          emitDragState(true)
          handlersRef.current.onDragStart(
            gestureState.dx,
            evt.nativeEvent.locationX,
            evt.nativeEvent.locationY
          )
        },
        onPanResponderRelease: (_evt, gestureState) => {
          setPagerScrollEnabled(true)
          emitDragState(false)
          handlersRef.current.onDragEnd(gestureState.dx, gestureState.dy)
        },
        // 手势被系统中断（来电 / 下拉通知 / 控制中心 / 父级接管）时必须复位：
        // 否则 isDraging 永久为 true，进度条被钉在手指位置不再随音频前进，
        // playProgress 的歌词时钟也会一直 hold 住，出现「音频在放、进度条和歌词不动」。
        onPanResponderTerminate: () => {
          setPagerScrollEnabled(true)
          emitDragState(false)
          handlersRef.current.onDragEnd()
        },
        // 关键修复：拒绝被父级（播放页纵向滑动切歌）手势抢占。
        // 否则 onPanResponderRelease 不触发、onSetProgress(seek) 被丢弃，
        // 表现为「拖了进度条但歌曲不跳转」。
        onPanResponderTerminationRequest: () => false,
      })
    ).current

    return (
      <View
        onLayout={onLayout}
        style={styles.pressBar}
        // 扩大触控范围：进度条本身很细（iPhone 19px / iPad 3px），不扩难以命中
        hitSlop={{ top: 18, bottom: 18, left: 0, right: 0 }}
        {...panResponder.panHandlers}
      />
    )
  }
)

const styles = createStyle({
  pressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    zIndex: 6,
  },
})
