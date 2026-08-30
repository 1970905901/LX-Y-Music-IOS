import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, View, PanResponder } from 'react-native'
import { useDrag } from '@/utils/hooks'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
// import { scaleSizeW } from '@/utils/pixelRatio'
// import { AppColors } from '@/theme'

const DefaultBar = memo(() => {
  // const theme = useTheme()

  return (
    <View
      style={{
        ...styles.progressBar,
        // backgroundColor: theme['c-primary-light-200-alpha-900'],
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
        backgroundColor: theme['c-primary-light-600-alpha-900'],
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
          // console.log(evt.nativeEvent.locationX, gestureState)
          onDragStart(gestureState.dx, evt.nativeEvent.locationX)
        },
        onPanResponderRelease: () => {
          onDragEnd()
        },
        // onPanResponderTerminate: (evt, gestureState) => {
        //   onDragEnd()
        // },
      })
    ).current

    return <View onLayout={onLayout} style={styles.pressBar} {...panResponder.panHandlers} />
  }
)

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
  // const { progress } = usePlayTimeBuffer()
  const theme = useTheme()
  const [draging, setDraging] = useState(false)
  const [dragProgress, setDragProgress] = useState(0)
  // console.log(progress)
  // 播放中 playProgressChanged 约每 1s 触发一次，进度条原本是秒级跳变。
  // 非拖动时用 Animated 在两次更新之间做线性补间，让进度条连续平滑滑动。
  const animProgress = useRef(new Animated.Value(progress)).current
  const lastUpdateTimeRef = useRef(0)
  const wasDragingRef = useRef(false)
  useEffect(() => {
    if (draging) {
      wasDragingRef.current = true
      return
    }
    const target = progress
    const current = (animProgress as any).__getValue()
    // 拖动刚结束：把补间值立即对齐到释放位置，避免「从拖动前旧值缓慢追到目标」
    // 造成的进度条回退 + 慢动画（表现为手动滑动进度条动画太慢）。
    if (wasDragingRef.current) {
      wasDragingRef.current = false
      animProgress.setValue(target)
      lastUpdateTimeRef.current = 0
      return
    }
    const now = Date.now()
    const dt = lastUpdateTimeRef.current ? now - lastUpdateTimeRef.current : 1000
    lastUpdateTimeRef.current = now
    // 切歌 / 后退 seek 等进度回退时直接跳到目标，避免反向补间
    if (target < current - 1e-6) {
      animProgress.setValue(target)
      return
    }
    const anim = Animated.timing(animProgress, {
      toValue: target,
      duration: Math.min(Math.max(dt, 250), 1500),
      easing: Easing.linear,
      useNativeDriver: false,
    })
    anim.start()
    return () => anim.stop()
  }, [progress, draging, animProgress])

  const durationRef = useRef(duration)
  useEffect(() => {
    durationRef.current = duration
  }, [duration])
  const onSetProgress = useCallback((progress: number) => {
    global.app_event.setProgress(progress * durationRef.current)
  }, [])
  // bug③: 拖动中实时把歌词时钟重锚到手指位置（毫秒），不 seek 音频，避免高亮行错位
  const onPreview = useCallback((progress: number) => {
    global.app_event.progressDragPreview(progress * durationRef.current * 1000)
  }, [])

  return (
    <View style={{ ...styles.progress, paddingTop }}>
      <View style={{ flex: 1 }}>
        <DefaultBar />
        <BufferedBar progress={buffered} />
        {draging ? (
          <>
            <View
              style={{
                ...styles.progressBar,
                backgroundColor: theme['c-primary-light-200-alpha-900'],
                width: `${progress * 100}%`,
                position: 'absolute',
                left: 0,
                top: 0,
              }}
            />
            <View
              style={{
                ...styles.progressBar,
                backgroundColor: theme['c-primary-light-100-alpha-800'],
                width: `${dragProgress * 100}%`,
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
              backgroundColor: theme['c-primary-alpha-900'],
              width: animProgress.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
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
      {/* <View style={{ ...styles.progressBar, height: '100%', width: progressStr }}><Pressable style={styles.progressDot}></Pressable></View> */}
    </View>
  )
}

// const progressContentPadding = 9
// const progressHeight = 3
const styles = createStyle({
  progress: {
    flex: 1,
    // backgroundColor: 'rgba(0,0,0,0.2)',
    zIndex: 1,
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  pressBar: {
    position: 'absolute',
    // backgroundColor: 'rgba(0,0,0,0.5)',
    left: 0,
    top: 0,
    // height: progressContentPadding * 2 + progressHeight,
    height: '100%',
    width: '100%',
  },
})

export default Progress
