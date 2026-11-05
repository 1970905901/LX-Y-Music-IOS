import { useState, useCallback, useMemo, useRef, forwardRef, useImperativeHandle, useEffect } from 'react'
import { Animated } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import Loading from './Loading'

// interface LoadingMaskProps {

// }

export interface LoadingMaskType {
  setVisible: (visible: boolean) => void
}

const FADE_IN_MS = 200
const FADE_OUT_MS = 300

export default forwardRef<LoadingMaskType, {}>((props, ref) => {
  const theme = useTheme()
  const t = useI18n()
  const animFade = useRef(new Animated.Value(0)).current
  const [maskVisible, setMaskVisible] = useState(false)
  // 目标可见性放在 ref 里：useImperativeHandle 的闭包会捕获旧的 maskVisible，
  // 导致「刚 hide 完立刻 show」被同值判断吞掉（遮罩再也出不来）。
  const visibleRef = useRef(false)
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearUnmountTimer = useCallback(() => {
    if (unmountTimer.current == null) return
    clearTimeout(unmountTimer.current)
    unmountTimer.current = null
  }, [])

  useImperativeHandle(ref, () => ({
    setVisible(visible: boolean) {
      if (visibleRef.current == visible) return
      visibleRef.current = visible
      visible ? handleShow() : handleHide()
    },
  }))

  const handleShow = useCallback(() => {
    // console.log('handleShow')
    // 淡出途中被重新显示：取消待卸载，从当前透明度直接淡回 1
    clearUnmountTimer()
    setMaskVisible(true)
    Animated.timing(animFade, {
      toValue: 1,
      duration: FADE_IN_MS,
      useNativeDriver: true,
    }).start()
  }, [animFade, clearUnmountTimer])

  const handleHide = useCallback(() => {
    // console.log('handleHide')
    Animated.timing(animFade, {
      toValue: 0,
      duration: FADE_OUT_MS,
      useNativeDriver: true,
    }).start()
    // 卸载交给定时器而不是动画回调：动画被后续 show 打断时回调收到 finished=false，
    // 旧实现据此直接 return —— 遮罩会以 opacity=0 留在视图树上继续拦截全屏触摸
    // （与 AnimatedSlideUpPanel 修掉的「整页点不动的假死」同一形态）。
    clearUnmountTimer()
    unmountTimer.current = setTimeout(() => {
      unmountTimer.current = null
      // 期间又被要求显示：保持挂载，交给那次 show 的动画收尾
      if (visibleRef.current) return
      animFade.setValue(0)
      setMaskVisible(false)
    }, FADE_OUT_MS + 50)
  }, [animFade, clearUnmountTimer])

  useEffect(() => clearUnmountTimer, [clearUnmountTimer])

  const maskComponent = useMemo(
    () => (
      <Animated.View
        style={{
          ...styles.container,
          backgroundColor: theme['c-main-background'],
          opacity: animFade,
        }}
      >
        <Loading size={25} label={t('list_loading')} />
      </Animated.View>
    ),
    [animFade, t, theme],
  )

  return maskVisible ? maskComponent : null
})

const styles = createStyle({
  container: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
})
