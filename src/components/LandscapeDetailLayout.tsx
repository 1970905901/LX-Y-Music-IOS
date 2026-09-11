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
  /** 可选底部栏（如播放控制条），以绝对定位悬浮在页面底部（横竖屏一致） */
  footer?: ReactNode
  /** 横屏左栏宽度，缺省按大屏档自动取 340 / 420 */
  headerWidth?: number
  /**
   * 横屏时改为上下堆叠（header 全宽在上、body 占满下方并延伸到最右侧）。
   * 供内嵌在更窄容器（如歌单页已让出标签栏宽度）的详情页使用：
   * 左右分栏会把列表挤压到显示不全，上下堆叠可让列表占满整行宽度。
   */
  stackOnLandscape?: boolean
}

/**
 * 详情页横屏分栏布局（iPad 横屏 / 手机横屏通用，与设备类型无关）。
 * - 横屏（useHorizontalMode）：左栏固定宽度放 header（封面/信息），右栏 flex:1 放 body（列表）；
 *   stackOnLandscape 时改为上下堆叠（同竖屏结构）；
 * - footer（播放控制条）以绝对定位悬浮在页面底部，横竖屏一致，body 加底部内边距避让。
 * 所有横屏判定都来自 useHorizontalMode（窗口宽高比 > 1.2），不依赖任何设备类型判断。
 */
export default ({ header, body, footer, headerWidth, stackOnLandscape }: Props) => {
  const theme = useTheme()
  const isHorizontal = useHorizontalMode()
  const layout = useLandscapeLayout()
  const leftWidth = headerWidth ?? (layout.isExpanded ? 420 : 340)

  if (!isHorizontal || stackOnLandscape) {
    return (
      <View style={{ flex: 1, flexDirection: 'column' }}>
        {header}
        {/* 列表本身的 contentContainerStyle 已带 paddingBottom，无需容器再加 */}
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
      </View>
      {/* 列表本身的 contentContainerStyle 已带 paddingBottom，无需容器再加 */}
      <View style={{ flex: 1, overflow: 'hidden' }}>{body}</View>
      {footer}
    </View>
  )
}
