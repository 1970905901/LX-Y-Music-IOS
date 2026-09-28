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
  onPreview?: (progress: number) => void
}

/**
 * 播放器进度条的公共逻辑：拖动 seek + 歌词预览。
 * iPhone（ProgressBar）与 iPad（Progress）两份皮肤共用，避免一侧修了另一侧漏掉。
 *
 * 注：非拖动进度条由 playProgressChanged 驱动 `width` 百分比直接渲染（4Hz），
 * 不再做 Animated 线性补间——旧补间没有任何皮肤消费其输出值（两份皮肤都用
 * `progress` prop 渲染），却在播放期间以 JS 帧率空转，纯属浪费。
 */
/**
 * 非拖动进度条的平滑补间（原生驱动 translateX 滑动条）。
 *
 * 背景：快路径位置事件 4Hz 发布，皮肤若把 progress 直接渲染成 width 百分比，
 * 进度条每 250ms 阶梯跳一格——播放详情页歌词动画并发负载下 JS 帧不稳时尤其
 * 明显，表现为进度条动画不流畅。且 width 不在原生动画白名单，无法原生驱动。
 *
 * 做法：progress prop 每 tick 到达时，用原生驱动的 Animated.timing（UI 线程，
 * 不受 JS 帧影响）以 250ms 线性滑到新目标——原生动画从当前值起步，逐 tick 链式
 * 衔接，肉眼即匀速连续。translateX 在原生驱动白名单内，用「全宽条 + 负向位移」
 * 表达进度：translateX = (p-1) × 容器宽。
 *
 * seek 例外（产品要求）：点按进度条 / 拖动松手 / 歌词跳转后进度条**直接跳到目标
 * 位置，无变化过程**。监听 setProgress 事件标记 800ms 吸附窗口，窗口内的进度
 * 变更用 0 时长原生动画瞬间落位（0 时长动画同时会接管正在运行的补间，避免
 * setValue 与运行中动画打架）。
 */
let seekSnapUntil = 0
export const useSmoothProgressAnim = (progress: number): Animated.Value => {
  const anim = useRef(new Animated.Value(clamp01(progress))).current
  const targetRef = useRef(clamp01(progress))

  useEffect(() => {
    const handleSeek = () => { seekSnapUntil = Date.now() + 800 }
    global.app_event.on('setProgress', handleSeek)
    return () => {
      global.app_event.off('setProgress', handleSeek)
    }
  }, [])

  useEffect(() => {
    const target = clamp01(progress)
    // 目标未变（重渲染但事件未推进）不重启动画，省掉无谓的桥往返
    if (Math.abs(target - targetRef.current) < 0.0001) return
    targetRef.current = target
    const isSeekSnap = Date.now() < seekSnapUntil
    Animated.timing(anim, {
      toValue: target,
      duration: isSeekSnap ? 0 : 250,
      easing: Easing.linear,
      isInteraction: false,
      useNativeDriver: true,
    }).start()
  }, [progress, anim])

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

  // 拖动中实时把歌词时钟重锚到手指位置（毫秒），避免高亮行与进度条错位。
  const onPreview = useCallback(
    (value: number) => {
      if (!canSeek()) return
      global.app_event.progressDragPreview(clamp01(value) * durationRef.current * 1000)
    },
    [canSeek],
  )

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
      onPreview,
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
