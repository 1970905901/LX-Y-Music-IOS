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
      onMoveShouldSetPanResponderCapture: (_event, { dx, dy }) =>
        dx > 12 && Math.abs(dx) > Math.abs(dy) * 2,
      onPanResponderRelease: (_event, { dx }) => {
        if (enabledRef.current && dx > 40) onBackRef.current()
      },
    }),
  ).current

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
