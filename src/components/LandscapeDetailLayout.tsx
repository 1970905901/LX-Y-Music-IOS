import { View } from 'react-native'
import type { ReactNode } from 'react'
import { useHorizontalMode } from '@/utils/hooks'
import { useLandscapeLayout } from '@/utils/landscapeLayout'
import { useTheme } from '@/store/theme/hook'

interface Props {
  /** 左栏内容：通常为封面/信息块（如专辑、歌单、歌手 Header） */
  header: ReactNode
  /** 右栏内容：通常为列表（如 OnlineList / MusicList / SongList） */
  body: ReactNode
  /** 可选底部栏（如播放控制条），横屏时置于左栏底部、竖屏时置于页面底部 */
  footer?: ReactNode
  /** 横屏左栏宽度，缺省按大屏档自动取 340 / 420 */
  headerWidth?: number
}

/**
 * 详情页横屏分栏布局（iPad 横屏 / 手机横屏通用，与设备类型无关）。
 * - 横屏（useHorizontalMode）：左栏固定宽度放 header（封面/信息），右栏 flex:1 放 body（列表），footer 落左栏底部；
 * - 竖屏：直接还原为原竖向结构（header / body / footer 自上而下），零回归。
 * 所有横屏判定都来自 useHorizontalMode（窗口宽高比 > 1.2），不依赖任何设备类型判断。
 */
export default ({ header, body, footer, headerWidth }: Props) => {
  const theme = useTheme()
  const isHorizontal = useHorizontalMode()
  const layout = useLandscapeLayout()
  const leftWidth = headerWidth ?? (layout.isExpanded ? 420 : 340)

  if (!isHorizontal) {
    return (
      <View style={{ flex: 1, flexDirection: 'column' }}>
        {header}
        <View style={{ flex: 1 }}>{body}</View>
        {footer}
      </View>
    )
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <View
        style={{
          width: leftWidth,
          flexShrink: 0,
          flexDirection: 'column',
          borderRightWidth: 1,
          borderRightColor: theme['c-border-background'],
        }}
      >
        <View style={{ flexShrink: 0 }}>{header}</View>
        {footer ? <View style={{ marginTop: 'auto' }}>{footer}</View> : null}
      </View>
      <View style={{ flex: 1, overflow: 'hidden' }}>{body}</View>
    </View>
  )
}
