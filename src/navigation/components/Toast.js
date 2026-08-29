import { useEffect } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import state from '@/store/theme/state'
import { Navigation } from 'react-native-navigation'
import { shadow } from '@/utils/shadow'

// 非阻塞 Toast 浮层（替代 iOS 的 Alert.alert）。
// 通过 RNN showOverlay 呈现，overlay.interceptTouchOutside=false 保证不拦截底层触摸，
// 因此即使连续弹出多个也不会破坏 iOS 的 keyWindow/交互状态，从根本上避免整页卡死。
//
// 注意：Toast 由 Navigation.showOverlay 渲染，位于应用 <ThemeProvider> 之外，
// 若用 useTheme()（useContext）取到的是 createContext 在模块加载时捕获的初始默认主题，
// 不会随用户在设置中切换的主题（尤其是暗色）更新，导致 Toast 背景错位（表现为“主题问题”）。
// 因此这里直接读取模块级 state.theme——setTheme 会重写它，始终反映当前真实主题。
const Toast = ({ componentId, message = '', duration = 2000, position = 'bottom' }) => {
  const theme = state.theme

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
      <View style={{ ...styles.toast, backgroundColor: theme['c-primary'] }}>
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
    // 跨平台阴影：iOS 用 shadow 系列，Android 用 elevation
    ...shadow(2),
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
