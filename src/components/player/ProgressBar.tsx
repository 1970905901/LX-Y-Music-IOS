import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, PanResponder } from 'react-native'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { scaleSizeW, scaleSizeH } from '@/utils/pixelRatio'
import { useDrag } from '@/utils/hooks'
import { Icon } from '@/components/common/Icon'
import { setPagerScrollEnabled } from '@/utils/pagerScrollControl'
// import { AppColors } from '@/theme'

const DefaultBar = memo(() => {
  const theme = useTheme()

  return (
    <View
      style={{
        ...styles.progressBar,
        backgroundColor: theme['c-primary-light-300-alpha-800'],
        position: 'absolute',
        width: '100%',
        left: 0,
        top: 0,
      }}
    ></View>
  )
})

const BufferedBar = memo(({ progress }: { progress: number }) => {
  // console.log(bufferedProgress)
  const theme = useTheme()
  return (
    <View
      style={{
        ...styles.progressBar,
        backgroundColor: theme['c-primary-light-400-alpha-700'],
        position: 'absolute',
        width: `${progress * 100}%`,
        left: 0,
        top: 0,
      }}
    ></View>
  )
})

const PreassBar = memo(
  ({
    onDragState,
    setDragProgress,
    onSetProgress,
    onPreview,
  }: {
    onDragState: (drag: boolean) => void
    setDragProgress: (progress: number) => void
    onSetProgress: (progress: number) => void
    onPreview?: (progress: number) => void
  }) => {
    const { onLayout, onDragStart, onDragEnd, onDrag } = useDrag(
      onSetProgress,
      onDragState,
      setDragProgress,
      onPreview
    )
    // const handlePress = useCallback((event: GestureResponderEvent) => {
    //   onPress(event.nativeEvent.locationX)
    // }, [onPress])

    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponderCapture: (evt, gestureState) => true,
        onMoveShouldSetPanResponderCapture: (evt, gestureState) => true,

        // onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (evt, gestureState) => {
          onDrag(gestureState.dx)
        },
        onPanResponderGrant: (evt, gestureState) => {
          // 拖动进度条期间同步禁用 PagerView 原生横滑（直接 setNativeProps，绕过 state 异步），
          // 避免原生分页控件在左拖时抢占横向手势导致卡顿 / 误切歌词页
          setPagerScrollEnabled(false)
          try { (global.app_event as unknown as { emit: (type: string, ...args: any[]) => void }).emit('progressDragState', true) } catch {}
          onDragStart(gestureState.dx, evt.nativeEvent.locationX)
        },
        onPanResponderRelease: () => {
          setPagerScrollEnabled(true)
          try { (global.app_event as unknown as { emit: (type: string, ...args: any[]) => void }).emit('progressDragState', false) } catch {}
          onDragEnd()
        },
        onPanResponderTerminate: () => {
          setPagerScrollEnabled(true)
          try { (global.app_event as unknown as { emit: (type: string, ...args: any[]) => void }).emit('progressDragState', false) } catch {}
          onDragEnd()
        },
        // 关键修复：拒绝被父级（播放页纵向滑动切歌）手势抢占。
        // 否则拖动进度条时父级 onMoveShouldSetPanResponderCapture 会夺走手势，
        // 导致 onDragEnd 不触发、onSetProgress(seek) 被丢弃，进度条拖动不跳转。
        onPanResponderTerminationRequest: () => false,
      })
    ).current

    return <View onLayout={onLayout} style={styles.pressBar} {...panResponder.panHandlers} />
  }
)

const Progress = ({
  progress,
  duration,
  buffered,
}: {
  progress: number
  duration: number
  buffered: number
}) => {
  // const { progress: bufferProgress } = usePlayTimeBuffer()
  const theme = useTheme()
  const [draging, setDraging] = useState(false)
  const [dragProgress, setDragProgress] = useState(0)
  // console.log(progress)
  const progressStr: `${number}%` = `${progress * 100}%`

  const durationRef = useRef(duration)
  useEffect(() => {
    durationRef.current = duration
  }, [duration])
  const onSetProgress = useCallback((progress: number) => {
    global.app_event.setProgress(progress * durationRef.current)
  }, [])
  // bug③: 拖动中实时把歌词时钟重锚到手指位置（毫秒），不 seek 音频，避免卡顿与高亮行错位
  const onPreview = useCallback((progress: number) => {
    global.app_event.progressDragPreview(progress * durationRef.current * 1000)
  }, [])
  const activeColor = theme.isDark ? theme['c-font'] : theme['c-primary'];
  return (
    <View style={styles.progress}>
      <View style={styles.progressInner}>
        <DefaultBar />
        <BufferedBar progress={buffered} />
        {draging ? (
          // 拖动期间只渲染拖动进度条：
          // 左右拖动时进度条都会实时跟随手指；
          // 若同时显示当前进度条，左拖时拖动条会被更长的当前进度条覆盖，
          // 表现为“直接跳到位置、没有动效”。
          <View
            style={{
              ...styles.progressBar,
              backgroundColor: activeColor,
              width: `${dragProgress * 100}%`,
              position: 'absolute',
              left: 0,
              top: 0,
            }}
          />
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
      <PreassBar
        onDragState={setDraging}
        setDragProgress={setDragProgress}
        onSetProgress={onSetProgress}
        onPreview={onPreview}
      />
    </View>
  )
}

const progressContentPadding = 6
const progressHeight = 7
const progressContentHeight = progressContentPadding * 2 + progressHeight
const progressHeightSize = scaleSizeH(progressHeight)
let progressDotSize = scaleSizeW(progressContentHeight * 0.8)
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
    overflow: 'hidden',
  },
  progressBar: {
    height: progressHeight,
    borderRadius: progressHeight / 2,
  },
  pressBar: {
    position: 'absolute',
    // backgroundColor: 'rgba(0,0,0,0.5)',
    left: 0,
    top: 0,
    height: progressContentHeight,
    paddingTop: progressContentPadding,
    paddingBottom: progressContentPadding,
    width: '100%',
    zIndex: 6,
  },
})

export default Progress
