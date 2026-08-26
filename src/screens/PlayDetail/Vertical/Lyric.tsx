import { memo, useMemo, useEffect, useRef, useCallback, useState } from 'react'
import {
  View,
  FlatList,
  type FlatListProps,
  type LayoutChangeEvent,
  TouchableOpacity,
  PanResponder,
} from 'react-native'
// import { useLayout } from '@/utils/hooks'
import { type Line, useLrcPlay, useLrcSet, play as lrcPlay } from '@/plugins/lyric'
import { createStyle } from '@/utils/tools'
import { updateSetting } from '@/core/common'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { AnimatedColorText } from '@/components/common/Text'
import { setSpText } from '@/utils/pixelRatio'
import settingState from '@/store/setting/state'
import playerState from '@/store/player/state'
import { useWindowSize } from '@/utils/hooks'
// import { screenkeepAwake } from '@/utils/nativeModules/utils'
// import { log } from '@/utils/log'
// import { toast } from '@/utils/tools'

type FlatListType = FlatListProps<Line>

// const useLock = () => {
//   const showCommentRef = useRef(false)

//   useEffect(() => {
//     let appstateListener = AppState.addEventListener('change', (state) => {
//       switch (state) {
//         case 'active':
//           if (showLyricRef.current && !showCommentRef.current) screenkeepAwake()
//           break
//         case 'background':
//           screenUnkeepAwake()
//           break
//       }
//     })
//     return () => {
//       appstateListener.remove()
//     }
//   }, [])
//   useEffect(() => {
//     let listener: ReturnType<typeof onNavigationComponentDidDisappearEvent>
//     showCommentRef.current = !!componentIds.comment
//     if (showCommentRef.current) {
//       if (showLyricRef.current) screenUnkeepAwake()
//       listener = onNavigationComponentDidDisappearEvent(componentIds.comment as string, () => {
//         if (showLyricRef.current && AppState.currentState == 'active') screenkeepAwake()
//       })
//     }

//     const rm = global.state_event.on('componentIdsUpdated', (ids) => {

//     })

//     return () => {
//       if (listener) listener.remove()
//     }
//   }, [])
// }

interface LineProps {
  line: Line
  lineNum: number
  activeLine: number
  onLayout: (lineNum: number, height: number, width: number) => void
  onPress: (index: number) => void;
  isSmallWindow?: boolean;
}
const LrcLine = memo(
  ({ line, lineNum, activeLine, onLayout, onPress, isSmallWindow }: LineProps) => {
    const theme = useTheme()
    const lrcFontSize = useSettingValue('playDetail.vertical.style.lrcFontSize')
    const textAlign = useSettingValue('playDetail.style.align')
    const isActive = activeLine == lineNum
    const isPlayed = lineNum < activeLine
    const size = lrcFontSize / 10
    const lineHeight = setSpText(size) * 1.3

    const colors = useMemo(() => {
      return isActive
        ? ([theme.isDark ? theme['c-font'] : theme['c-primary-font-active'], theme['c-primary-alpha-200'], 1] as const)
        : ([theme['c-450'], theme['c-400'], 0.8] as const)
    }, [isActive, theme])

    const handleLayout = ({ nativeEvent }: LayoutChangeEvent) => {
      onLayout(lineNum, nativeEvent.layout.height, nativeEvent.layout.width)
    }

    const handlePress = useCallback(() => {
      onPress(lineNum);
    }, [onPress, lineNum]);

    return (
      <TouchableOpacity activeOpacity={0.7} onPress={handlePress}>
        <View style={[styles.line, isSmallWindow && { paddingTop: 6, paddingBottom: 6 }]} onLayout={handleLayout}>
          <AnimatedColorText
            style={{
              ...styles.lineText,
              textAlign,
              lineHeight,
              fontWeight: isActive ? '700' : '400',
            }}
            textBreakStrategy="simple"
            color={colors[0]}
            opacity={colors[2]}
            size={isActive ? size + 3 : size}
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
                  ...(isSmallWindow && { paddingTop: 2 }),
                }}
                textBreakStrategy="simple"
                key={index}
                color={colors[1]}
                opacity={colors[2]}
                size={isActive ? size * 0.8 + 2 : size * 0.8}
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

export default ({ active = true }: { active?: boolean }) => {
  const lyricLines = useLrcSet()
  const { line } = useLrcPlay()
  const { height: winHeight } = useWindowSize()
  const isSmallWindow = winHeight < 700
  // 歌词页实际可用高度由父容器（PagerView 子页面）的 onLayout 给出，
  // 不再用 winHeight - HEADER_HEIGHT 估算：后者未扣除状态栏高和底部 Player
  // 控制区高，导致 FlatList 被撑得比歌词页还大，下方被 PagerView 裁剪或顶上去。
  const [pageHeight, setPageHeight] = useState(winHeight > 0 ? Math.max(0, winHeight - 180) : 0)
  const flatListRef = useRef<FlatList>(null)
  const isPauseScrollRef = useRef(true)
  const scrollTimoutRef = useRef<NodeJS.Timeout | null>(null)
  const delayScrollTimeout = useRef<NodeJS.Timeout | null>(null)
  const lineRef = useRef({ line: 0, prevLine: 0 })
  const isFirstSetLrc = useRef(true)
  const listLayoutInfoRef = useRef<{ lineHeights: number[] }>({
    lineHeights: [],
  })
  const scrollCancelRef = useRef<(() => void) | null>(null)
  const isShowLyricProgressSetting = settingState.setting['playDetail.isShowLyricProgressSetting']

  const initialDistanceRef = useRef(0)
  const initialFontSizeRef = useRef(0)

  const panResponder = useMemo(() => PanResponder.create({
    // 仅当两根手指同时按下时才接管手势（双指缩放歌词字号），
    // 单指留给 FlatList 自身做垂直滚动。用 gestureState.numberActiveTouches
    // 判断，避免直接读 evt.nativeEvent.touches（iOS 某些触摸事件下为 undefined，
    // 会抛 “Cannot read property 'length' of undefined” 导致整个歌词界面崩溃）。
    onStartShouldSetPanResponder: (_, gestureState) => gestureState.numberActiveTouches === 2,
    onMoveShouldSetPanResponder: (_, gestureState) => gestureState.numberActiveTouches === 2,
    onPanResponderGrant: (evt) => {
      const touches = evt.nativeEvent.touches ?? evt.nativeEvent.changedTouches
      if (!touches || touches.length < 2) return
      const dx = touches[0].pageX - touches[1].pageX
      const dy = touches[0].pageY - touches[1].pageY
      initialDistanceRef.current = Math.sqrt(dx * dx + dy * dy)
      initialFontSizeRef.current = settingState.setting['playDetail.vertical.style.lrcFontSize']
    },
    onPanResponderMove: (evt) => {
      const touches = evt.nativeEvent.touches ?? evt.nativeEvent.changedTouches
      if (!touches || touches.length < 2 || initialDistanceRef.current <= 0) return
      const dx = touches[0].pageX - touches[1].pageX
      const dy = touches[0].pageY - touches[1].pageY
      const distance = Math.sqrt(dx * dx + dy * dy)

      const scale = distance / initialDistanceRef.current
      let newSize = Math.round((initialFontSizeRef.current * scale) / 2) * 2
      newSize = Math.max(100, Math.min(newSize, 300)) // ensure within bounds

      if (settingState.setting['playDetail.vertical.style.lrcFontSize'] !== newSize) {
        updateSetting({ 'playDetail.vertical.style.lrcFontSize': newSize })
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
      if (scrollCancelRef.current) {
        scrollCancelRef.current()
        scrollCancelRef.current = null
      }
      try {
        flatListRef.current.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.42,
        })
      } catch { }
    }
  }
  const handleScrollBeginDrag = () => {
    isPauseScrollRef.current = true
    // playLineRef.current?.setVisible(true)
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
      // playLineRef.current?.setVisible(false)
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
    listLayoutInfoRef.current.lineHeights = []
    lineRef.current.prevLine = 0
    lineRef.current.line = 0
    if (!flatListRef.current) return
    flatListRef.current.scrollToOffset({
      offset: 0,
      animated: false,
    })
    if (!lyricLines.length) return
    // playLineRef.current?.updateLyricLines(lyricLines)
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

    // 非歌词页（封面页）时，歌词时钟仍在推进，但不在后台驱动 FlatList 滚动，
    // 避免 PagerView 横向滑页时与歌词的逐秒 scrollToIndex 抢帧导致卡顿。
    if (!active) return

    handleScrollToActive()
  }, [line, active])

  // 从封面页切回歌词页时，立即把当前行定位到 42% 位置
  useEffect(() => {
    if (active) handleScrollToActive()
  }, [active])

  // useEffect(() => {
  //   requestAnimationFrame(() => {
  //     playLineRef.current?.updateLayoutInfo(listLayoutInfoRef.current)
  //     playLineRef.current?.updateLyricLines(lyricLines)
  //   })
  // }, [isShowLyricProgressSetting])

  const handleScrollToIndexFailed: FlatListType['onScrollToIndexFailed'] = (info) => {
    void wait().then(() => {
      handleScrollToActive(info.index)
    })
  }

  const handleLineLayout = useCallback<LineProps['onLayout']>((lineNum, height) => {
    listLayoutInfoRef.current.lineHeights[lineNum] = height
    // playLineRef.current?.updateLayoutInfo(listLayoutInfoRef.current)
  }, [])

  const getItemLayout = useCallback<NonNullable<FlatListType['getItemLayout']>>((data, index) => {
    const height = listLayoutInfoRef.current.lineHeights[index]
    if (height == null) {
      // 尚未测量到高度时给估算值，避免 scrollToIndex 失败/抖动
      return { length: isSmallWindow ? 40 : 54, offset: (isSmallWindow ? 40 : 54) * index, index }
    }
    let offset = 0
    for (let i = 0; i < index; i++) {
      offset += listLayoutInfoRef.current.lineHeights[i] ?? (isSmallWindow ? 40 : 54)
    }
    return { length: height, offset, index }
  }, [isSmallWindow])

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
    const line = lyricLines[index];
    if (line) {
      // 同步重锚歌词时钟，使高亮行立即跟随点击位置（不依赖 app_event 的异步派发，
      // 否则在 iOS 上高亮会滞后/不跟随音频跳转）
      try { lrcPlay(line.time) } catch {}
      global.app_event.setProgress(line.time / 1000);
    }
    handleScrollToActive(index);
  }, [isShowLyricProgressSetting, lyricLines]);

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => {
    return <LrcLine line={item} lineNum={index} activeLine={line} onLayout={handleLineLayout} onPress={handleLinePress} isSmallWindow={isSmallWindow} />;
  };
  const getkey: FlatListType['keyExtractor'] = (item, index) => `${index}${item.text}`

  const handlePageLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    const h = Math.round(nativeEvent.layout.height)
    if (h > 0 && h !== pageHeight) setPageHeight(h)
  }, [pageHeight])

  return (
    <View style={{ flex: 1, width: '100%' }} onLayout={handlePageLayout} collapsable={false}>
      <FlatList
        data={lyricLines}
        renderItem={renderItem}
        keyExtractor={getkey}
        style={{ height: pageHeight, width: '100%' }}
        // 歌词整体居中且占满全屏：内容不足时垂直居中（无“下方大片空白”），
        // 内容超长时自动撑满并正常滚动，当前行由 scrollToIndex 定位到 42%。
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: isSmallWindow ? 12 : 20,
        }}
        ref={flatListRef}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        initialNumToRender={20}
        windowSize={5}
        maxToRenderPerBatch={12}
        updateCellsBatchingPeriod={100}
        getItemLayout={getItemLayout}
        extraData={line}
        removeClippedSubviews={true}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        {...panResponder.panHandlers}
      />
    </View>
  )
}

const styles = createStyle({
  line: {
    paddingTop: 10,
    paddingBottom: 10,
    // opacity: 0,
  },
  lineText: {
    textAlign: 'center',
    // fontSize: 16,
    // lineHeight: 20,
    // paddingTop: 5,
    // paddingBottom: 5,
    // opacity: 0,
  },
  lineTranslationText: {
    textAlign: 'center',
    // fontSize: 13,
    // lineHeight: 17,
    paddingTop: 5,
    // paddingBottom: 5,
  },
})
