import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, View, TouchableOpacity } from 'react-native'
import { useHorizontalMode, useKeyboard } from '@/utils/hooks'
import { scaleSizeW } from '@/utils/pixelRatio'
import { useTabBarCollapsed, setMiniPlayerHeight } from '@/utils/tabBarCollapse'
import Pic from './components/Pic'
import Title from './components/Title'
import PlayInfo from './components/PlayInfo'
import ControlBtn from './components/ControlBtn'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { navigations } from '@/navigation'
import { PLAY_DETAIL_SCREEN } from '@/navigation/screenNames'
import commonState from '@/store/common/state'
import { useSafeAreaBottom } from '@/store/common/hook'
import { usePlayerMusicInfo } from '@/store/player/hook'
import playerState from '@/store/player/state'
import { LIST_IDS } from '@/config/constant'
import { designRadius, designSpacing, bottomFloatGap } from '@/theme/DesignTokens'
import { applyOpacity } from '@/utils/colorOpacity'
import { shadow } from '@/utils/shadow'
import { pulseLiquidGlass } from '@/utils/liquidGlassActivity'
import LiquidGlass from '@/components/common/LiquidGlass'

export default memo(({ componentId: _componentId, isHome = false }: { componentId?: string, isHome?: boolean }) => {
  const { keyboardShown } = useKeyboard()
  const isHorizontalMode = useHorizontalMode()
  const theme = useTheme()
  const musicInfo = usePlayerMusicInfo()
  const longPressedRef = useRef(false)
  const navigatingRef = useRef(false)
  const safeAreaBottom = useSafeAreaBottom()

  // 无触摸的内容变化时恢复玻璃渲染（静止时原生渲染时钟是暂停的）：
  // 切歌换封面、换主题、旋转（安全区/横竖屏变化改变玻璃位置与形状）
  useEffect(() => {
    pulseLiquidGlass()
  }, [musicInfo, theme, safeAreaBottom, isHorizontalMode])

  // 主题染色：玻璃材质色跟随 App 主题（同 ModernTabBar）
  const glassTint = useMemo(() => applyOpacity(theme['c-primary-light-600'], 80), [theme])

  // Tab 栏收起时（仅 Home）：迷你播放器下移到收起按钮所在行并左侧让位（对齐参考交互）。
  // 两段式 FLIP：①原位快速淡出；②在完全透明的窗口内把布局一次性切到目标态、transform
  // 补偿定位到旧视觉位置，再淡入并原生驱动滑入目标位。布局跳变只发生在不可见期间，
  // 不会出现"新布局先闪现一帧"的生硬弹跳；玻璃全程只重排一次，无逐帧 resize 采样问题。
  const tabBarCollapsed = useTabBarCollapsed()
  const effectiveCollapsed = isHome && tabBarCollapsed
  // laidOutCollapsed：当前实际生效的布局形态（与视觉目标态解耦，切换发生在透明窗口内）
  const [laidOutCollapsed, setLaidOutCollapsed] = useState(effectiveCollapsed)
  const slideX = useRef(new Animated.Value(0)).current
  const slideY = useRef(new Animated.Value(0)).current
  const fadeAnim = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (effectiveCollapsed === laidOutCollapsed) return
    // 布局切换的那一次重排会让玻璃重新采样，给一次短脉冲保证新帧及时渲染
    pulseLiquidGlass(400)
    const shiftX = scaleSizeW(56) + designSpacing.sm
    const bottomExpanded = safeAreaBottom + (isHome ? (isHorizontalMode ? 76 : designSpacing.xl + 48) : bottomFloatGap)
    const shiftY = bottomExpanded - (safeAreaBottom + bottomFloatGap)
    // 第一段：原位淡出（淡出期间布局/位移的跳变不可观察）
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 90,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return
      // 第二段准备（透明期间完成）：布局切到目标态 + 补偿定位到旧视觉位置
      setLaidOutCollapsed(effectiveCollapsed)
      slideX.setValue(effectiveCollapsed ? -shiftX : shiftX)
      slideY.setValue(effectiveCollapsed ? -shiftY : shiftY)
      // 第三段：淡入并滑向目标位（淡入带短延迟，确保 transform 补偿先生效）
      Animated.parallel([
        Animated.timing(slideX, {
          toValue: 0,
          duration: 240,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(slideY, {
          toValue: 0,
          duration: 240,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 150,
          delay: 40,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start()
    })
  }, [effectiveCollapsed, laidOutCollapsed, slideX, slideY, fadeAnim, safeAreaBottom, isHome, isHorizontalMode])

  const handleLongPress = useCallback(() => {
    longPressedRef.current = true
    const listId = playerState.playMusicInfo.listId
    if (!listId || listId == LIST_IDS.DOWNLOAD) return
    void global.app_event.jumpListPosition()
  }, [])

  const handleNavigate = useCallback(() => {
    if (longPressedRef.current) {
      longPressedRef.current = false
      return
    }
    if (!musicInfo.id) return
    // 防重入：动画进行中忽略连续点击，避免 PlayDetail 被反复压栈导致界面卡死。
    if (navigatingRef.current) return
    const ids = commonState.componentIds
    // 若顶层已是播放详情页，不再重复 push。
    if (ids.length && String(ids[ids.length - 1]?.name) === PLAY_DETAIL_SCREEN) return
    navigatingRef.current = true
    const currentComponentId = ids[ids.length - 1]?.id
    navigations.pushPlayDetailScreen(String(currentComponentId))
    setTimeout(() => {
      navigatingRef.current = false
    }, 600)
  }, [musicInfo.id])

  const playerComponent = useMemo(
    () => {
      // 液态玻璃模式：背景折射由原生 LiquidGlass（vendored LiquidGlassKit）实时渲染，
      // 容器透明、无描边（纯玻璃质感，玻璃材质自带明暗自适应的染色与边缘光），只保留投影。
      const containerStyle = { ...shadow(8) }
      // 首页悬浮态比收起态高出一个 tab 栏高 + 12pt 间距；tab 栏底缝收紧
      // （12→4）后整体同步下移 8，保持与 tab 栏顶的相对间距不变
      const bottomExpanded = safeAreaBottom + (isHome
        ? (isHorizontalMode ? 76 : designSpacing.xl + 48)
        : bottomFloatGap)
      const bottomCollapsed = safeAreaBottom + bottomFloatGap
      return (
        <Animated.View
          style={[
            styles.wrapper,
            {
              bottom: laidOutCollapsed ? bottomCollapsed : bottomExpanded,
              paddingLeft: laidOutCollapsed
                ? designSpacing.lg + scaleSizeW(56) + designSpacing.sm
                : designSpacing.lg,
              opacity: fadeAnim,
              transform: [{ translateX: slideX }, { translateY: slideY }],
            },
            // 关键：wrapper 全宽且盖在收起按钮上层，必须 box-none——否则透明区域
            // 拦截触摸，导致点击收起按钮无效
            { pointerEvents: 'box-none' },
          ]}
        >
          <View
            style={[styles.container, containerStyle, isHorizontalMode ? styles.horizontalContainer : null]}
            onLayout={(e) => { setMiniPlayerHeight(e.nativeEvent.layout.height) }}
          >
            <LiquidGlass tint={glassTint} />
            <TouchableOpacity style={styles.left} onPress={handleNavigate} onLongPress={handleLongPress} activeOpacity={0.8}>
              <Pic />
              <View style={styles.center}>
                <Title />
                <PlayInfo isHome={isHome} />
              </View>
            </TouchableOpacity>
            <View style={styles.right}>
              <ControlBtn />
            </View>
          </View>
        </Animated.View>
      )
    },
    [theme, glassTint, isHome, handleLongPress, handleNavigate, safeAreaBottom, isHorizontalMode, laidOutCollapsed, slideX, slideY, fadeAnim],
  )

  return keyboardShown ? null : playerComponent
})

const styles = createStyle({
  wrapper: {
    // 半透明迷你播放器：绝对定位浮在屏幕底部，上移 18px 不与底边贴合，
    // 留 24 水平边距让胶囊更窄（横向长度减短），"悬浮"在底部两侧。
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: designSpacing.lg,
  },
  container: {
    width: '100%',
    // 胶囊瘦身：垂直内边距 9 → 7，配合封面 46 → 40，整体高度 ~64 → ~54
    paddingVertical: 7,
    paddingLeft: designSpacing.sm,
    paddingRight: designSpacing.sm,
    borderRadius: designRadius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  horizontalContainer: {
    maxWidth: 760,
    alignSelf: 'center',
  },
  left: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  center: {
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 1,
    paddingLeft: 5,
    height: '100%',
    // justifyContent: 'space-evenly',
    // height: 48,
    // backgroundColor: 'rgba(0, 0, 0, .1)',
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 0,
    flexShrink: 0,
    paddingLeft: 5,
    // 播放列表按钮已移除：去掉右侧内边距，播放/下一首贴向胶囊右缘
    // （图标右缘距胶囊边 = container.paddingRight(12) + 图标在 40 热区内的居中留白 8 = 20pt）
    paddingRight: 0,
  },
  // row: {
  //   flexDirection: 'row',
  //   flexGrow: 0,
  //   flexShrink: 0,
  // },
})
