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

export interface ProgressDrag {
  /** 是否允许拖动 seek（由「允许拖动播放进度条跳转」开关控制） */
  seekEnabled: boolean
  /** 是否正在拖动 */
  draging: boolean
  /** 手指当前对应的进度（0~1）。Animated 直驱：移动回调里 setValue 直连原生属性，
   *  不经 React 渲染——播放详情页歌词动画并发负载下，走 setState 会因 JS 帧不足拖动不跟手。 */
  dragProgressAnim: Animated.Value
  onDragState: (drag: boolean) => void
  setDragProgress: (progress: number) => void
  onSetProgress: (progress: number) => void
}

/**
 * 播放器进度条的公共逻辑：拖动 seek。
 * iPhone（ProgressBar）与 iPad（Progress）两份皮肤共用，避免一侧修了另一侧漏掉。
 */
/**
 * 非拖动进度条的位置驱动（原生驱动 translateX 滑动条）。
 * 对齐上游 ProgressBar.vue / usePlayProgress 的行为：
 * - 播放 tick（4Hz）直接落位，无过渡——上游每个 timeupdate 直接改 scaleX、无 transition，
 *   进度条以 tick 节奏阶梯前进（此前我们的 250ms 线性补间是超出上游的自造平滑，已按
 *   对齐要求移除）；
 * - 仅当相邻两次进度的跳变 >2s 时（seek / 后台恢复大跳 / 切歌归零），对这一次变更挂
 *   180ms 标准曲线过渡滑到目标——即上游 watch(|Δ|>2s) → activePlayProgressTransition →
 *   barTransition 类（--duration-fast: 180ms × --ease-standard: cubic-bezier(.22,1,.36,1)）；
 *   ≤2s 的短跳上游同样直接落位，不动画。
 * translateX 在原生驱动白名单内，用「全宽条 + 负向位移」表达进度：translateX = (p-1) × 容器宽。
 */
const SEEK_JUMP_SEC = 2
const SEEK_TRANSITION_MS = 180
const SEEK_EASING = Easing.bezier(0.22, 1, 0.36, 1)
export const useSmoothProgressAnim = (progress: number, duration: number): Animated.Value => {
  const anim = useRef(new Animated.Value(clamp01(progress))).current
  const targetRef = useRef(clamp01(progress))

  useEffect(() => {
    const target = clamp01(progress)
    // 目标未变（重渲染但事件未推进）不重启动画，省掉无谓的桥往返
    if (Math.abs(target - targetRef.current) < 0.0001) return
    // 对齐上游 usePlayProgress 的 watch：跳变 >2s 才挂过渡，且只作用于这一次变更；
    // 时长未就绪（duration=0）时 Δ×0=0，永不触发过渡（直接落位）。
    const isJump = Math.abs(target - targetRef.current) * duration > SEEK_JUMP_SEC
    targetRef.current = target
    Animated.timing(anim, {
      toValue: target,
      // 播放 tick 直接落位（duration 0）；新动画自动接管正在运行的过渡，避免打架
      duration: isJump ? SEEK_TRANSITION_MS : 0,
      easing: SEEK_EASING,
      isInteraction: false,
      useNativeDriver: true,
    }).start()
  }, [progress, duration, anim])

  return anim
}

// 「允许拖动进度条跳转」开关：关闭后进度条仅展示，不响应任何点击/拖动。
export const useProgressDrag = (progress: number, duration: number): ProgressDrag => {
  const seekEnabled = useSettingValue('common.allowProgressBarSeek')

  const [draging, setDraging] = useState(false)
  // 手指进度走 Animated.Value 直驱：setDragProgress 以触摸移动频率被调用，若走 setState
  // 会以同一频率渲染整棵进度条子树，在播放详情页（歌词逐字动画等并发负载）上 JS 帧不足，
  // 表现为进度条拖动不跟手。setValue 绕过 React 渲染直接更新原生属性，实时跟随手指。
  const dragProgressAnim = useRef(new Animated.Value(0)).current

  const durationRef = useRef(duration)
  useEffect(() => {
    durationRef.current = duration
  }, [duration])

  // 总时长未就绪（缓冲中 / 直播流 / 时长为 0）时禁止跳转。
  // 否则 progress * 0 === 0，轻触一下就会把歌曲拖回开头，歌词也会跟着跳到第 0 行。
  const canSeek = useCallback(
    () => Number.isFinite(durationRef.current) && durationRef.current > 0,
    [],
  )

  const onSetProgress = useCallback(
    (value: number) => {
      if (!canSeek()) return
      global.app_event.setProgress(clamp01(value) * durationRef.current)
    },
    [canSeek],
  )

  // 手指层走 Animated 直驱（setValue 直连原生属性），移动零 React 渲染、实时跟手
  const setDragProgress = useCallback(
    (p: number) => {
      dragProgressAnim.setValue(clamp01(p))
    },
    [dragProgressAnim],
  )

  return {
    seekEnabled,
    draging,
    dragProgressAnim,
    onDragState: setDraging,
    setDragProgress,
    onSetProgress,
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
  }: {
    onDragState: (drag: boolean) => void
    setDragProgress: (progress: number) => void
    onSetProgress: (progress: number) => void
  }) => {
    const { onLayout, onDragStart, onDragEnd, onDrag } = useDrag(
      onSetProgress,
      onDragState,
      setDragProgress,
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
            evt.nativeEvent.locationY,
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
      }),
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
  },
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
