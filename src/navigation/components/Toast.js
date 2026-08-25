import { useEffect } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useGetter } from '@/store'
import { Navigation } from 'react-native-navigation'

// 非阻塞 Toast 浮层（替代 iOS 的 Alert.alert）。
// 通过 RNN showOverlay 呈现，overlay.interceptTouchOutside=false 保证不拦截底层触摸，
// 因此即使连续弹出多个也不会破坏 iOS 的 keyWindow/交互状态，从根本上避免整页卡死。
const Toast = ({ componentId, message = '', duration = 2000, position = 'bottom' }) => {
  const theme = useGetter('common', 'theme')

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        void Navigation.dismissOverlay(componentId)
      } catch (err) {
        // 忽略已 dismiss 的情况
      }
    }, duration)
    return () => clearTimeout(timer)
  }, [componentId, duration])

  const rootStyle = [styles.root]
  if (position === 'top') rootStyle.push(styles.rootTop)
  else if (position === 'center') rootStyle.push(styles.rootCenter)

  return (
    <View style={rootStyle}>
      <View style={{ ...styles.toast, backgroundColor: theme.secondary10 }}>
        <Text style={styles.text} numberOfLines={4}>
          {message}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 80,
  },
  rootTop: {
    justifyContent: 'flex-start',
    paddingBottom: 0,
    paddingTop: 80,
  },
  rootCenter: {
    justifyContent: 'center',
    paddingBottom: 0,
  },
  toast: {
    elevation: 2,
    maxWidth: '85%',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: 'white',
    fontSize: 14,
    textAlign: 'center',
  },
})

Toast.options = {
  layout: {
    componentBackgroundColor: 'transparent',
  },
  overlay: {
    // 关键：不拦截底层触摸，避免破坏性交互状态
    interceptTouchOutside: false,
  },
}

export default Toast
