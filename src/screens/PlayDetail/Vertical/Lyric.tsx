import { memo, useMemo, useEffect, useRef, useCallback, useState } from 'react'
import {
  View,
  FlatList,
  type FlatListProps,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  TouchableOpacity,
  PanResponder,
} from 'react-native'
// import { useLayout } from '@/utils/hooks'
import { type Line, useLrcPlay, useLrcSet, useLrcWordsMap, syncToTime as lrcSyncToTime, findLineIndexByTime } from '@/plugins/lyric'
import type { LxLyricWord } from '@/plugins/lxLyricPlayer'
import { getPosition } from '@/plugins/player'
import { LyricScrollLayout } from '@/utils/lyricScroll'
import { audioClock } from '@/core/player/audioClock'
import { createStyle } from '@/utils/tools'
import { updateSetting } from '@/core/common'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { AnimatedColorText } from '@/components/common/Text'
import { setSpText } from '@/utils/pixelRatio'
import settingState from '@/store/setting/state'
import playerState from '@/store/player/state'
import { useWindowSize } from '@/utils/hooks'
import KaraokeLyric from '@/screens/PlayDetail/components/KaraokeLyric'
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
  onLayout: (lineNum: number, height: number, width: number, isActive: boolean) => void
  onPress: (index: number) => void
  isSmallWindow?: boolean
  wordsByIndex: ReadonlyArray<LxLyricWord[] | null>
}
const LrcLine = memo(
  ({ line, lineNum, activeLine, onLayout, onPress, isSmallWindow, wordsByIndex }: LineProps) => {
    const theme = useTheme()
    const lrcFontSize = useSettingValue('playDetail.vertical.style.lrcFontSize')
    const textAlign = useSettingValue('playDetail.style.align')
    const isActive = activeLine == lineNum
    const size = lrcFontSize / 10
    const lineHeight = setSpText(size) * 1.3
    // 有逐字时间轴的行始终用卡拉OK渲染器（非激活时静态显示未播放颜色）：
    // 嵌套 Text 与纯文本的换行断点不同，若激活时才切换渲染器，行高会在切行瞬间突变，
    // 造成抖动且实测高度与累计偏移基准不一致、高亮行偏离中心。
    const words = wordsByIndex[lineNum] ?? null

    const colors = useMemo(() => {
      return isActive
        ? ([theme.isDark ? theme['c-font'] : theme['c-primary-font-active'], theme['c-primary-alpha-200'], 1] as const)
        : ([theme['c-450'], theme['c-400'], 0.8] as const)
    }, [isActive, theme])

    // 行布局（字号/字重/行高）与激活状态解耦：激活行仅靠颜色高亮，不再放大加粗。
    // 否则切行瞬间文字变宽 → 换行数变化 → 行高突变，FlatList 重布局 + 回正滚动叠加
    // 造成「换行时抖动」，且激活/非激活两套高度基准不一致会让高亮行偏离居中位置。
    // 仍上报 isActive 供 LyricScrollLayout 记录（激活高度现恒等于非激活高度，两套基准天然一致）。
    const handleLayout = ({ nativeEvent }: LayoutChangeEvent) => {
      onLayout(lineNum, nativeEvent.layout.height, nativeEvent.layout.width, isActive)
    }

    const handlePress = useCallback(() => {
      onPress(lineNum)
    }, [onPress, lineNum])

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={line.text || undefined}
      >
        <View style={[styles.line, isSmallWindow && { paddingTop: 6, paddingBottom: 6 }]} onLayout={handleLayout}>
          {words
            ? (
              <KaraokeLyric
                style={{
                  ...styles.lineText,
                  textAlign,
                  lineHeight,
                  fontWeight: '400',
                  opacity: colors[2],
                }}
                words={words}
                lineTime={line.time}
                size={size}
                isActive={isActive}
                playedColor={colors[0]}
                inactiveColor={theme['c-450']}
              />
              )
            : (
              <AnimatedColorText
                style={{
                  ...styles.lineText,
                  textAlign,
                  lineHeight,
                  fontWeight: '400',
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
                  ...(isSmallWindow && { paddingTop: 2 }),
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
      prevProps.wordsByIndex === nextProps.wordsByIndex &&
      // onLayout 引用稳定（useCallback），无需比较；isSmallWindow 变化时必须放行更新，
      // 否则小屏/大屏切换后行内边距不刷新。
      prevProps.isSmallWindow === nextProps.isSmallWindow
    )
  },
)

export default ({ active = true, pagerHeight = 0 }: { active?: boolean, pagerHeight?: number }) => {
  const lyricLines = useLrcSet()
  const { line } = useLrcPlay()
  // 逐字时间轴（与 lyricLines 同序）：第 i 项为第 i 行歌词的逐字数组；无逐字（纯 LRC）为 null。
  // 激活行据此走逐字卡拉OK渲染，否则退回整行高亮。
  const wordsByIndex = useLrcWordsMap()
  const wordsMapRef = useRef(wordsByIndex)
  wordsMapRef.current = wordsByIndex
  const { height: winHeight } = useWindowSize()
  const isSmallWindow = winHeight < 700
  // 歌词页实际可用高度由父容器（PagerView 子页面）的 onLayout 给出，
  // 不再用 winHeight - HEADER_HEIGHT 估算：后者未扣除状态栏高和底部 Player
  // 控制区高，导致 FlatList 被撑得比歌词页还大，下方被 PagerView 裁剪或顶上去。
  const [pageHeight, setPageHeight] = useState(winHeight > 0 ? Math.max(0, winHeight - 180) : 0)
  // 用 ref 持有最新页面高度：handleScrollToActive 内部多处依赖 pageHeight 计算居中偏移，
  // 而 [active] effect 里延迟的 re-center（rAF / getPosition().then）闭包捕获的是旧渲染的
  // pageHeight（初始估算 winHeight-180），此时真实高度（onLayout）可能尚未到来，
  // 导致切到歌词页时高亮行偶发不居中。改为读 ref，确保延迟定位始终用真实高度。
  const pageHeightRef = useRef(pageHeight)
  const flatListRef = useRef<FlatList>(null)
  // active 页面首次挂载时即可自动定位；只有用户手动拖动歌词时才暂时暂停。
  const isPauseScrollRef = useRef(false)
  const scrollTimoutRef = useRef<NodeJS.Timeout | null>(null)
  const delayScrollTimeout = useRef<NodeJS.Timeout | null>(null)
  // 歌词页是从封面页切换时才挂载；初始值直接取引擎当前行，避免新页面先回到第 0 行。
  const lineRef = useRef({ line: line >= 0 ? line : 0, prevLine: line >= 0 ? line : 0 })
  // 记录上一帧的 active，用于检测“从封面页切回歌词页”的上升沿，
  // 上升沿这一次强制走 force 路径，避免被 [line, active] effect 的“舒适区动画滚动”抢先。
  const activeRef = useRef(active)
  // 缓存歌词行高与累计偏移，把滚动定位从 O(n²) 降到 O(1)。
  const lyricScrollLayoutRef = useRef(new LyricScrollLayout(isSmallWindow ? 40 : 54))
  const scrollCancelRef = useRef<(() => void) | null>(null)
  const scrollYRef = useRef(0)
  // 连续滚动指数平滑：rAF 算出的目标 offset 不直接写入列表，而是让跟随值按固定速率收敛到目标。
  // 逐字歌词「句内停住」模式下两句之间没有间隙时，切行瞬间目标会从当前行中心硬跳到下一行中心
  // （长句换行后行高更大、跳变越明显），行高测量后的回正修正同样是硬跳；
  // 平滑收敛把这些瞬跳都变成约 200ms 的短滑动，消除换行长句切行时的顿挫感。
  const smoothOffsetRef = useRef(0)
  const lastWrittenOffsetRef = useRef(-1)
  const lastFrameTsRef = useRef(0)
  const wasPauseRef = useRef(true)
  // 跳转/首开时大量行尚未测量，定位落地后需在新行完成测量时静默回正一次。
  const recentreTimerRef = useRef<NodeJS.Timeout | null>(null)

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
  // 缩放节流：updateSetting 每次调用都会全量序列化 setting 并写 AsyncStorage，
  // 缩放手势每帧触发会导致连串写盘 + configUpdated 广播，造成掉帧。
  // move 中按 120ms 节流提交（UI 仍平滑跟随），最新期望值暂存 pending，
  // 松手时一次性提交终值，保证最终字号准确落盘。
  const lastZoomCommitRef = useRef(0)
  const pendingZoomSizeRef = useRef<number | null>(null)

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
      newSize = Math.max(100, Math.min(newSize, 300)) // ensure within bounds

      if (settingState.setting['playDetail.vertical.style.lrcFontSize'] === newSize) return
      // 节流提交：间隔内的帧只更新 pending，松手时补交终值，避免每帧写盘。
      pendingZoomSizeRef.current = newSize
      const now = Date.now()
      if (now - lastZoomCommitRef.current >= 120) {
        lastZoomCommitRef.current = now
        updateSetting({ 'playDetail.vertical.style.lrcFontSize': newSize })
      }
    },
    onPanResponderRelease: () => {
      initialDistanceRef.current = 0
      // 松手补交：把节流期间暂存的最终字号落盘，保证手势结束后的字号与用户预期一致。
      const pending = pendingZoomSizeRef.current
      pendingZoomSizeRef.current = null
      if (pending != null && settingState.setting['playDetail.vertical.style.lrcFontSize'] !== pending) {
        updateSetting({ 'playDetail.vertical.style.lrcFontSize': pending })
      }
    },
    onPanResponderTerminate: () => {
      initialDistanceRef.current = 0
      // 手势被系统接管（如来电/通知下拉）时同样补交终值，避免缩放结果丢失。
      const pending = pendingZoomSizeRef.current
      pendingZoomSizeRef.current = null
      if (pending != null && settingState.setting['playDetail.vertical.style.lrcFontSize'] !== pending) {
        updateSetting({ 'playDetail.vertical.style.lrcFontSize': pending })
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
  const getLineIndexForTime = useCallback((time: number) => {
    return findLineIndexByTime(lyricLines, time)
  }, [lyricLines])

  // 歌词高亮行定位：让当前行落在歌词界面【正中央】（等效 viewPosition≈0.5），满足第 5 条同步要求。
  // 第 7 条“高亮行上移一行”已按用户要求取消，故不再额外偏移一个 itemHeight，仅居中。
  // 跨行切换时无条件滚动到该位置，确保播放中高亮行与音频同步且位置一致。
  // 同一行重锚时再用“舒适区 15%”节流，避免逐秒重锚把歌词列表反复微滚动造成抖动。
  // force=true 时无视舒适区，用于切回歌词页 / 切歌 / 拖动进度条 / 点击歌词 / 恢复播放等需要立即定位的场景。
  const lastScrolledLineRef = useRef(-1)
  // useCallback 稳定引用：handleLinePress / scheduleRecentre / 各 effect 依赖它，
  // 若每次渲染重建会让 handleLinePress 引用跟着变，LrcLine 的 memo 比较器
  // （onPress 引用比较）将永远失效，行切换时全部可见行都被迫重渲染。
  const handleScrollToActive = useCallback((index = lineRef.current.line, force = false) => {
    if (index < 0 || !flatListRef.current || isPauseScrollRef.current) return
    if (scrollCancelRef.current) {
      scrollCancelRef.current()
      scrollCancelRef.current = null
    }
    const listHeight = pageHeightRef.current > 0 ? pageHeightRef.current : pagerHeight
    if (listHeight <= 0) return
    // 上下留白必须等于列表高的 50%（与横屏歌词页、与 contentContainerStyle 同源）：
    // 居中偏移 = 留白 + 前序行高累计 + 本行高/2 - 列表高/2，只有留白 >= 50% 时该值才恒落在
    // [0, 最大可滚距离] 区间内。留白为 12% 时，歌曲开头会算出负偏移、结尾会超出最大可滚距离，
    // 两端都被 FlatList 钳制，高亮行只能停在偏上/偏下的位置（两行及以上的长句行高更大，更显眼）。
    const paddingV = pageHeightRef.current > 0 ? pageHeightRef.current * 0.5 : 0
    // 等效 viewPosition:0.5：让高亮行落在歌词界面【正中央】（第 5 条同步要求：高亮行居中）。
    // 第 7 条“高亮行上移一行”已取消，故不再额外偏移一个 itemHeight。
    // 使用精确偏移：已测量行用真实行高，未测量行按「是否有翻译」分档估算，
    // 避免切到歌词页 / 跳到中后段时 FlatList 虚拟化导致之前行未测量、平均估算偏差过大，
    // 高亮行偶发不居中。
    const targetOffset = lyricScrollLayoutRef.current.getTargetOffsetPrecise(index, listHeight, lyricLines, 0.5, paddingV)
    const lineChanged = index !== lastScrolledLineRef.current
    // 非强制 + 同一行 + 当前行已在可视舒适区内（距目标 < 15% 视高）则跳过本次滚动（防抖动）；
    // 跨行切换 / 强制场景无条件滚动到中央，保证高亮行与音频同步且居中。
    if (!force && !lineChanged && Math.abs(targetOffset - scrollYRef.current) < listHeight * 0.15) return
    try {
      // force=true（切回歌词页 / 切歌 / 初次加载 / 拖动 / 点击）时立即定位，不用动画，避免高亮行“姗姗来迟”。
      flatListRef.current.scrollToOffset({ offset: targetOffset, animated: !force })
      lastScrolledLineRef.current = index
      // force 瞬时定位后把平滑跟随值直接对齐目标：连续滚动循环从同一基准出发，
      // 不会把列表拽回旧位置。非 force（动画滚动）不改动跟随值，交给循环平滑收敛。
      if (force) {
        smoothOffsetRef.current = targetOffset
        lastWrittenOffsetRef.current = targetOffset
      }
    } catch { }
  }, [lyricLines, pagerHeight])

  // 连续平滑滚动：基于外推时钟的精确播放时间计算当前应滚动到的偏移。
  // 逐字歌词（有逐字时间轴）时采用「句内暂停、句末再滚」：
  //   - 演唱区间 [curTime, lineEndTime]：高亮行停在【正中央】，歌词不滚动（符合“播放时暂停滚动”）。
  //   - 句末到下一句起的间隙 [lineEndTime, nextTime]：从当前行中心平滑滚动到下一行中心（放完再滚动）。
  // 无逐字歌词（纯 LRC）：句内保持高亮行居中，仅在临近下一句的短窗口（约 0.25~0.7s）内
  // 滚动到下一行中心，与逐字模式观感一致；配合指数平滑，切行也是短滑动而非硬跳。
  // 行级高亮着色仍由 useLrcPlay 的 line 驱动；本函数只负责位置连续（每帧基于精确时间计算）。
  const lastContinuousTimeRef = useRef(-1)
  const scrollToActiveContinuous = (ts: number) => {
    const t = audioClock.getTime() * 1000 // ms
    if (t === lastContinuousTimeRef.current) {
      lastFrameTsRef.current = ts
      return // 暂停/无推进时跳过，避免空转 Bridge 写
    }
    lastContinuousTimeRef.current = t
    if (!flatListRef.current || !lyricLines.length) return
    const listHeight = pageHeightRef.current > 0 ? pageHeightRef.current : pagerHeight
    if (listHeight <= 0) return
    // 与 handleScrollToActive 同源：留白 50% 视高，保证任何一行（含两行以上的长句）都能被精确居中。
    const paddingV = pageHeightRef.current > 0 ? pageHeightRef.current * 0.5 : 0
    let i = findLineIndexByTime(lyricLines, t)
    if (i < 0) i = 0
    // 末位参数 false：连续滚动统一用非激活行高。下一行的激活高度在它真正激活前测不到，
    // 若起点/终点分属「已测得 / 未测得」两套高度，切行瞬间会突跳一下（文字被挤成两行的行最明显）。
    // 统一基准后插值严格连续；居中偏差恒定且仅约半个额外行高，远好于每次切行都顿一下。
    const offsetI = lyricScrollLayoutRef.current.getTargetOffsetPrecise(i, listHeight, lyricLines, 0.5, paddingV, 0, false)
    let continuousOffset = offsetI
    if (i + 1 < lyricLines.length) {
      const curTime = lyricLines[i].time
      const nextTime = lyricLines[i + 1].time
      const offsetNext = lyricScrollLayoutRef.current.getTargetOffsetPrecise(i + 1, listHeight, lyricLines, 0.5, paddingV, 0, false)
      const words = wordsMapRef.current[i] ?? undefined
      if (words?.length) {
        // 逐字歌词：以最后一个字的结束时间作为“本句唱完”的边界。
        const lastW = words[words.length - 1]
        const lineEndTime = curTime + lastW.startTime + lastW.duration
        if (lineEndTime >= nextTime) {
          // 逐字结束点晚于/等于下一句起点：没有可滚动的空闲间隔，
          // 整段保持当前行居中（下一句到来瞬间整体切换），即“播放时暂停滚动”。
          continuousOffset = offsetI
        } else {
          // 演唱区间保持居中；间隙内才滚动到下一句中心（放完再滚动）。
          const progress = nextTime > lineEndTime ? (t - lineEndTime) / (nextTime - lineEndTime) : 0
          continuousOffset = offsetI + Math.min(1, Math.max(0, progress)) * (offsetNext - offsetI)
        }
      } else {
        // 无逐字：句内保持当前行【居中】，仅在临近下一句的短窗口内平滑滚动到下一行中心。
        // 不再整行线性插值——那会让高亮行在行内持续上移、绝大部分时间偏离中心位置。
        const duration = Math.max(nextTime - curTime, 1)
        const scrollWindow = Math.min(Math.max(duration * 0.35, Math.min(250, duration * 0.9)), 700)
        const progress = Math.min(1, Math.max(0, (t - (nextTime - scrollWindow)) / scrollWindow))
        continuousOffset = offsetI + progress * (offsetNext - offsetI)
      }
    }
    // 指数平滑收敛到目标 offset（速率 12/s，约 200ms 收敛 95%）：
    // - 普通推进：目标本身连续，跟随值几乎重合，无感；
    // - 逐字歌词无间隙切行 / 回正修正：目标瞬跳，跟随值平滑滑到新位置，长句切行不再顿挫。
    const dt = lastFrameTsRef.current > 0 ? Math.min(Math.max((ts - lastFrameTsRef.current) / 1000, 0.001), 0.05) : 0.016
    lastFrameTsRef.current = ts
    const delta = continuousOffset - smoothOffsetRef.current
    if (Math.abs(delta) < 0.5) smoothOffsetRef.current = continuousOffset
    else smoothOffsetRef.current += delta * (1 - Math.exp(-dt * 12))
    if (Math.abs(smoothOffsetRef.current - lastWrittenOffsetRef.current) < 0.5) return
    try {
      flatListRef.current.scrollToOffset({ offset: smoothOffsetRef.current, animated: false })
      lastWrittenOffsetRef.current = smoothOffsetRef.current
    } catch { }
  }

  // 跳转/歌词页中途打开时，当前行之前的大量行还没被测量，首跳落点必然有偏差；
  // 等新一批行测量完成（防抖 150ms）后静默回正一次，保证高亮行最终严格居中。
  const scheduleRecentre = useCallback(() => {
    if (recentreTimerRef.current) clearTimeout(recentreTimerRef.current)
    recentreTimerRef.current = setTimeout(() => {
      recentreTimerRef.current = null
      if (!active || isPauseScrollRef.current) return
      // 非 force：测量修正交给连续滚动循环平滑收敛，避免 force 硬跳在长句测量后产生可见顿挫。
      handleScrollToActive(lineRef.current.line)
    }, 150)
  }, [active, handleScrollToActive])
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
      if (recentreTimerRef.current) {
        clearTimeout(recentreTimerRef.current)
        recentreTimerRef.current = null
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
  }, [setForceScroll])

  // 仅歌词内容真正变化（切歌 / 异步歌词到达）时才重置行高缓存并回顶；
  // 从封面页切回歌词页（仅 active 变化）不再 reset，保留已测得的真实行高。
  // 否则进入歌词页时缓存被清空、当前行之前的行退化为估算，高亮行会偶发不居中。
  useEffect(() => {
    lyricScrollLayoutRef.current.reset()
    lastScrolledLineRef.current = -1
    lineRef.current.prevLine = 0
    lineRef.current.line = 0
    if (!flatListRef.current) return
    flatListRef.current.scrollToOffset({ offset: 0, animated: false })
    scrollYRef.current = 0
    // 平滑跟随基准同步归零，避免切歌后循环把列表从旧位置拽回顶部。
    smoothOffsetRef.current = 0
    lastWrittenOffsetRef.current = -1
    lastFrameTsRef.current = 0
    if (!lyricLines.length) return

    // 切歌/异步歌词到达后，必须强制下一次 line 更新时立即定位到当前高亮行。
    // 否则 play/setProgress 事件可能晚于 line 更新，forceScrollRef 仍为 false，
    // 导致高亮行无法居中。
    setForceScroll(true)

    // 歌词内容更新后不再固定延迟 100ms；布局完成的下一帧直接按当前引擎行定位。
    // 这覆盖切歌后异步歌词到达、从封面切回歌词页等场景。
    requestAnimationFrame(() => {
      if (!active) return
      isPauseScrollRef.current = false
      // 用 line（useLrcPlay 当前行）而非 lineRef.current.line（可能残留旧歌行号）
      handleScrollToActive(line >= 0 ? line : 0, true)
    })
  }, [lyricLines, active, handleScrollToActive, line, setForceScroll])

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
    const force = forceScrollRef.current || !activeRef.current
    activeRef.current = active
    // 拖动进度条 / 跳转 / 恢复播放等用户动作（force）期间立即无动画定位；
    // 普通播放推进交给每帧连续滚动循环（scrollToActiveContinuous），实现平滑上移而非逐行跳变。
    if (force) {
      handleScrollToActive(lineRef.current.line, true)
    }
  }, [line, active, handleScrollToActive])

  // 每帧连续平滑滚动循环：歌词页激活且非用户手动滚动时，基于外推时钟精确时间驱动歌词连续上移。
  // iOS 后台 / 锁屏时 rAF 暂停（歌词停滚无妨）；前台播放每帧（~16ms）定位，消除原来的行级跳变。
  useEffect(() => {
    if (!active) return
    let rafId = 0
    const loop = (ts: number) => {
      if (isPauseScrollRef.current) {
        wasPauseRef.current = true
      } else if (flatListRef.current && lyricLines.length) {
        // 从暂停（用户手动滚动/拖动歌词）恢复的首帧：把平滑基准重置为列表真实位置，
        // 避免沿用暂停前的旧基准把列表瞬间拽回去。
        if (wasPauseRef.current) {
          wasPauseRef.current = false
          smoothOffsetRef.current = scrollYRef.current
          lastWrittenOffsetRef.current = scrollYRef.current
          lastFrameTsRef.current = ts
        }
        scrollToActiveContinuous(ts)
      }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(rafId) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lyricLines])

  // 从封面页切回歌词页时，立即把歌词时钟重锚到真实音频位置，并强制把当前行定位到 42% 位置，
  // 避免“长暂停后再播放 / 重开后”高亮行姗姗来迟、与音频不同步。
  useEffect(() => {
    if (!active) return

    // 先用同步的播放进度做一次立即重锚，再按歌词引擎当前行定位；不等待
    // 原生 getPosition Promise，保证切页首个布局帧就显示接近真实位置的高亮行。
    isPauseScrollRef.current = false
    const cachedPosition = playerState.progress.nowPlayTime
    let immediateLine = lineRef.current.line
    if (Number.isFinite(cachedPosition) && cachedPosition >= 0) {
      immediateLine = getLineIndexForTime(cachedPosition * 1000)
      if (immediateLine >= 0) {
        lineRef.current.prevLine = lineRef.current.line
        lineRef.current.line = immediateLine
        try { lrcSyncToTime(cachedPosition * 1000, playerState.isPlay) } catch {}
      }
    }
    setForceScroll(true)
    handleScrollToActive(immediateLine, true)
    requestAnimationFrame(() => {
      handleScrollToActive(lineRef.current.line, true)
    })

    // 再用音频引擎真实位置校正一次，纠正切歌/恢复播放时 store 进度尚未更新的情况。
    void getPosition().then((p) => {
      if (p == null || !playerState.musicInfo.id) return
      try { lrcSyncToTime(p * 1000, playerState.isPlay) } catch {}
      requestAnimationFrame(() => {
        setForceScroll(true)
        handleScrollToActive(lineRef.current.line, true)
      })
    })
  }, [active, getLineIndexForTime, handleScrollToActive, setForceScroll])

  // 页面真实高度（onLayout）到来后用精确高度把高亮行重新定位到中央，
  // 修正首次用估算高度（winHeight-180）计算偏移、导致切到歌词页时高亮行偶发不居中的问题。
  useEffect(() => {
    if (!active || pageHeight <= 0 || isPauseScrollRef.current) return
    handleScrollToActive(lineRef.current.line, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageHeight, active])

  // 仅记录当前滚动偏移，供“舒适区感知滚动”判断使用；不触发重渲染。
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = e.nativeEvent.contentOffset.y
  }, [])

  const handleLineLayout = useCallback<LineProps['onLayout']>((lineNum, height, _width, isActive) => {
    const layout = lyricScrollLayoutRef.current
    const wasMeasured = layout.isMeasured(lineNum)
    // 把该行是否有翻译传给布局，使其未测量行估算能区分「无翻译/有翻译」两类真实平均高度，
    // 避免快进/快退到中后段时高亮行偏高/偏低一行。
    // isActive：激活态高度只用于该行自身定位，不计入累计偏移（见 LyricScrollLayout 说明）。
    layout.updateLineHeight(lineNum, height, !!(lyricLines[lineNum]?.extendedLyrics?.length), isActive)
    if (!active || isPauseScrollRef.current) return
    const current = lineRef.current.line
    // 当前行首次测量（切歌/跳转后激活行真实高度就位），或非激活行首次测量导致累计偏移变化时，
    // 防抖回正：避免跳到中段后估算误差让高亮行一直停在非居中位置。
    if (lineNum === current || (!wasMeasured && lineNum < current)) {
      scheduleRecentre()
    }
  }, [active, scheduleRecentre, lyricLines])

  // 小屏/大屏切换时同步估算行高，保证滚动定位偏移计算准确。
  useEffect(() => {
    lyricScrollLayoutRef.current.setDefaultHeight(isSmallWindow ? 40 : 54)
  }, [isSmallWindow])

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
    const line = lyricLines[index]
    if (line) {
      // 同步重锚歌词时钟，使高亮行立即跟随点击位置（不依赖 app_event 的异步派发，
      // 否则在 iOS 上高亮会滞后/不跟随音频跳转）
      try { lrcSyncToTime(line.time, playerState.isPlay) } catch {}
      // setProgress 内部会真正 seek 音频（setCurrentTime -> seekToTime），
      // 同时把歌词时钟重锚到该行时间，保证音频与该行高亮绝对同步。
      global.app_event.setProgress(line.time / 1000)
    }
    // 用户点击歌词行属于主动跳转：强制让歌词列表立即、无动画地定位到被点行，
    // 越过“舒适区 15%”节流与动画延迟，使高亮行与音频（及进度条）绝对同步跟随。
    setForceScroll(true)
    handleScrollToActive(index, true)
  }, [lyricLines, setForceScroll, handleScrollToActive])

  // useCallback 稳定 renderItem：依赖项均为稳定引用或低频变化值（line 每行切换变化一次），
  // 配合 LrcLine 的 memo 比较器，行切换时只有新旧激活两行重渲染。
  const renderItem: FlatListType['renderItem'] = useCallback(({ item, index }: { item: Line, index: number }) => {
    return <LrcLine line={item} lineNum={index} activeLine={line} onLayout={handleLineLayout} onPress={handleLinePress} isSmallWindow={isSmallWindow} wordsByIndex={wordsByIndex} />
  }, [line, handleLineLayout, handleLinePress, isSmallWindow, wordsByIndex])
  const getkey: FlatListType['keyExtractor'] = (_item, index) => `${index}`

  const handlePageLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    const h = Math.round(nativeEvent.layout.height)
    if (h > 0) {
      pageHeightRef.current = h
      if (h !== pageHeight) setPageHeight(h)
    }
  }, [pageHeight])

  return (
    <View style={{ flex: 1, width: '100%' }} onLayout={handlePageLayout} collapsable={false}>
      <FlatList
        data={lyricLines}
        renderItem={renderItem}
        keyExtractor={getkey}
        style={{ height: pageHeight > 0 ? pageHeight : pagerHeight, width: '100%' }}
        // 歌词列表从顶部排布，当前行由 scrollToOffset(viewPosition 0.5) 定位到【中央】；
        // 不再用 justifyContent:'center' 整体垂直居中——那样是把整个列表当成一个块居中，
        // 歌词少时会整页被顶到中间、上下同时露白（即用户反馈的“被空白遮住 / 下面空白”）。
        // 这里改为「首尾各补 50% 视高留白」：内容仍从顶部开始排布，只是让第一行/最后一行
        // 也有足够空间滚到正中，行为与横屏歌词页一致。留白值必须与滚动计算的 paddingV 相等。
        contentContainerStyle={{
          paddingHorizontal: isSmallWindow ? 12 : 20,
          paddingTop: pageHeight > 0 ? pageHeight * 0.5 : 0,
          paddingBottom: pageHeight > 0 ? pageHeight * 0.5 : 0,
        }}
        ref={flatListRef}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        // 仅记录偏移，不触发重渲染；16ms 让手动滚动轨迹更平滑，同时记录精度更高。
        scrollEventThrottle={16}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        // 首屏把整首歌的歌词行全部渲染一次（而不是只渲染前 60 行）：
        // 每行高度只能由 onLayout 实测，未渲染过的行只能用「已测量行平均高度」估算。
        // 一旦播放中途拖动进度条跳到中后段，FlatList 只会渲染目标附近的窗口，
        // 开头这批行与窗口之间会留下一段“永远不渲染”的行，它们的行高只能靠估算；
        // 只要这段里出现两行及以上的长句（真实行高约为单行的 2 倍），累计偏移就会持续偏差，
        // 表现为高亮行整段偏低/偏高、怎么都回不到正中。全部渲染一次后所有行高均为实测值，
        // 累计偏移无估算误差，高亮行任何情况下都能精确居中（同时消除“歌词不全载”）。
        // 行高实测值会被 LyricScrollLayout 长期缓存，之后 FlatList 正常回收行也不影响精度。
        initialNumToRender={Math.max(lyricLines.length, 60)}
        windowSize={21}
        maxToRenderPerBatch={30}
        updateCellsBatchingPeriod={10}
        // 不向 FlatList 注册 getItemLayout：改用动态测量，避免“虚拟行 + 变高行 + 估算高度”
        // 在滚动时造成的歌词行定位错乱 / 空白缺失（即用户反馈的“滑动时歌词不全载”）。
        // 滚动目标偏移由 LyricScrollLayout 的缓存累计行高计算（O(1)）。
        extraData={[line, wordsByIndex]}
        // 禁用 removeClippedSubviews：iOS FlatList 在动态行高下回收屏幕外行后，
        // 配合 getItemLayout 估算高度常导致歌词行重绘失败 / 出现空白缺失。
        removeClippedSubviews={false}
        {...panResponder.panHandlers}
      />
    </View>
  )
}

const styles = createStyle({
  line: {
    paddingTop: 12,
    paddingBottom: 12,
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
