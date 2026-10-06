import { View } from 'react-native'
import type { ReactNode } from 'react'
import { useHorizontalMode } from '@/utils/hooks'

interface Props {
  children: ReactNode
  /** 横屏限宽最大宽度，缺省 1000 */
  maxWidth?: number
}

/**
 * 列表/阅读型页面的横屏限宽居中容器（iPad 横屏 / 手机横屏通用，与设备类型无关）。
 * - 横屏（useHorizontalMode）：内容限宽并水平居中，避免列表行/文字在超宽屏上被拉得过长；
 * - 竖屏：占满全屏（flex:1），与原结构一致，零回归。
 * 横屏判定来自 useHorizontalMode（窗口宽高比 > 1.2），不依赖任何设备类型判断。
 */
export default ({ children, maxWidth = 1000 }: Props) => {
  const isHorizontal = useHorizontalMode()
  if (!isHorizontal) return <View style={{ flex: 1 }}>{children}</View>
  return (
    <View style={{ flex: 1, maxWidth, alignSelf: 'center', width: '100%' }}>{children}</View>
  )
}
