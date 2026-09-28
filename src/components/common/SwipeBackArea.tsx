import { memo, useRef } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'

interface SwipeBackAreaProps {
  onBack: () => void
  enabled?: boolean
}

const styles = StyleSheet.create({
  area: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 12,
    zIndex: 10,
  },
})

const SwipeBackArea = memo(({ onBack, enabled = true }: SwipeBackAreaProps) => {
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  const panResponder = useRef(
    PanResponder.create({
      // 显式声明「单击不认领触摸」：PanResponder 只有 onMoveShouldSet* 时，起始
      // 触摸的响应权归属存在歧义，在同时存在横向 ScrollView / PagerView 的场景下
      // 可能把一次单纯的点击也纳入本层响应链而不再向下传递，使落在本区域
      // （左侧 12pt、全高、zIndex 10）上的按钮点击丢失。显式返回 false 后，
      // 只有明确的横向滑动（dx>12 且横向位移大于纵向两倍）才被本层接管。
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, { dx, dy }) =>
        dx > 12 && Math.abs(dx) > Math.abs(dy) * 2,
      onMoveShouldSetPanResponderCapture: (_event, { dx, dy }) =>
        dx > 12 && Math.abs(dx) > Math.abs(dy) * 2,
      onPanResponderRelease: (_event, { dx }) => {
        if (enabledRef.current && dx > 40) onBackRef.current()
      },
    }),
  ).current

  // pointerEvents 必须保持 'auto'：'box-none' 等价于「自身 pointer-events:none、
  // 子节点 all」，会让本层自身不再是触摸目标，挂在它上面的 PanResponder 收不到
  // 事件、横滑返回直接失效。
  return (
    <View
      style={styles.area}
      pointerEvents={enabled ? 'auto' : 'none'}
      {...panResponder.panHandlers}
    />
  )
})

SwipeBackArea.displayName = 'CommonSwipeBackArea'
export default SwipeBackArea
