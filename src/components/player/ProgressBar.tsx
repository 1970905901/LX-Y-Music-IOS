import { memo, useMemo } from 'react'
import { Animated, View } from 'react-native'

import { ProgressTouchArea, useProgressDrag } from './progressCore'
import { clamp01, createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'

const progressContentPadding = 6
const progressHeight = 7
const progressContentHeight = progressContentPadding * 2 + progressHeight

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
}: {
  progress: number
  duration: number
  buffered: number
}) => {
  const theme = useTheme()
  const {
    seekEnabled,
    draging,
    dragProgressAnim,
    onDragState,
    setDragProgress,
    onSetProgress,
    onPreview,
  } = useProgressDrag(progress, duration)

  const activeColor = theme.isDark ? theme['c-font'] : theme['c-primary']
  const progressStr: `${number}%` = `${clamp01(progress) * 100}%`
  // 手指层宽度由 Animated 直驱（拖动移动零 React 渲染），实时跟随手指
  const dragWidth = useMemo(
    () => dragProgressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
    [dragProgressAnim],
  )

  return (
    <View style={styles.progress}>
      <View style={styles.progressInner}>
        <DefaultBar color={theme['c-primary-light-300-alpha-800']} />
        <BufferedBar progress={buffered} color={theme['c-primary-light-400-alpha-700']} />
        {draging ? (
          <>
            {/* 参考项目：拖动时同时显示当前真实进度（底层浅色参照）和手指拖动进度（顶层高亮） */}
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
            <Animated.View
              style={{
                ...styles.progressBar,
                backgroundColor: activeColor,
                width: dragWidth,
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
    width: '100%',
    height: progressContentHeight,
    paddingTop: progressContentPadding,
    paddingBottom: progressContentPadding,
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
