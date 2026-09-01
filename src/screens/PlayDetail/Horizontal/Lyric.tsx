import { memo, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  View,
  FlatList,
  type FlatListProps,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type LayoutChangeEvent, TouchableOpacity,
  PanResponder,
} from 'react-native'
import { type Line, useLrcPlay, useLrcSet, findLineIndexByTime } from '@/plugins/lyric'
import { createStyle } from '@/utils/tools'
import { updateSetting } from '@/core/common'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { AnimatedColorText } from '@/components/common/Text'
import { setSpText } from '@/utils/pixelRatio'
import settingState from '@/store/setting/state'
import playerState from '@/store/player/state'
import { scrollTo } from '@/utils/scroll'
import { LyricScrollLayout } from '@/utils/lyricScroll'
import { audioClock } from '@/core/player/audioClock'

type FlatListType = FlatListProps<Line>

interface LineProps {
  line: Line
  lineNum: number
  activeLine: number
  onLayout: (lineNum: number, height: number, width: number, isPlayed: boolean, isActive: boolean) => void
  onPress: (index: number) => void;
}
const LrcLine = memo(
  ({ line, lineNum, activeLine, onLayout, onPress }: LineProps) => {
    const theme = useTheme()
    const lrcFontSize = useSettingValue('playDetail.horizontal.style.lrcFontSize')
    const textAlign = useSettingValue('playDetail.style.align')
    const isActive = activeLine == lineNum
    const isPlayed = lineNum < activeLine
    const size = lrcFontSize / 10
    const lineHeight = setSpText(size) * 1.3

    const colors = useMemo(() => {
      return isActive
        ? ([theme['c-primary'], theme['c-primary-alpha-200'], 1] as const)
        : ([theme['c-350'], theme['c-300'], 0.8] as const)
    }, [isActive, theme])

    const handleLayout = ({ nativeEvent }: LayoutChangeEvent) => {
      onLayout(lineNum, nativeEvent.layout.height, nativeEvent.layout.width, isPlayed, isActive)
    }
    const handlePress = useCallback(() => {
      onPress(lineNum);
    }, [onPress, lineNum]);
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={handlePress}>
        <View style={styles.line} onLayout={handleLayout}>
          <AnimatedColorText
            style={{
              ...styles.lineText,
              textAlign,
              lineHeight,
              fontWeight: isPlayed || isActive ? 'bold' : 'normal',
            }}
            textBreakStrategy="simple"
            color={colors[0]}
            opacity={colors[2]}
            size={size}
          >
            {line.text}
          </AnimatedColorText>
          {line.extendedLyrics.map((lrc, index) => {
            return (
              <AnimatedColorText
                style={{
                  ...styles.lineTranslationText,
                  textAlign,
                  lineHeight: lineHeight * 0.8,
                }}
                textBreakStrategy="simple"
                key={index}
                color={colors[1]}
                opacity={colors[2]}
                size={size * 0.8}
              >
                {lrc}
              </AnimatedColorText>
            )
          })}
        </View>
      </TouchableOpacity>
    )
  },
  (prevProps, nextProps) => {
    return (
      prevProps.line === nextProps.line &&
      prevProps.activeLine != nextProps.lineNum &&
      nextProps.activeLine != nextProps.lineNum &&
      prevProps.onPress === nextProps.onPress
    )
  }
)
const wait = async () => new Promise((resolve) => setTimeout(resolve, 100))

export default () => {
  const lyricLines = useLrcSet()
  const { line } = useLrcPlay()
  const flatListRef = useRef<FlatList>(null)
  const isPauseScrollRef = useRef(true)
  const scrollTimoutRef = useRef<NodeJS.Timeout | null>(null)
  const delayScrollTimeout = useRef<NodeJS.Timeout | null>(null)
  const lineRef = useRef({ line: 0, prevLine: 0 })
  const isFirstSetLrc = useRef(true)
  const scrollInfoRef = useRef<NativeSyntheticEvent<NativeScrollEvent>['nativeEvent'] | null>(null)
  // 缓存歌词行高与累计偏移，把滚动定位从 O(n²) 降到 O(1)。
  const lyricScrollLayoutRef = useRef(new LyricScrollLayout(54))
  const scrollCancelRef = useRef<(() => void) | null>(null)
  const isShowLyricProgressSetting = useSettingValue('playDetail.isShowLyricProgressSetting')
  // 拖动进度条 / 跳转 / 点击歌词期间强制立即定位，结束后（500ms）复位交由连续滚动循环驱动。
  const forceScrollRef = useRef(false)
  const forceScrollTimer = useRef<NodeJS.Timeout | null>(null)
  // 连续滚动循环记录上一帧精确时间，暂停/无推进时跳过，避免空转重复写 scrollToOffset。
  const lastContinuousTimeRef = useRef(-1)
  // 列表可视高度（onLayout 测量），连续滚动按此计算居中偏移。
  const listHeightRef = useRef(0)

  const initialDistanceRef = useRef(0)
  const initialFontSizeRef = useRef(0)

  const panResponder = useMemo(() => PanResponder.create({
    // 仅当两根手指同时按下时才接管手势（双指缩放歌词字号），
    // 用 gestureState.numberActiveTouches 判断，避免直接读 evt.nativeEvent.touches
    // （iOS 某些触摸事件下为 undefined，会抛 "Cannot read property 'length' of undefined" 导致崩溃）。
    onStartShouldSetPanResponder: (_, gestureState) => gestureState.numberActiveTouches === 2,
    onMoveShouldSetPanResponder: (_, gestureState) => gestureState.numberActiveTouches === 2,
    onPanResponderGrant: (evt) => {
      const touches = evt.nativeEvent.touches ?? evt.nativeEvent.changedTouches
      if (!touches || touches.length < 2) return
      const dx = touches[0].pageX - touches[1].pageX
      const dy = touches[0].pageY - touches[1].pageY
      initialDistanceRef.current = Math.sqrt(dx * dx + dy * dy)
      initialFontSizeRef.current = settingState.setting['playDetail.horizontal.style.lrcFontSize']
    },
    onPanResponderMove: (evt) => {
      const touches = evt.nativeEvent.touches ?? evt.nativeEvent.changedTouches
      if (!touches || touches.length < 2 || initialDistanceRef.current <= 0) return
      const dx = touches[0].pageX - touches[1].pageX
      const dy = touches[0].pageY - touches[1].pageY
      const distance = Math.sqrt(dx * dx + dy * dy)

      const scale = distance / initialDistanceRef.current
      let newSize = Math.round((initialFontSizeRef.current * scale) / 2) * 2
      newSize = Math.max(100, Math.min(newSize, 300))

      if (settingState.setting['playDetail.horizontal.style.lrcFontSize'] !== newSize) {
        updateSetting({ 'playDetail.horizontal.style.lrcFontSize': newSize })
      }
    },
    onPanResponderRelease: () => {
      initialDistanceRef.current = 0
    },
    onPanResponderTerminate: () => {
      initialDistanceRef.current = 0
    }
  }), [])

  // useLock()
  // const [imgUrl, setImgUrl] = useState(null)
  // const theme = useGetter('common', 'theme')
  // const { onLayout, ...layout } = useLayout()

  // useEffect(() => {
  //   const url = playMusicInfo ? playMusicInfo.musicInfo.img : null
  //   if (imgUrl == url) return
  //   setImgUrl(url)
  //
  // }, [playMusicInfo])

  // const imgWidth = useMemo(() => layout.width * 0.75, [layout.width])
  const handleScrollToActive = (index = lineRef.current.line) => {
    if (index < 0) return
    if (flatListRef.current) {
      if (scrollInfoRef.current && lineRef.current.line - lineRef.current.prevLine == 1) {
        // 使用缓存的累计偏移，避免长歌词列表每次滚动都从头累加行高（O(n)→O(1)）。
        const layout = lyricScrollLayoutRef.current
        const offset = layout.spaceHeight + layout.getCumulativeOffset(index) + layout.getLineHeight(index) / 2
        const targetOffset = offset - scrollInfoRef.current.layoutMeasurement.height * 0.5
        // 根据滚动距离动态计算动画时长：距离越远时间越长
        const distance = Math.abs(targetOffset - scrollInfoRef.current.contentOffset.y)
        const duration = Math.min(Math.max(distance * 0.5, 120), 300)
        try {
          scrollCancelRef.current = scrollTo(
            flatListRef.current,
            scrollInfoRef.current,
            targetOffset,
            duration,
            () => {
              scrollCancelRef.current = null
            }
          )
        } catch { }
      } else {
        if (scrollCancelRef.current) {
          scrollCancelRef.current()
          scrollCancelRef.current = null
        }
        try {
          flatListRef.current.scrollToIndex({
            index,
            animated: true,
            viewPosition: 0.5,
          })
        } catch { }
      }
    }
  }

  // 拖拽 / 跳转 / 点击歌词期间强制立即定位；keep=true（长拖拽）保持 force，
  // 否则 500ms 后自动复位，交还给每帧连续滚动循环驱动平滑上移。
  const setForceScroll = (value: boolean, keep = false) => {
    forceScrollRef.current = value
    if (forceScrollTimer.current) {
      clearTimeout(forceScrollTimer.current)
      forceScrollTimer.current = null
    }
    if (value && !keep) {
      forceScrollTimer.current = setTimeout(() => {
        forceScrollRef.current = false
        forceScrollTimer.current = null
      }, 500)
    }
  }

  // 连续平滑滚动：基于外推时钟的精确播放时间，在当前行与下一行「居中偏移」之间线性插值，
  // 让歌词随演唱连续上移（卡拉OK 式），取代原来「每行到来才 scrollToIndex 跳变」的观感。
  // 行级高亮着色仍由 useLrcPlay 的 line 驱动；本函数只负责位置连续（每帧基于精确时间计算）。
  const scrollToActiveContinuous = () => {
    const t = audioClock.getTime() * 1000 // ms
    if (t === lastContinuousTimeRef.current) return // 暂停/无推进时跳过
    lastContinuousTimeRef.current = t
    if (!flatListRef.current || !lyricLines.length) return
    const listHeight = listHeightRef.current || scrollInfoRef.current?.layoutMeasurement.height || 0
    if (listHeight <= 0) return
    const layout = lyricScrollLayoutRef.current
    let i = findLineIndexByTime(lyricLines, t)
    if (i < 0) i = 0
    // 横屏「当前行之前」全为已播放（bold）行，累计偏移统一用 bold 档，避免高亮行持续偏低。
    const offset = layout.getContinuousOffset(i, lyricLines, t, listHeight, 0.5, 0, layout.spaceHeight, true)
    try {
      flatListRef.current.scrollToOffset({ offset, animated: false })
    } catch { }
  }

  const handleScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollInfoRef.current = nativeEvent
  }
  const handleScrollBeginDrag = () => {
    isPauseScrollRef.current = true
    if (delayScrollTimeout.current) {
      clearTimeout(delayScrollTimeout.current)
      delayScrollTimeout.current = null
    }
    if (scrollTimoutRef.current) {
      clearTimeout(scrollTimoutRef.current)
      scrollTimoutRef.current = null
    }
    if (scrollCancelRef.current) {
      scrollCancelRef.current()
      scrollCancelRef.current = null
    }
  }

  const onScrollEndDrag = () => {
    if (!isPauseScrollRef.current) return
    if (scrollTimoutRef.current) clearTimeout(scrollTimoutRef.current)
    scrollTimoutRef.current = setTimeout(() => {
      scrollTimoutRef.current = null
      isPauseScrollRef.current = false
      if (!playerState.isPlay) return
      handleScrollToActive()
    }, 3000)
  }

  useEffect(() => {
    return () => {
      if (delayScrollTimeout.current) {
        clearTimeout(delayScrollTimeout.current)
        delayScrollTimeout.current = null
      }
      if (scrollTimoutRef.current) {
        clearTimeout(scrollTimoutRef.current)
        scrollTimoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    // linesRef.current = lyricLines
    lyricScrollLayoutRef.current.reset()
    lineRef.current.prevLine = 0
    lineRef.current.line = 0
    if (!flatListRef.current) return
    flatListRef.current.scrollToOffset({
      offset: 0,
      animated: false,
    })
    if (!lyricLines.length) return
    requestAnimationFrame(() => {
      if (isFirstSetLrc.current) {
        isFirstSetLrc.current = false
        setTimeout(() => {
          isPauseScrollRef.current = false
          handleScrollToActive()
        }, 100)
      } else {
        if (delayScrollTimeout.current) clearTimeout(delayScrollTimeout.current)
        delayScrollTimeout.current = setTimeout(() => {
          handleScrollToActive(0)
        }, 100)
      }
    })
  }, [lyricLines])

  useEffect(() => {
    if (line < 0) return
    lineRef.current.prevLine = lineRef.current.line
    lineRef.current.line = line
    if (!flatListRef.current || isPauseScrollRef.current) return

    // 拖动进度条 / 跳转 / 点击歌词（force）期间立即定位；普通播放推进交给每帧连续
    // 滚动循环（scrollToActiveContinuous），实现平滑上移而非逐行跳变。
    if (forceScrollRef.current) {
      handleScrollToActive()
    }
  }, [line])

  // 每帧连续平滑滚动循环：歌词页激活且非用户手动滚动、非强制定位时，基于外推时钟精确时间驱动歌词连续上移。
  // iOS 后台 / 锁屏时 rAF 暂停（歌词停滚无妨）；前台播放每帧（~16ms）定位，消除原来的行级跳变。
  useEffect(() => {
    let rafId = 0
    const loop = () => {
      if (!isPauseScrollRef.current && !forceScrollRef.current && flatListRef.current && lyricLines.length) {
        scrollToActiveContinuous()
      }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [lyricLines])

  // 拖动进度条 / 跳转 / 恢复播放等用户动作期间强制让歌词列表立即滚动到高亮行，
  // 保证高亮行与进度条（及音频）绝对同步，结束后回归连续滚动。
  useEffect(() => {
    const handleDragState = (dragging: boolean) => {
      if (dragging) setForceScroll(true, true)
      else {
        if (forceScrollTimer.current) clearTimeout(forceScrollTimer.current)
        forceScrollTimer.current = setTimeout(() => {
          forceScrollRef.current = false
          forceScrollTimer.current = null
        }, 500)
      }
    }
    const handleSetProgress = () => setForceScroll(true)
    const handlePlay = () => setForceScroll(true)
    global.app_event.on('progressDragState', handleDragState)
    global.app_event.on('setProgress', handleSetProgress)
    global.app_event.on('play', handlePlay)
    return () => {
      global.app_event.off('progressDragState', handleDragState)
      global.app_event.off('setProgress', handleSetProgress)
      global.app_event.off('play', handlePlay)
    }
  }, [])

  const handleScrollToIndexFailed: FlatListType['onScrollToIndexFailed'] = (info) => {
    void wait().then(() => {
      handleScrollToActive(info.index)
    })
  }

  const handleLineLayout = useCallback<LineProps['onLayout']>((lineNum, height, _width, isPlayed, isActive) => {
    lyricScrollLayoutRef.current.updateLineHeight(
      lineNum,
      height,
      !!(lyricLines[lineNum]?.extendedLyrics?.length),
      isActive,
      isPlayed,
    )
  }, [lyricLines])

  const handleSpaceLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    lyricScrollLayoutRef.current.setSpaceHeight(nativeEvent.layout.height)
  }, [])

  // 测量列表可视高度，供连续滚动计算居中偏移（首帧滚动前即可拿到真实高度）。
  const handleListLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    listHeightRef.current = nativeEvent.layout.height
  }, [])

  const handleLinePress = useCallback((index: number) => {
    if (!isShowLyricProgressSetting) return;
    if (scrollTimoutRef.current) {
      clearTimeout(scrollTimoutRef.current);
      scrollTimoutRef.current = null;
    }
    if (scrollCancelRef.current) {
      scrollCancelRef.current();
      scrollCancelRef.current = null;
    }
    isPauseScrollRef.current = false;
    // 点击歌词视为用户主动跳转：强制立即定位，越过连续滚动循环，使高亮行与音频绝对同步。
    setForceScroll(true);
    const line = lyricLines[index];
    if (line) {
      global.app_event.setProgress(line.time / 1000);
    }

    handleScrollToActive(index);
  }, [isShowLyricProgressSetting, lyricLines]);

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => {
    return <LrcLine line={item} lineNum={index} activeLine={line} onLayout={handleLineLayout} onPress={handleLinePress} />;
  }
  const getkey: FlatListType['keyExtractor'] = (item, index) => `${index}${item.text}`

  const spaceComponent = useMemo(
    () => <View style={styles.space} onLayout={handleSpaceLayout}></View>,
    [handleSpaceLayout]
  )

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <FlatList
        data={lyricLines}
        renderItem={renderItem}
        keyExtractor={getkey}
        style={{ flex: 1 }}
        ref={flatListRef}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={spaceComponent}
        ListFooterComponent={spaceComponent}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        fadingEdgeLength={100}
        initialNumToRender={Math.max(line + 20, 20)}
        windowSize={15}
        maxToRenderPerBatch={20}
        updateCellsBatchingPeriod={50}
        scrollEventThrottle={16}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        onScroll={handleScroll}
        onLayout={handleListLayout}
      />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
    paddingLeft: 20,
    paddingRight: 20,
  },
  space: {
    paddingTop: '100%',
  },
  line: {
    paddingTop: 10,
    paddingBottom: 10,
  },
  lineText: {
    textAlign: 'center',
  },
  lineTranslationText: {
    textAlign: 'center',
    paddingTop: 5,
  },
})
