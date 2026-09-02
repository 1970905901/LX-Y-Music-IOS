import { memo } from 'react'
import { type ViewStyle, View } from 'react-native'

import { clamp01 } from '@/utils/tools'

export interface LineProgressProps {
  /** 进度，0~1；越界 / NaN 会被收敛，保证宽度字符串始终合法 */
  progress: number
  /** 进度条高度，默认 3 */
  height?: number
  /** 已完成部分颜色 */
  color: string
  /** 轨道底色 */
  trackColor: string
  /** 外层容器附加样式（如宽度、外边距） */
  style?: ViewStyle
}

/**
 * 纯展示用线形进度条：只渲染、不响应任何手势。
 * 下载进度等场景必须用它而不是播放器进度条——后者自带 PanResponder，
 * 拖动时会调用 app_event.setProgress() 去 seek 正在播放的歌曲。
 */
const LineProgress = memo(
  ({ progress, height = 3, color, trackColor, style }: LineProgressProps) => {
    const radius = height / 2

    return (
      <View
        style={[
          { height, borderRadius: radius, overflow: 'hidden', backgroundColor: trackColor },
          style,
        ]}
      >
        <View
          style={{
            height: '100%',
            width: `${clamp01(progress) * 100}%`,
            borderRadius: radius,
            backgroundColor: color,
          }}
        />
      </View>
    )
  }
)

export default LineProgress
