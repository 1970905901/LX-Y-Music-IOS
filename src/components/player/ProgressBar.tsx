import { memo, useCallback, useMemo, useState } from 'react'
import { Animated, View, type LayoutChangeEvent } from 'react-native'

import { ProgressTouchArea, useProgressDrag, useSmoothProgressAnim } from './progressCore'
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
  } = useProgressDrag(progress, duration)

  const activeColor = theme.isDark ? theme['c-font'] : theme['c-primary']
  // 非拖动进度条：对齐上游——播放 tick 直接落位（无过渡），仅跳变 >2s（seek /
  // 后台恢复大跳 / 切歌归零）这一次变更挂 180ms 标准曲线过渡（见 useSmoothProgressAnim）。
  // 位移像素由 onLayout 实测容器宽度换算（百分比 transform 原生动画不可靠）。
  const smoothValue = useSmoothProgressAnim(progress, duration)
  const [barWidth, setBarWidth] = useState(0)
  const handleInnerLayout = useCallback(
    (e: LayoutChangeEvent) => { setBarWidth(e.nativeEvent.layout.width) },
    [],
  )
  const smoothTranslate = useMemo(
    () => smoothValue.interpolate({
      inputRange: [0, 1],
      outputRange: [-barWidth, 0],
      extrapolate: 'clamp',
    }),
    [smoothValue, barWidth],
  )
  // 手指层宽度由 Animated 直驱（拖动移动零 React 渲染），实时跟随手指
  const dragWidth = useMemo(
    () => dragProgressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
    [dragProgressAnim],
  )

  return (
    <View style={styles.progress}>
      <View style={styles.progressInner} onLayout={handleInnerLayout}>
        <DefaultBar color={theme['c-primary-light-300-alpha-800']} />
        <BufferedBar progress={buffered} color={theme['c-primary-light-400-alpha-700']} />
        {draging ? (
          <>
            {/* 参考项目：拖动时同时显示当前真实进度（底层浅色参照）和手指拖动进度（顶层高亮）。
                真实进度同样走 translateX 平滑补间，与两态共用同一运动表达 */}
            <Animated.View
              style={{
                ...styles.progressBar,
                backgroundColor: theme['c-primary-alpha-500'],
                width: '100%',
                position: 'absolute',
                left: 0,
                top: 0,
                transform: [{ translateX: smoothTranslate }],
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
          <Animated.View
            style={{
              ...styles.progressBar,
              backgroundColor: activeColor,
              width: '100%',
              position: 'absolute',
              left: 0,
              top: 0,
              transform: [{ translateX: smoothTranslate }],
            }}
          />
        )}
      </View>
      {seekEnabled ? (
        <ProgressTouchArea
          onDragState={onDragState}
          setDragProgress={setDragProgress}
          onSetProgress={onSetProgress}
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
