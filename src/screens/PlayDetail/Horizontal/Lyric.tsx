import { memo, useMemo, useState, useEffect, useRef, useCallback } from 'react'
import {
  View,
  FlatList,
  type FlatListProps,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type LayoutChangeEvent, TouchableOpacity,
  PanResponder,
} from 'react-native'
import { type Line, useLrcPlay, useLrcSet, useLrcWordsMap } from '@/plugins/lyric'
import type { LxLyricWord } from '@/plugins/lxLyricPlayer'
import { createStyle } from '@/utils/tools'
import { updateSetting } from '@/core/common'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useSafeAreaBottom } from '@/store/common/hook'
import { AnimatedColorText } from '@/components/common/Text'
import { setSpText } from '@/utils/pixelRatio'
import settingState from '@/store/setting/state'
import playerState from '@/store/player/state'
import { scrollTo } from '@/utils/scroll'
import { LyricScrollLayout } from '@/utils/lyricScroll'
import { audioClock } from '@/core/player/audioClock'
import KaraokeLyric from '@/screens/PlayDetail/components/KaraokeLyric'

type FlatListType = FlatListProps<Line>

interface LineProps {
  line: Line
  lineNum: number
  activeLine: number
  onLayout: (lineNum: number, height: number, width: number, isPlayed: boolean, isActive: boolean) => void
  onPress: (index: number) => void
  wordsByIndex: ReadonlyArray<LxLyricWord[] | null>
}
const LrcLine = memo(
  ({ line, lineNum, activeLine, onLayout, onPress, wordsByIndex }: LineProps) => {
    const theme = useTheme()
    const lrcFontSize = useSettingValue('playDetail.horizontal.style.lrcFontSize')
    const textAlign = useSettingValue('playDetail.style.align')
    const isActive = activeLine == lineNum
    const isPlayed = lineNum < activeLine
    const size = lrcFontSize / 10
    const lineHeight = setSpText(size) * 1.3
    // 有逐字时间轴的行始终用卡拉OK渲染器（非激活时静态显示未播放颜色）：
    // 嵌套 Text 与纯文本的换行断点不同，若激活时才切换渲染器，行高会在切行瞬间突变，
    // 造成抖动且实测高度与累计偏移基准不一致、高亮行偏离中心。
    const words = wordsByIndex[lineNum] ?? null

    const colors = useMemo(() => {
      return isActive
        ? ([theme['c-primary'], theme['c-primary-alpha-200'], 1] as const)
        : ([theme['c-350'], theme['c-300'], 0.8] as const)
    }, [isActive, theme])

    const handleLayout = ({ nativeEvent }: LayoutChangeEvent) => {
      onLayout(lineNum, nativeEvent.layout.height, nativeEvent.layout.width, isPlayed, isActive)
    }
    const handlePress = useCallback(() => {
      onPress(lineNum)
    }, [onPress, lineNum])
    // 行布局（字号/字重/行高）与播放/激活状态解耦：已播放/当前行仅靠颜色区分，不再加粗。
    // 否则行随播放从 normal→bold 变宽，换行数变化导致行高突变，滚动抖动且居中基准漂移。
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={line.text || undefined}
      >
        <View style={styles.line} onLayout={handleLayout}>
          {words
            ? (
              <KaraokeLyric
                style={{
                  ...styles.lineText,
                  textAlign,
                  lineHeight,
                  fontWeight: 'normal',
                  opacity: colors[2],
                }}
                words={words}
                lineTime={line.time}
                size={size}
                isActive={isActive}
                playedColor={colors[0]}
                inactiveColor={theme['c-350']}
              />
              )
            : (
              <AnimatedColorText
                style={{
                  ...styles.lineText,
                  textAlign,
                  lineHeight,
                  fontWeight: 'normal',
                }}
                textBreakStrategy="simple"
                color={colors[0]}
                opacity={colors[2]}
                size={size}
              >
                {line.text}
              </AnimatedColorText>
              )}
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
      prevProps.onPress === nextProps.onPress &&
      prevProps.wordsByIndex === nextProps.wordsByIndex
    )
  },
)
const wait = async() => new Promise((resolve) => setTimeout(resolve, 100))

export default () => {
  const safeAreaBottom = useSafeAreaBottom()
  const lyricLines = useLrcSet()
  const { line } = useLrcPlay()
  // 逐字时间轴（与 lyricLines 同序）：第 i 项为第 i 行歌词的逐字数组；无逐字（纯 LRC）为 null。
  // 激活行据此走逐字卡拉OK渲染，否则退回整行高亮。
  const wordsByIndex = useLrcWordsMap()
  const flatListRef = useRef<FlatList>(null)
  const isPauseScrollRef = useRef(true)
  const scrollTimoutRef = useRef<NodeJS.Timeout | null>(null)
  const delayScrollTimeout = useRef<NodeJS.Timeout | null>(null)
  const lineRef = useRef({ line: 0, prevLine: 0 })
  const scrollInfoRef = useRef<NativeSyntheticEvent<NativeScrollEvent>['nativeEvent'] | null>(null)
  // 缓存歌词行高与累计偏移，把滚动定位从 O(n²) 降到 O(1)。
  const lyricScrollLayoutRef = useRef(new LyricScrollLayout(54))
  const scrollCancelRef = useRef<(() => void) | null>(null)
  // 连续滚动：rAF 目标 offset 不直接写入列表，而是让跟随值按固定时长/固定速率收敛到目标。
  // 逐字歌词无间隙切行、行高测量后的回正修正都是瞬时硬跳（长句换行后行高更大、跳变越明显），
  // 平滑收敛把这些瞬跳变成约 180ms 的短滑动，消除换行长句切行时的顿挫感。
  const smoothOffsetRef = useRef(0)
  const lastWrittenOffsetRef = useRef(-1)
  const lastFrameTsRef = useRef(0)
  const wasPauseRef = useRef(true)
  // 拖动进度条 / 跳转 / 点击歌词期间强制立即定位，结束后（500ms）复位交由连续滚动循环驱动。
  const forceScrollRef = useRef(false)
  const forceScrollTimer = useRef<NodeJS.Timeout | null>(null)
  // 连续滚动循环记录上一帧精确时间，暂停/无推进时跳过，避免空转重复写 scrollToOffset。
  const lastContinuousTimeRef = useRef(-1)
  // 上一帧的高亮行索引（用于判断是否切行）。
  const lastContinuousIndexRef = useRef(-1)
  // 切行滑动：起点偏移 / 终点偏移 / 起始时间戳（< 0 表示不在滑动中）；与竖屏同一套参数。
  const glideFromRef = useRef(0)
  const glideToRef = useRef(0)
  const glideStartTsRef = useRef(-1)
  // 切行滑动时长：固定时长 + easeInOut，起步/收尾平缓、每帧位移连续（原先 40/s 的指数逼近
  // 单帧就吃掉 47% 距离，观感是“顿一下再猛追”，行高越大越明显）。
  const LINE_CHANGE_GLIDE_MS = 180
  // 同一行内的平滑速率：只吸收行高测量带来的一行内小幅修正（12/s ≈ 200ms 收敛 95%）。
  const SMOOTH_RATE_NORMAL = 12
  // 列表可视高度（onLayout 测量），连续滚动按此计算居中偏移。
  const listHeightRef = useRef(0)
  // 列表可视高度 state：同时驱动 contentContainerStyle 的上下留白（50% 视高），
  // 保证歌词第一行/最后一行也能滚动到正中央。
  const [listHeight, setListHeight] = useState(0)
  // 回正定时器：进入/切歌后布局（spaceComponent / 行高）尚未完成时，防抖在测量完成后重新精确居中一次。
  const recentreTimerRef = useRef<NodeJS.Timeout | null>(null)

  const initialDistanceRef = useRef(0)
  const initialFontSizeRef = useRef(0)
  // 缩放节流：updateSetting 每次调用都会全量序列化 setting 并写 AsyncStorage，
  // 缩放手势每帧触发会造成连串写盘掉帧；move 中按 120ms 节流提交，
  // 最新期望值暂存 pending，松手/被接管时补交终值（对齐竖屏实现）。
  const lastZoomCommitRef = useRef(0)
  const pendingZoomSizeRef = useRef<number | null>(null)

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
      lastZoomCommitRef.current = 0
      pendingZoomSizeRef.current = null
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

      if (settingState.setting['playDetail.horizontal.style.lrcFontSize'] === newSize) return
      // 节流提交：间隔内的帧只更新 pending，松手时补交终值，避免每帧写盘。
      pendingZoomSizeRef.current = newSize
      const now = Date.now()
      if (now - lastZoomCommitRef.current >= 120) {
        lastZoomCommitRef.current = now
        updateSetting({ 'playDetail.horizontal.style.lrcFontSize': newSize })
      }
    },
    onPanResponderRelease: () => {
      initialDistanceRef.current = 0
      // 松手补交：把节流期间暂存的最终字号落盘，保证手势结束后的字号与用户预期一致。
      const pending = pendingZoomSizeRef.current
      pendingZoomSizeRef.current = null
      if (pending != null && settingState.setting['playDetail.horizontal.style.lrcFontSize'] !== pending) {
        updateSetting({ 'playDetail.horizontal.style.lrcFontSize': pending })
      }
    },
    onPanResponderTerminate: () => {
      initialDistanceRef.current = 0
      // 手势被系统接管时同样补交终值，避免缩放结果丢失。
      const pending = pendingZoomSizeRef.current
      pendingZoomSizeRef.current = null
      if (pending != null && settingState.setting['playDetail.horizontal.style.lrcFontSize'] !== pending) {
        updateSetting({ 'playDetail.horizontal.style.lrcFontSize': pending })
      }
    },
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
  const handleScrollToActive = useCallback((index = lineRef.current.line, force = false) => {
    if (index < 0 || !flatListRef.current || isPauseScrollRef.current) return
    if (scrollCancelRef.current) {
      scrollCancelRef.current()
      scrollCancelRef.current = null
    }
    const layout = lyricScrollLayoutRef.current
    const listHeight = listHeightRef.current || scrollInfoRef.current?.layoutMeasurement.height || 0
    // 首帧或异常情况下无滚动信息，只能走 scrollToIndex fallback；
    // 此时虽不能精确居中，但总比完全不滚动好。
    if (!scrollInfoRef.current || listHeight <= 0) {
      try {
        flatListRef.current.scrollToIndex({ index, animated: !force, viewPosition: 0.5 })
      } catch { }
      return
    }
    // 横屏已播放/当前行都是 bold 档，累计偏移须用 played 档估算，否则未测量区域会系统性偏低。
    // force 定位使用激活高度（当前行可能被 bold 字号挤高），保证居中准确。
    // 上下留白（paddingV）与 FlatList contentContainerStyle 的 paddingTop/Bottom 用同一个值
    // （50% 视高）：布局端与计算端天然一致，不再依赖 space 组件的 onLayout 异步实测，
    // 消除 iPad 横屏限宽/旋转/窗口尺寸变化时 spaceHeight 与实际布局脱节导致的不居中。
    const paddingV = listHeight * 0.5
    const targetOffset = layout.getTargetOffsetPrecise(index, listHeight, lyricLines, 0.5, paddingV, 0, true, true)
    if (force) {
      try {
        flatListRef.current.scrollToOffset({ offset: targetOffset, animated: false })
      } catch { }
      // force 瞬时定位后把平滑跟随值直接对齐目标：连续滚动循环从同一基准出发，
      // 不会把列表拽回旧位置。非 force（动画滚动）不改动跟随值，交给循环平滑收敛。
      smoothOffsetRef.current = targetOffset
      lastWrittenOffsetRef.current = targetOffset
      // 硬跳定位后取消进行中的切行滑动，否则下一帧会被滑动轨迹拉回旧位置；
      // 同时把“上一次滚动到的行”对齐，避免下一帧把这次硬跳当成切行再滑一次。
      glideStartTsRef.current = -1
      lastContinuousIndexRef.current = index
    } else {
      const currentOffset = scrollInfoRef.current.contentOffset.y
      const distance = Math.abs(targetOffset - currentOffset)
      const duration = Math.min(Math.max(distance * 0.5, 120), 300)
      try {
        scrollCancelRef.current = scrollTo(
          flatListRef.current,
          scrollInfoRef.current,
          targetOffset,
          duration,
          () => { scrollCancelRef.current = null },
        )
      } catch { }
    }
  }, [lyricLines])

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

  // 连续平滑滚动：每帧把「当前高亮行」精确居中（与竖屏同一策略）。
  // 目标行取高亮行本身（lineRef.current.line），不再用 audioClock 另算行号：
  // 两处时间基准不同会在换行边界附近出现「滚动目标已到下一行、高亮还在当前行」，
  // 视觉上就是高亮行整行偏离中心，行高越大偏得越多（两行以上长句最明显）。
  // 同时去掉「句末提前滚到下一行」的预滚动，改在切行瞬间直接以新行为目标、快速平滑到位。
  const scrollToActiveContinuous = useCallback((ts: number) => {
    const t = audioClock.getTime() * 1000 // ms
    if (t === lastContinuousTimeRef.current) {
      lastFrameTsRef.current = ts
      return // 暂停/无推进时跳过
    }
    lastContinuousTimeRef.current = t
    if (!flatListRef.current || !lyricLines.length) return
    const listHeight = listHeightRef.current || scrollInfoRef.current?.layoutMeasurement.height || 0
    if (listHeight <= 0) return
    const layout = lyricScrollLayoutRef.current
    let i = lineRef.current.line
    if (i < 0 || i >= lyricLines.length) i = 0
    // 横屏「当前行之前」全为已播放（bold）行，累计偏移统一用 bold 档，避免高亮行持续偏低。
    // 留白与 contentContainerStyle 同源（50% 视高），与 handleScrollToActive 保持同一居中基准。
    const paddingV = listHeight * 0.5
    const offset = layout.getTargetOffsetPrecise(i, listHeight, lyricLines, 0.5, paddingV, 0, false, true)
    if (i !== lastContinuousIndexRef.current) {
      lastContinuousIndexRef.current = i
      // 切行：以“列表当前实际位置”为起点、新行居中位置为终点，重新开始一段固定时长的滑动。
      // 两句紧挨着时（上一段还没滑完就切行）也从当前位置接着滑，位移连续、不闪不跳。
      glideFromRef.current = smoothOffsetRef.current
      glideToRef.current = offset
      glideStartTsRef.current = ts
    }
    const dt = lastFrameTsRef.current > 0 ? Math.min(Math.max((ts - lastFrameTsRef.current) / 1000, 0.001), 0.05) : 0.016
    lastFrameTsRef.current = ts
    const glideElapsed = ts - glideStartTsRef.current
    if (glideStartTsRef.current >= 0 && glideElapsed < LINE_CHANGE_GLIDE_MS) {
      // 切行滑动中：easeInOutQuad。终点取切行当帧记录的新行偏移；若这期间行高测量修正了目标，
      // 滑动结束后由下面的指数平滑继续收敛（小幅位移，无感），不会硬跳。
      const p = glideElapsed / LINE_CHANGE_GLIDE_MS
      const eased = p < 0.5 ? 2 * p * p : 1 - (((-2 * p) + 2) * ((-2 * p) + 2)) / 2
      smoothOffsetRef.current = glideFromRef.current + (glideToRef.current - glideFromRef.current) * eased
    } else {
      glideStartTsRef.current = -1
      const delta = offset - smoothOffsetRef.current
      if (Math.abs(delta) < 0.5) smoothOffsetRef.current = offset
      else smoothOffsetRef.current += delta * (1 - Math.exp(-dt * SMOOTH_RATE_NORMAL))
    }
    if (Math.abs(smoothOffsetRef.current - lastWrittenOffsetRef.current) < 0.5) return
    try {
      flatListRef.current.scrollToOffset({ offset: smoothOffsetRef.current, animated: false })
      lastWrittenOffsetRef.current = smoothOffsetRef.current
    } catch { }
  }, [lyricLines])

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

  // 进入/切歌后布局（spaceComponent / 行高）可能尚未完成，首跳落点可能有偏差；
  // 等行测量 / 列表高度就位（防抖 150ms）后静默回正一次，保证高亮行最终严格居中（对齐竖屏）。
  const scheduleRecentre = useCallback(() => {
    if (recentreTimerRef.current) clearTimeout(recentreTimerRef.current)
    recentreTimerRef.current = setTimeout(() => {
      recentreTimerRef.current = null
      if (isPauseScrollRef.current) return
      // 非 force：测量修正交给连续滚动循环平滑收敛，避免 force 硬跳在长句测量后产生可见顿挫。
      handleScrollToActive(lineRef.current.line)
    }, 150)
  }, [handleScrollToActive])

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
      if (recentreTimerRef.current) {
        clearTimeout(recentreTimerRef.current)
        recentreTimerRef.current = null
      }
      if (pendingInitialScrollTimerRef.current) {
        clearTimeout(pendingInitialScrollTimerRef.current)
        pendingInitialScrollTimerRef.current = null
      }
    }
  }, [])

  // 「引擎当前行号」的镜像：重置 effect 不能再把 line 放进依赖（原因见下）。
  const latestLineRef = useRef(line)
  latestLineRef.current = line
  // 首跳等待标记 + 兜底定时器：切歌后换 key 重新挂载列表，等新列表 onContentSizeChange 再定位。
  const pendingInitialScrollRef = useRef(false)
  const pendingInitialScrollTimerRef = useRef<NodeJS.Timeout | null>(null)
  // handleScrollToActive / scheduleRecentre 的稳定引用：重置 effect 不把它们放进依赖项。
  const handleScrollToActiveRef = useRef(handleScrollToActive)
  useEffect(() => {
    handleScrollToActiveRef.current = handleScrollToActive
  }, [handleScrollToActive])
  const scheduleRecentreRef = useRef(scheduleRecentre)
  useEffect(() => {
    scheduleRecentreRef.current = scheduleRecentre
  }, [scheduleRecentre])
  // 歌词内容版本号：内容变化时给 FlatList 换 key 强制重新挂载，
  // 使 initialNumToRender（整首行数）在“歌词异步到达/切歌”时同样生效，
  // 首屏把每一行都渲染一次并完成实测（详见竖屏同名注释）。
  const [lyricKey, setLyricKey] = useState(0)
  // 首次挂载不必换 key（首挂本身就会按 initialNumToRender 渲染整首），只在后续内容变化时换。
  const isFirstLyricKeyRef = useRef(true)
  useEffect(() => {
    if (isFirstLyricKeyRef.current) {
      isFirstLyricKeyRef.current = false
      return
    }
    setLyricKey(key => key + 1)
  }, [lyricLines])

  // 仅歌词内容真正变化（切歌 / 异步歌词到达）时才重置行高缓存并重新挂载列表。
  // ⚠️ 依赖项里【绝不能】放 line：
  // 修复前依赖了 line，导致【每切一行】都执行一次 reset() —— 清空全部实测行高、
  // 把列表拽回顶部；之后累计偏移只能用 defaultHeight（54pt）估算累加，
  // 两行及以上的歌词行真实高度约 71pt，每行少算约 17pt，偏移随播放逐行偏小，
  // 高亮行越来越靠下（与竖屏同源问题，iPad 横屏同样存在）。
  useEffect(() => {
    // linesRef.current = lyricLines
    lyricScrollLayoutRef.current.reset()
    lineRef.current.prevLine = 0
    lineRef.current.line = 0
    // 等新列表内容布局完成后再首跳；期间暂停连续滚动循环，避免它按归零后的行号把旧列表拽回顶部。
    pendingInitialScrollRef.current = true
    isPauseScrollRef.current = true
    if (!flatListRef.current) return
    flatListRef.current.scrollToOffset({
      offset: 0,
      animated: false,
    })
    // 平滑跟随基准同步归零，避免切歌后循环把列表从旧位置拽回顶部。
    smoothOffsetRef.current = 0
    lastWrittenOffsetRef.current = -1
    lastFrameTsRef.current = 0
    glideStartTsRef.current = -1
    lastContinuousIndexRef.current = -1
    if (!lyricLines.length) {
      pendingInitialScrollRef.current = false
      isPauseScrollRef.current = false
      return
    }

    // 切歌/异步歌词到达后，必须强制下一次 line 更新时立即定位到当前高亮行。
    // 否则 play/setProgress 事件可能晚于 line 更新，forceScrollRef 仍为 false，
    // 导致高亮行无法居中（iPad 横屏切歌后歌词不居中的主因）。
    setForceScroll(true)

    // 兜底：onContentSizeChange 未触发时也要解除暂停并定位。
    if (pendingInitialScrollTimerRef.current) clearTimeout(pendingInitialScrollTimerRef.current)
    pendingInitialScrollTimerRef.current = setTimeout(() => {
      pendingInitialScrollTimerRef.current = null
      if (!pendingInitialScrollRef.current) return
      pendingInitialScrollRef.current = false
      isPauseScrollRef.current = false
      handleScrollToActiveRef.current(Math.max(0, latestLineRef.current), true)
    }, 800)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricLines])

  useEffect(() => {
    if (line < 0) return
    lineRef.current.prevLine = lineRef.current.line
    lineRef.current.line = line
    if (!flatListRef.current || isPauseScrollRef.current) return

    // 拖动进度条 / 跳转 / 点击歌词（force）期间立即无动画定位；普通播放推进交给每帧连续
    // 滚动循环（scrollToActiveContinuous），实现平滑上移而非逐行跳变。
    if (forceScrollRef.current) {
      handleScrollToActive(lineRef.current.line, true)
    }
  }, [line, handleScrollToActive])

  // 每帧连续平滑滚动循环：歌词页激活且非用户手动滚动、非强制定位时，基于外推时钟精确时间驱动歌词连续上移。
  // iOS 后台 / 锁屏时 rAF 暂停（歌词停滚无妨）；前台播放每帧（~16ms）定位，消除原来的行级跳变。
  useEffect(() => {
    let rafId = 0
    const loop = (ts: number) => {
      if (isPauseScrollRef.current) {
        wasPauseRef.current = true
      } else if (!forceScrollRef.current && flatListRef.current && lyricLines.length) {
        // 从暂停（用户手动滚动/拖动歌词）恢复的首帧：把平滑基准重置为列表真实位置，
        // 避免沿用暂停前的旧基准把列表瞬间拽回去。
        if (wasPauseRef.current) {
          wasPauseRef.current = false
          smoothOffsetRef.current = scrollInfoRef.current?.contentOffset.y ?? 0
          lastWrittenOffsetRef.current = smoothOffsetRef.current
          lastFrameTsRef.current = ts
          // 恢复首帧不承接暂停前的切行滑动
          glideStartTsRef.current = -1
          lastContinuousIndexRef.current = -1
        }
        scrollToActiveContinuous(ts)
      }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(rafId) }
  }, [lyricLines, scrollToActiveContinuous])

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
    const handleSetProgress = () => { setForceScroll(true) }
    const handlePlay = () => { setForceScroll(true) }
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
      // 重试时强制无动画立即定位，避免“动画滚动 + 二次延迟”进一步拖慢歌词出现。
      handleScrollToActive(info.index, true)
    })
  }

  const handleLineLayout = useCallback<LineProps['onLayout']>((lineNum, height, _width, isPlayed, isActive) => {
    const layout = lyricScrollLayoutRef.current
    const wasMeasured = layout.isMeasured(lineNum)
    layout.updateLineHeight(
      lineNum,
      height,
      !!(lyricLines[lineNum]?.extendedLyrics?.length),
      isActive,
      isPlayed,
    )
    if (isPauseScrollRef.current) return
    const current = lineRef.current.line
    // 当前行首次测量（切歌/跳转后激活行真实高度就位），或非激活行首次测量导致累计偏移变化时，
    // 防抖回正：避免进入/切歌后估算误差让高亮行一直停在非居中位置。
    if (lineNum === current || (!wasMeasured && lineNum < current)) scheduleRecentre()
  }, [lyricLines, scheduleRecentre])

  // 测量列表可视高度，供连续滚动计算居中偏移（首帧滚动前即可拿到真实高度）；
  // 同时同步 state 驱动 contentContainerStyle 上下留白（50% 视高）。
  const handleListLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    const h = nativeEvent.layout.height
    if (h <= 0) return
    if (listHeightRef.current !== h) {
      listHeightRef.current = h
      setListHeight(h)
    }
    // 列表高度就位（首帧 / 旋转 / 分栏宽度变化）后回正一次，确保高亮行在真实高度下居中。
    scheduleRecentre()
  }, [scheduleRecentre])

  // 列表内容尺寸就绪（切歌换 key 重新挂载后的首批布局完成）：执行等待中的首跳定位，
  // 用最新行号镜像，避免用刚被重置为 0 / 残留旧歌的行号定位。
  const handleContentSizeChange = useCallback(() => {
    if (pendingInitialScrollTimerRef.current) {
      clearTimeout(pendingInitialScrollTimerRef.current)
      pendingInitialScrollTimerRef.current = null
    }
    if (!pendingInitialScrollRef.current) return
    pendingInitialScrollRef.current = false
    isPauseScrollRef.current = false
    // 进入/切歌：立即无动画定位到【引擎当前高亮行】，让歌词与封面同步出现，
    // 避免“从顶部慢慢滚到中间”造成的加载慢观感（对齐竖屏实现）。
    handleScrollToActiveRef.current(Math.max(0, latestLineRef.current), true)
    // 布局（spaceComponent / 行高）可能尚未完成，150ms 后再次精确回正确保高亮行居中。
    scheduleRecentreRef.current()
  }, [])

  const handleLinePress = useCallback((index: number) => {
    if (scrollTimoutRef.current) {
      clearTimeout(scrollTimoutRef.current)
      scrollTimoutRef.current = null
    }
    if (scrollCancelRef.current) {
      scrollCancelRef.current()
      scrollCancelRef.current = null
    }
    isPauseScrollRef.current = false
    // 点击歌词视为用户主动跳转：强制立即定位，越过连续滚动循环，使高亮行与音频绝对同步。
    setForceScroll(true)
    const line = lyricLines[index]
    if (line) {
      global.app_event.setProgress(line.time / 1000)
    }

    handleScrollToActive(index)
  }, [lyricLines, handleScrollToActive])

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => {
    return <LrcLine line={item} lineNum={index} activeLine={line} onLayout={handleLineLayout} onPress={handleLinePress} wordsByIndex={wordsByIndex} />
  }
  // 与竖屏一致用行索引作 key：切歌时行组件按 key 复用、仅 props 更新，
  // 避免把 text 拼进 key 导致切歌时整表卸载重建（行内动画状态也要重挂）。
  const getkey: FlatListType['keyExtractor'] = (_item, index) => `${index}`

  // 上下留白 50% 视高（与滚动定位的 paddingV 同一个值）：
  // 高亮行能严格滚到正中央，且歌词第一行/最后一行也不例外。
  // 不再用 ListHeader/Footer space + paddingTop:'100%'（相对列表宽度，iPad 横屏限宽/
  // 旋转时实测值与计算脱节，是高亮行不居中的根源）。
  const listPadding = useMemo(
    () => ({ paddingTop: listHeight * 0.5, paddingBottom: listHeight * 0.5 }),
    [listHeight],
  )

  return (
    <View style={[styles.container, { paddingBottom: safeAreaBottom }]} {...panResponder.panHandlers}>
      <FlatList
        // key 随歌词内容变化：强制重新挂载，使 initialNumToRender（整首行数）在
        // “切歌 / 异步歌词到达”时也生效，首屏把每一行都渲染一次并完成实测（对齐竖屏）。
        key={lyricKey}
        data={lyricLines}
        renderItem={renderItem}
        keyExtractor={getkey}
        style={{ flex: 1 }}
        ref={flatListRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={listPadding}
        onContentSizeChange={handleContentSizeChange}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        // 与竖屏歌词页一致：首屏把整首歌的歌词行全部渲染一次。
        // 行高只能靠 onLayout 实测，未渲染过的行只能用「平均高度」估算；跳到中后段时
        // FlatList 只渲染目标附近的窗口，开头这批行与窗口之间会留下一段永不渲染的行，
        // 其中两行及以上的长句（真实行高约为单行的 2 倍）会让累计偏移持续偏差，
        // 高亮行整段无法回到正中。全部渲染一次后所有行高均为实测值，居中无估算误差。
        initialNumToRender={Math.max(lyricLines.length, 60)}
        windowSize={15}
        maxToRenderPerBatch={20}
        updateCellsBatchingPeriod={50}
        scrollEventThrottle={16}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        onScroll={handleScroll}
        onLayout={handleListLayout}
        removeClippedSubviews={false}
        extraData={[line, wordsByIndex]}
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
  line: {
    paddingTop: 12,
    paddingBottom: 12,
  },
  lineText: {
    textAlign: 'center',
  },
  lineTranslationText: {
    textAlign: 'center',
    paddingTop: 5,
  },
})
