import { useTheme } from '@/store/theme/hook'
import { StatusBar as RNStatusBar } from 'react-native'

const StatusBar = function () {
  const theme = useTheme()
  const statusBarStyle = theme.isDark ? 'light-content' : 'dark-content'
  return (
    <RNStatusBar backgroundColor="rgba(0,0,0,0)" barStyle={statusBarStyle} translucent={true} />
  )
}

// currentHeight 在 iOS 恒为 0 且无人使用（统一走 SizeView 的 StatusBarManager 校准），
// 仅保留 setBarStyle 供主题切换时同步系统状态栏样式。
StatusBar.setBarStyle = RNStatusBar.setBarStyle

export default StatusBar
