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
import { type Line, useLrcPlay, useLrcSet, syncToTime as lrcSyncToTime } from '@/plugins/lyric'
import { getPosition } from '@/plugins/player'
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

export default ({ active = true, pagerHeight = 0 }: { active?: boolean; pagerHeight?: number }) => {
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
  // 记录上一帧的 active，用于检测“从封面页切回歌词页”的上升沿，
  // 上升沿这一次强制走 force 路径，避免被 [line, active] effect 的“舒适区动画滚动”抢先。
  const activeRef = useRef(active)
  const isFirstSetLrc = useRef(true)
  const listLayoutInfoRef = useRef<{ lineHeights: number[] }>({
    lineHeights: [],
  })
  const scrollCancelRef = useRef<(() => void) | null>(null)
  const scrollYRef = useRef(0)
  const isShowLyricProgressSetting = settingState.setting['playDetail.isShowLyricProgressSetting']

  // 用户动作（拖动进度条 / 跳转 / 恢复播放）期间强制让歌词列表立即滚动到高亮行，
  // 使高亮行与进度条（及音频）绝对同步；被动逐秒重锚时仍用舒适区节流，避免逐行微滚动卡顿。
  const forceScrollRef = useRef(false)
  const forceScrollTimer = useRef<NodeJS.Timeout | null>(null)
  const setForceScroll = useCallback((on: boolean, persist = false) => {
    forceScrollRef.current = on
    if (forceScrollTimer.current) {
      clearTimeout(forceScrollTimer.current)
      forceScrollTimer.current = null
    }
    // 瞬时动作（persist=false）在 500ms 后自动复位；持续动作（persist=true，如拖动进度条）
    // 保持 force 直到手动复位，避免拖动过程中被定时器复位后“舒适区”节流导致高亮行滞后/错位。
    if (on && !persist) {
      forceScrollTimer.current = setTimeout(() => {
        forceScrollRef.current = false
        forceScrollTimer.current = null
      }, 500)
    }
  }, [])

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
  // 歌词高亮行定位：让当前行落在歌词界面【中央偏上一行】（viewPosition≈0.5 再向上偏移一个行高）。
  // 用户要求：高亮行要比屏幕正中央再往上移一行，所以 targetOffset 在居中基础上再增加一个 itemHeight。
  // 跨行切换时无条件滚动到该位置，确保播放中高亮行与音频同步且位置一致。
  // 同一行重锚时再用“舒适区 15%”节流，避免逐秒重锚把歌词列表反复微滚动造成抖动。
  // force=true 时无视舒适区，用于切回歌词页 / 切歌 / 拖动进度条 / 点击歌词 / 恢复播放等需要立即定位的场景。
  const lastScrolledLineRef = useRef(-1)
  const handleScrollToActive = (index = lineRef.current.line, force = false) => {
    if (index < 0 || !flatListRef.current || isPauseScrollRef.current) return
    if (scrollCancelRef.current) {
      scrollCancelRef.current()
      scrollCancelRef.current = null
    }
    const listHeight = pageHeight > 0 ? pageHeight : pagerHeight
    if (listHeight <= 0) return
    // 上下留白收紧为约 18% 列表高：正常播放时高亮行仍严格居中；仅最开头第 1 行（起播一瞬）会略偏上，到第 2 行起整首歌死死居中。
    const paddingV = pageHeight > 0 ? pageHeight * 0.18 : 0
    const { offset: itemTop, length: itemHeight } = getItemLayout(lyricLines, index)
    // 等效 viewPosition:0.5 再向上偏移一个行高：让高亮行比屏幕中央上移一行。
    const targetOffset = Math.max(0, paddingV + itemTop + itemHeight / 2 - listHeight / 2 + itemHeight)
    const lineChanged = index !== lastScrolledLineRef.current
    // 非强制 + 同一行 + 当前行已在可视舒适区内（距目标 < 15% 视高）则跳过本次滚动（防抖动）；
    // 跨行切换 / 强制场景无条件滚动到中央，保证高亮行与音频同步且居中。
    if (!force && !lineChanged && Math.abs(targetOffset - scrollYRef.current) < listHeight * 0.15) return
    try {
      // force=true（切回歌词页 / 切歌 / 初次加载 / 拖动 / 点击）时立即定位，不用动画，避免高亮行“姗姗来迟”。
      flatListRef.current.scrollToOffset({ offset: targetOffset, animated: !force })
      lastScrolledLineRef.current = index
    } catch { }
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

  // 拖动进度条 / 跳转 / 恢复播放等用户动作期间强制让歌词列表立即滚动到高亮行，
  // 保证高亮行与进度条（及音频）绝对同步，不出现“高亮行滞后 / 错位的 15% 舒适区跳过重滚动”。
  useEffect(() => {
    const handleDragState = (dragging: boolean) => {
      if (dragging) {
        // 拖动进度条期间持续强制同步：让 force 一直为 true，不被 500ms 定时器复位，
        // 否则长拖动中途被复位后“舒适区”节流会让高亮行跟不上进度条。
        setForceScroll(true, true)
      } else {
        // 拖动结束：保持一小段时间让最后一段定位动画落位，再复位。
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
  }, [setForceScroll])

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
    scrollYRef.current = 0
    if (!lyricLines.length) return
    // playLineRef.current?.updateLyricLines(lyricLines)
    requestAnimationFrame(() => {
      if (isFirstSetLrc.current) {
        isFirstSetLrc.current = false
        setTimeout(() => {
          isPauseScrollRef.current = false
          handleScrollToActive(0, true)
        }, 100)
      } else {
        if (delayScrollTimeout.current) clearTimeout(delayScrollTimeout.current)
        delayScrollTimeout.current = setTimeout(() => {
          handleScrollToActive(0, true)
        }, 100)
      }
    })
  }, [lyricLines])

  useEffect(() => {
    if (line < 0) return
    lineRef.current.prevLine = lineRef.current.line
    lineRef.current.line = line
    if (!flatListRef.current || isPauseScrollRef.current) {
      activeRef.current = active
      return
    }

    // 非歌词页（封面页）时，歌词时钟仍在推进，但不在后台驱动 FlatList 滚动，
    // 避免 PagerView 横向滑页时与歌词的逐秒 scrollToIndex 抢帧导致卡顿。
    if (!active) {
      activeRef.current = active
      return
    }

    // 从封面页切回歌词页的“上升沿”这一次强制立刻定位（force=true）：
    // 否则本 effect 比 [active] effect 先执行，会先发一个 animated:true 的舒适区动画滚动，
    // 高亮行就“慢慢滚”到目标，而非立即到位。
    const force = forceScrollRef.current || activeRef.current === false
    activeRef.current = active
    // 拖动进度条 / 跳转 / 恢复播放等用户动作期间强制滚动（force），使高亮行绝对同步跟随；
    // 被动逐秒重锚时仍用舒适区节流，避免逐行微滚动卡顿。
    handleScrollToActive(lineRef.current.line, force)
  }, [line, active])

  // 从封面页切回歌词页时，立即把歌词时钟重锚到真实音频位置，并强制把当前行定位到 42% 位置，
  // 避免“长暂停后再播放 / 重开后”高亮行姗姗来迟、与音频不同步。
  useEffect(() => {
    if (active) {
      setForceScroll(true)
      // 等 FlatList 完成本次布局（pageHeight / 行高就绪）后再立即无动画定位，
      // 避免切页瞬间高度未就绪导致定位偏差或延时。
      requestAnimationFrame(() => {
        handleScrollToActive(lineRef.current.line, true)
      })
      void getPosition().then((p) => {
        if (p != null) {
          try { lrcSyncToTime(p * 1000, playerState.isPlay) } catch {}
          // 重锚后 line 会在下一 tick 更新并走上面的 force 路径；再补一次 rAF 立即定位，
          // 确保重锚后的正确行第一时间出现在视口，不被舒适区动画拖慢。
          requestAnimationFrame(() => {
            setForceScroll(true)
            handleScrollToActive(lineRef.current.line, true)
          })
        }
      })
    }
  }, [active])

  // useEffect(() => {
  //   requestAnimationFrame(() => {
  //     playLineRef.current?.updateLayoutInfo(listLayoutInfoRef.current)
  //     playLineRef.current?.updateLyricLines(lyricLines)
  //   })
  // }, [isShowLyricProgressSetting])

  // 仅记录当前滚动偏移，供“舒适区感知滚动”判断使用；不触发重渲染。
  const handleScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollYRef.current = e.nativeEvent.contentOffset.y
  }, [])

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
      try { lrcSyncToTime(line.time, playerState.isPlay) } catch {}
      // setProgress 内部会真正 seek 音频（setCurrentTime -> seekToTime），
      // 同时把歌词时钟重锚到该行时间，保证音频与该行高亮绝对同步。
      global.app_event.setProgress(line.time / 1000);
    }
    // 用户点击歌词行属于主动跳转：强制让歌词列表立即、无动画地定位到被点行，
    // 越过“舒适区 15%”节流与动画延迟，使高亮行与音频（及进度条）绝对同步跟随。
    setForceScroll(true);
    handleScrollToActive(index, true);
  }, [isShowLyricProgressSetting, lyricLines, setForceScroll, handleScrollToActive]);

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
        style={{ height: pageHeight > 0 ? pageHeight : pagerHeight, width: '100%' }}
        // 歌词列表从顶部排布，当前行由 scrollToOffset(viewPosition 0.5) 定位到【中央】；
        // 不再用 justifyContent:'center' 整体垂直居中——否则歌词少时整页被顶到中间、
        // 上下露出大片空白（即用户反馈的“被空白遮住 / 下面空白”）。
        contentContainerStyle={{
          paddingHorizontal: isSmallWindow ? 12 : 20,
          // 上下留白收紧为约 35% 列表高：正常播放高亮行居中，仅首/尾极少数行略偏
          paddingTop: pageHeight > 0 ? pageHeight * 0.18 : 0,
          paddingBottom: pageHeight > 0 ? pageHeight * 0.18 : 0,
        }}
        ref={flatListRef}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={400}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        initialNumToRender={20}
        windowSize={5}
        maxToRenderPerBatch={12}
        updateCellsBatchingPeriod={100}
        getItemLayout={getItemLayout}
        extraData={line}
        removeClippedSubviews={true}
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
