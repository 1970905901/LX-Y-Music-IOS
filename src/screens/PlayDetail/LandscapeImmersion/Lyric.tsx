import { memo, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  View,
  FlatList,
  Dimensions,
  type FlatListProps,
  type LayoutChangeEvent,
  TouchableOpacity,
} from 'react-native'
import { type Line, useLrcPlay, useLrcSet, findLineIndexByTime } from '@/plugins/lyric'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { AnimatedColorText } from '@/components/common/Text'
import { setSpText } from '@/utils/pixelRatio'
import { LyricScrollLayout } from '@/utils/lyricScroll'
import { audioClock } from '@/core/player/audioClock'

type FlatListType = FlatListProps<Line>

interface LineProps {
  line: Line
  lineNum: number
  activeLine: number
  onPress: (index: number) => void
  onLayout?: (lineNum: number, height: number, hasTranslation: boolean) => void
}

const LrcLine = memo(({ line, lineNum, activeLine, onPress, onLayout }: LineProps) => {
  const theme = useTheme()
  const lrcFontSize = useSettingValue('playDetail.landscapeImmersion.style.lrcFontSize')
  const lrcAlign = useSettingValue('playDetail.landscapeImmersion.style.lrcAlign')
  const size = lrcFontSize / 10
  const lineHeight = setSpText(size) * 1.5 // 稍微增大行高

  const colors = useMemo(() => {
    const active = activeLine == lineNum
    return active
      ? ([theme['c-primary-font-active'], theme['c-primary-alpha-200'], 1] as const)
      : ([theme['c-450'], theme['c-400'], 0.8] as const)
  }, [activeLine, lineNum, theme])

  const handlePress = useCallback(() => {
    onPress(lineNum)
  }, [onPress, lineNum])

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={handlePress}>
      <View style={styles.line} onLayout={(e) => onLayout?.(lineNum, e.nativeEvent.layout.height, (line.extendedLyrics?.length ?? 0) > 0)}>
      <AnimatedColorText
        color={colors[0]}
        opacity={colors[2]}
        size={size}
        style={{ ...styles.lineText, lineHeight, textAlign: lrcAlign }}
      >
        {line.text}
      </AnimatedColorText>
      {line.extendedLyrics.map((lrc, index) => (
        <AnimatedColorText
          key={index}
          color={colors[0]}
          opacity={colors[2]}
          size={size * 0.8}
          style={{ ...styles.lineTranslationText, lineHeight: lineHeight * 0.8, textAlign: lrcAlign }}
        >
          {lrc}
        </AnimatedColorText>
      ))}
    </View>
  </TouchableOpacity>
  )
})

export default memo(() => {
  const lyricLines = useLrcSet()
  const { line } = useLrcPlay()
  const flatListRef = useRef<FlatList<Line>>(null)
  const isPauseScrollRef = useRef(false)
  const scrollTimoutRef = useRef<NodeJS.Timeout | null>(null)
  const lineRef = useRef({ line: 0, prevLine: 0 })
  const isShowLyricProgressSetting = useSettingValue('playDetail.isShowLyricProgressSetting')
  // 缓存歌词行高与累计偏移，把滚动定位从 O(n²) 降到 O(1)，并供连续滚动精确计算居中偏移。
  const lyricScrollLayoutRef = useRef(new LyricScrollLayout(54))
  // 拖动进度条 / 跳转 / 点击歌词期间强制立即定位，结束后（500ms）复位交由连续滚动循环驱动。
  const forceScrollRef = useRef(false)
  const forceScrollTimer = useRef<NodeJS.Timeout | null>(null)
  // 连续滚动循环记录上一帧精确时间，暂停/无推进时跳过，避免空转重复写 scrollToOffset。
  const lastContinuousTimeRef = useRef(-1)
  // 列表可视高度（onLayout 测量），连续滚动按此计算居中偏移。
  const listHeightRef = useRef(0)

  const handleLinePress = useCallback((index: number) => {
    if (!isShowLyricProgressSetting) return
    // 点击歌词视为用户主动跳转：强制立即定位，越过连续滚动循环，使高亮行与音频绝对同步。
    setForceScroll(true)
    const line = lyricLines[index]
    if (line) {
      global.app_event.setProgress(line.time / 1000)
    }
  }, [isShowLyricProgressSetting, lyricLines])

  const handleScrollToActive = useCallback((index = lineRef.current.line) => {
    if (index < 0 || !flatListRef.current || lyricLines.length <= index) return
    try {
      flatListRef.current.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5,
      })
    } catch {
      // scrollToIndex 失败时回退到 scrollToOffset，用估算行高定位
      try {
        flatListRef.current.scrollToOffset({
          offset: index * 48,
          animated: true,
        })
      } catch {}
    }
  }, [lyricLines.length])

  // 行高测量：记录每行真实高度（含是否有翻译），供连续滚动精确计算累计偏移。
  const handleLineLayout = useCallback((lineNum: number, height: number, hasTranslation: boolean) => {
    lyricScrollLayoutRef.current.updateLineHeight(lineNum, height, hasTranslation)
  }, [])
  // 顶部/底部留白 spacer 高度（等效原 paddingVertical:'48%'），作为内容上方偏移 spaceHeight。
  const handleSpaceLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    lyricScrollLayoutRef.current.setSpaceHeight(nativeEvent.layout.height)
  }, [])

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
    const layout = lyricScrollLayoutRef.current
    if (layout.spaceHeight <= 0) return // 留白/spacer 尚未测量，待首帧布局完成再滚动
    const t = audioClock.getTime() * 1000 // ms
    if (t === lastContinuousTimeRef.current) return // 暂停/无推进时跳过
    lastContinuousTimeRef.current = t
    if (!flatListRef.current || !lyricLines.length) return
    const listHeight = listHeightRef.current
    if (listHeight <= 0) return
    let i = findLineIndexByTime(lyricLines, t)
    if (i < 0) i = 0
    const offset = layout.getContinuousOffset(i, lyricLines, t, listHeight, 0.5, 0, layout.spaceHeight)
    try {
      flatListRef.current.scrollToOffset({ offset, animated: false })
    } catch { }
  }

  useEffect(() => {
    return () => {
      if (scrollTimoutRef.current) clearTimeout(scrollTimoutRef.current)
    }
  }, [])

  useEffect(() => {
    lyricScrollLayoutRef.current.reset()
    lastContinuousTimeRef.current = -1
    lineRef.current.prevLine = 0
    lineRef.current.line = 0
    if (!flatListRef.current) return
    flatListRef.current.scrollToOffset({ offset: 0, animated: false })
    if (!lyricLines.length) return
    const timeout = setTimeout(() => handleScrollToActive(), 100)
    return () => clearTimeout(timeout)
  }, [lyricLines, handleScrollToActive])

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
  }, [line, handleScrollToActive])

  // 每帧连续平滑滚动循环：非用户手动滚动、非强制定位时，基于外推时钟精确时间驱动歌词连续上移。
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

  const handleScrollBeginDrag = useCallback(() => {
    isPauseScrollRef.current = true
    if (scrollTimoutRef.current) clearTimeout(scrollTimoutRef.current)
  }, [])

  const handleScrollEndDrag = useCallback(() => {
    if (scrollTimoutRef.current) clearTimeout(scrollTimoutRef.current)
    scrollTimoutRef.current = setTimeout(() => {
      isPauseScrollRef.current = false
      handleScrollToActive()
    }, 3000)
  }, [handleScrollToActive])

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => (
    <LrcLine line={item} lineNum={index} activeLine={line} onPress={handleLinePress} onLayout={handleLineLayout} />
  )
  const getkey: FlatListType['keyExtractor'] = (item, index) => `${index}${item.text}${item.extendedLyrics.join('')}`

  // 顶部/底部留白：等效原 paddingVertical:'48%'，但改为可测量的真实 spacer，
  // 其高度作为 spaceHeight 供连续滚动精确计算居中偏移（避免百分比 padding 无法被 offset 计算复用）。
  const spaceComponent = useMemo(
    () => <View style={styles.space} onLayout={handleSpaceLayout} />,
    [handleSpaceLayout],
  )

  return (
    <View style={styles.container}>
      <FlatList
        data={lyricLines}
        renderItem={renderItem}
        keyExtractor={getkey}
        style={{ flex: 1 }}
        contentContainerStyle={styles.listContent}
        ref={flatListRef}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollBegin={handleScrollBeginDrag}
        onMomentumScrollEnd={handleScrollEndDrag}
        ListHeaderComponent={spaceComponent}
        ListFooterComponent={spaceComponent}
        fadingEdgeLength={100}
        initialNumToRender={30}
        maxToRenderPerBatch={20}
        windowSize={15}
        updateCellsBatchingPeriod={50}
        scrollEventThrottle={16}
        onLayout={(e) => { listHeightRef.current = e.nativeEvent.layout.height }}
        onScrollToIndexFailed={(info) => {
          flatListRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: false,
          })
          setTimeout(() => {
            if (flatListRef.current) {
              flatListRef.current.scrollToIndex({
                index: info.index,
                animated: false,
                viewPosition: 0.5,
              })
            }
          }, 80)
        }}
      />
    </View>
  )
})

const { height: screenHeight } = Dimensions.get('window')

const styles = createStyle({
  container: {
    flex: 1,
    paddingLeft: 40,
    paddingRight: 20,
  },
  listContent: {
    // 顶部/底部留白改为可测量的真实 spacer（见 spaceComponent），此处不再用百分比 padding，
    // 以便连续滚动能精确复用其高度（spaceHeight）计算居中偏移。
  },
  space: {
    height: '48%',
  },
  line: {
    paddingVertical: 12,
  },
  lineText: {
    // 移除居中
  },
  lineTranslationText: {
    paddingTop: 8,
  },
})
