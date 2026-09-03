import { memo } from 'react'
import { View } from 'react-native'

import { ProgressTouchArea, useProgressDrag } from './progressCore'
import { clamp01, createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'

// iPad（横 / 竖屏播放页）：进度条是浮在「状态 + 时间」信息行下沿的一条细线。
// 高度必须与信息行解耦——此前 progressBar 用 height: '100%'，在 26px 高的信息行上
// 会渲染出约 22px 高、近乎不透明的色块，把状态文字与时间文字整条盖住。
const progressHeight = 3

const DefaultBar = memo(({ color }: { color: string }) => {
  return (
    <View
      style={{
        ...styles.progressBar,
        backgroundColor: color,
        position: 'absolute',
        width: '100%',
        left: 0,
        top: 0,
      }}
    />
  )
})

const BufferedBar = memo(({ progress, color }: { progress: number, color: string }) => {
  return (
    <View
      style={{
        ...styles.progressBar,
        backgroundColor: color,
        position: 'absolute',
        width: `${clamp01(progress) * 100}%`,
        left: 0,
        top: 0,
      }}
    />
  )
})

const Progress = ({
  progress,
  duration,
  buffered,
  paddingTop,
}: {
  progress: number
  duration: number
  buffered: number
  paddingTop?: number
}) => {
  const theme = useTheme()
  const {
    seekEnabled,
    draging,
    dragProgress,
    onDragState,
    setDragProgress,
    onSetProgress,
    onPreview,
  } = useProgressDrag(progress, duration)

  // 主题里 alpha-NNN 的数值越大越淡（alpha-100 = 90% 不透明，alpha-900 = 10%）。
  // 已播放用实心主色，参照线用半透明主色。
  const activeColor = theme.isDark ? theme['c-font'] : theme['c-primary']
  const progressStr: `${number}%` = `${clamp01(progress) * 100}%`

  return (
    <View style={{ ...styles.progress, paddingTop }}>
      <View style={styles.progressInner}>
        <DefaultBar color={theme['c-primary-light-300-alpha-800']} />
        <BufferedBar progress={buffered} color={theme['c-primary-light-400-alpha-700']} />
        {draging ? (
          <>
            {/* 底层：音频当前真实位置（半透明参照线）——拖动时仍能看出「正在播放到哪里」 */}
            <View
              style={{
                ...styles.progressBar,
                backgroundColor: theme['c-primary-alpha-500'],
                width: progressStr,
                position: 'absolute',
                left: 0,
                top: 0,
              }}
            />
            {/* 上层：手指所在位置（实心高亮），后渲染所以永远压在参照线之上，
                左拖 / 右拖都能实时跟随手指，不会被更长的参照线盖住。 */}
            <View
              style={{
                ...styles.progressBar,
                backgroundColor: activeColor,
                width: `${clamp01(dragProgress) * 100}%`,
                position: 'absolute',
                left: 0,
                top: 0,
              }}
            />
          </>
        ) : (
          <View
            style={{
              ...styles.progressBar,
              backgroundColor: activeColor,
              width: progressStr,
              position: 'absolute',
              left: 0,
              top: 0,
            }}
          />
        )}
      </View>
      {seekEnabled ? (
        <ProgressTouchArea
          onDragState={onDragState}
          setDragProgress={setDragProgress}
          onSetProgress={onSetProgress}
          onPreview={onPreview}
        />
      ) : null}
    </View>
  )
}

const styles = createStyle({
  progress: {
    flex: 1,
    // 细线贴在信息行下沿，不与行内文字抢空间
    justifyContent: 'flex-end',
    zIndex: 1,
  },
  progressInner: {
    width: '100%',
    height: progressHeight,
    borderRadius: progressHeight / 2,
    // 必须裁剪：进度条按百分比宽度绘制，未裁剪时圆角端点会溢出轨道，
    // 进度越界（>1）时更会整条顶出容器。
    overflow: 'hidden',
  },
  progressBar: {
    height: progressHeight,
    borderRadius: progressHeight / 2,
  },
})

export default Progress
