import type React from 'react'
import { forwardRef, useImperativeHandle, useRef, useEffect, useCallback, useState } from 'react'
import { Animated, Easing, View, StyleSheet, TouchableWithoutFeedback, BackHandler } from 'react-native'
import { useWindowSize, useHorizontalMode } from '@/utils/hooks'

export interface AnimatedSlideUpPanelType {
  setVisible: (visible: boolean) => void
}

interface Props {
  children: React.ReactNode
  onHide?: () => void
}

/**
 * 名字里的 SlideUp 是历史（最初按上滑设计），现行观感是**淡入淡出**：
 * 播放详情 → 设置弹层走的是 RN Modal 的 `animationType="fade"`
 * （原生 `RCTModalHostView` 把它映射为 `UIModalTransitionStyleCrossDissolve`，
 * 系统模态过渡约 0.25~0.35s），本面板取同一频段的 300ms + 线性曲线，
 * 与设置弹层同频（2026-09-30 用户定案：「临时播放列表弹出没有动画，改成跟设置一样」）。
 *
 * 历史坑：旧实现的 show 用的是 `timing(..., duration: 0)`，等于**从来没有动画**
 * （表现为面板瞬间出现）；hide 还依赖 `timing().start()` 回调去卸载，原生动画回调
 * 可能被后续动画抢占/丢失 → 蒙层以 opacity=0 残留在视图树上继续拦截全屏触摸，
 * 即 d26fa34 修掉的「整页点不动的假死」。所以下面坚持两条：
 * ① 卸载走定时器，绝不挂在动画回调上；② 动画值在隐藏态显式归零。
 */
const FADE_DURATION = 300
// 淡出走完再卸载的冗余（与 components/common/Modal.tsx 的「淡出 ≈250~300ms，留冗余」同思路）
const UNMOUNT_DELAY = FADE_DURATION + 50

const AnimatedSlideUpPanel = forwardRef<AnimatedSlideUpPanelType, Props>(({ children, onHide }, ref) => {
  const { height: windowHeight } = useWindowSize()
  const isHorizontal = useHorizontalMode()
  const [isVisible, setIsVisible] = useState(false)
  // 0 = 全透明（隐藏态），1 = 不透明（显示态）。蒙层与面板共用这一个值：
  // 与 Modal 的交叉溶解同构 —— 两者一起淡，不会出现「蒙层瞬现、面板淡入」的割裂。
  const fade = useRef(new Animated.Value(0)).current
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearUnmountTimer = useCallback(() => {
    if (unmountTimer.current == null) return
    clearTimeout(unmountTimer.current)
    unmountTimer.current = null
  }, [])

  const show = useCallback(() => {
    // 淡出途中被重新打开：取消待卸载，从当前透明度直接淡回 1
    clearUnmountTimer()
    setIsVisible(true)
    Animated.timing(fade, {
      toValue: 1,
      duration: FADE_DURATION,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start()
  }, [clearUnmountTimer, fade])

  const hide = useCallback(() => {
    // onHide 必须**同步**回调：父组件靠它立刻把「面板已关」写回状态。
    // 若延后到淡出结束，父层 visible 在此期间仍为 true，300ms 内再点开时
    // setIsVisible(true) 同值不触发重渲与 effect，面板就弹不出来。
    // 只把**内部卸载**延后。
    onHide?.()
    Animated.timing(fade, {
      toValue: 0,
      duration: FADE_DURATION,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start()
    // 卸载交给定时器、**不**依赖 timing().start 回调（见文件头历史坑）
    clearUnmountTimer()
    unmountTimer.current = setTimeout(() => {
      unmountTimer.current = null
      fade.setValue(0)
      setIsVisible(false)
    }, UNMOUNT_DELAY)
  }, [clearUnmountTimer, fade, onHide])

  useImperativeHandle(ref, () => ({
    setVisible: (visible: boolean) => {
      if (visible) show()
      else hide()
    },
  }))

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isVisible) {
        hide()
        return true
      }
      return false
    })

    return () => { backHandler.remove() }
  }, [isVisible, hide])

  // 卸载时清掉未触发的定时器，避免对已卸载组件 setState
  useEffect(() => clearUnmountTimer, [clearUnmountTimer])

  if (!isVisible) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <TouchableWithoutFeedback onPress={hide}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              opacity: fade,
            },
          ]}
        />
      </TouchableWithoutFeedback>
      <View style={[styles.panelContainer, isHorizontal && styles.panelContainerHorizontal]} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.panel,
            isHorizontal ? styles.panelHorizontal : null,
            {
              // 用 windowHeight * 0.5 显式计算高度，避免百分比 height 与 absolute 父级
              // 在多窗口/画中画/动态岛遮挡等场景下跳变；styles.panel.height:'50%'
              // 保留作为兜底，外层样式未生效时仍能正确显示。
              height: windowHeight * 0.5,
              opacity: fade,
            },
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  panelContainer: {
    // 仅用 bottom:0 锚定到屏幕底部，不设 top、不设 height。
    // absolute + bottom:0 + left:0 + right:0 让容器紧贴父（absoluteFill 全屏）底部，
    // 容器自身高度由内容（panel 子节点）撑开，因此 panel 默认就出现在屏幕底部。
    // panel 自身高度在 render 处用 windowHeight * 0.5 显式数值，避免百分比 height
    // 与 panelContainer 形成循环依赖。配合 panelContainerHorizontal.alignItems:'center'
    // 实现 iPad 横屏水平居中。
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  panelContainerHorizontal: {
    alignItems: 'center',
  },
  panel: {
    width: '100%',
    // 高度由 render 处显式设置 windowHeight * 0.5。
    // 此处不写 height，避免百分比与 panelContainer 形成循环依赖
    // （panelContainer 高度由 panel 撑开，50% 父级 = 0，导致面板坍缩）。
  },
  panelHorizontal: {
    maxWidth: 760,
  },
})

export default AnimatedSlideUpPanel
