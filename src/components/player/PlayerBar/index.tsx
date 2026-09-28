import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Animated, Easing, View, TouchableOpacity } from 'react-native'
import { useHorizontalMode, useKeyboard } from '@/utils/hooks'
import { scaleSizeW } from '@/utils/pixelRatio'
import { useTabBarCollapsed, setMiniPlayerHeight } from '@/utils/tabBarCollapse'
import Pic from './components/Pic'
import Title from './components/Title'
import PlayInfo from './components/PlayInfo'
import ControlBtn from './components/ControlBtn'
import { createStyle, isIOS26OrAbove } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { navigations } from '@/navigation'
import { PLAY_DETAIL_SCREEN } from '@/navigation/screenNames'
import commonState from '@/store/common/state'
import { useSafeAreaBottom } from '@/store/common/hook'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { designRadius, designSpacing, bottomFloatGap } from '@/theme/DesignTokens'
import { pulseLiquidGlass } from '@/utils/liquidGlassActivity'
import LiquidGlass from '@/components/common/LiquidGlass'

export default memo(({ componentId: _componentId, isHome = false }: { componentId?: string, isHome?: boolean }) => {
  const { keyboardShown } = useKeyboard()
  const isHorizontalMode = useHorizontalMode()
  const theme = useTheme()
  const musicInfo = usePlayerMusicInfo()
  const navigatingRef = useRef(false)
  const safeAreaBottom = useSafeAreaBottom()

  // 无触摸的内容变化时恢复玻璃渲染（静止时原生渲染时钟是暂停的）：
  // 切歌换封面、换主题、旋转（安全区/横竖屏变化改变玻璃位置与形状）
  useEffect(() => {
    pulseLiquidGlass()
  }, [musicInfo, theme, safeAreaBottom, isHorizontalMode])

  // 主题染色：磨砂覆层基色（不透明主题浅色，同 ModernTabBar）；不透明度独立由
  // theme.glassOpacity 用户设置驱动
  const glassTint = useMemo(() => theme['c-primary-light-600'], [theme])
  const glassOpacity = useSettingValue('theme.glassOpacity') / 100
  // 液态玻璃开关：仅 iOS 26+ 生效（低版本/关闭 → 系统磨砂），实时响应设置切换。
  // hook 必须无条件调用（isIOS26OrAbove 是模块常量，用 && 组合而非短路进 hook）
  const liquidGlassSetting = useSettingValue('theme.liquidGlass')
  const liquidGlassOn = isIOS26OrAbove && liquidGlassSetting

  // Tab 栏收起时（仅 Home）：迷你播放器下移到收起按钮所在行并左侧让位（对齐参考交互）。
  // 动画为逐帧收窄：bottom/paddingLeft 两布局属性随 220ms 插值同步变化，胶囊边收窄
  // 边滑入落点。收起/展开过程玻璃逐帧变形，渲染时钟用脉冲保持活跃防旧帧拉伸出黑带
  const tabBarCollapsed = useTabBarCollapsed()
  const effectiveCollapsed = isHome && tabBarCollapsed
  const collapseAnim = useRef(new Animated.Value(effectiveCollapsed ? 1 : 0)).current
  useEffect(() => {
    pulseLiquidGlass(400)
    // bottom/paddingLeft 属布局属性，原生驱动不支持，走 JS 驱动（状态变化低频，开销可忽略）
    Animated.timing(collapseAnim, {
      toValue: effectiveCollapsed ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start()
  }, [effectiveCollapsed, collapseAnim])

  const handleNavigate = useCallback(() => {
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
      // 容器透明、无描边（纯玻璃质感，玻璃材质自带明暗自适应的染色与边缘光）。
      // 外圈投影已移除（用户反馈胶囊下方有「底子」）。
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
              bottom: collapseAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [bottomExpanded, bottomCollapsed],
              }),
              paddingLeft: collapseAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [designSpacing.lg, designSpacing.lg + scaleSizeW(56) + designSpacing.sm],
              }),
            },
            // 关键：wrapper 全宽且盖在收起按钮上层，必须 box-none——否则透明区域
            // 拦截触摸，导致点击收起按钮无效
            { pointerEvents: 'box-none' },
          ]}
        >
          <View
            style={[styles.container, isHorizontalMode ? styles.horizontalContainer : null]}
            onLayout={(e) => { setMiniPlayerHeight(e.nativeEvent.layout.height) }}
          >
            <LiquidGlass tint={glassTint} glassOpacity={glassOpacity} dark={theme.isDark} liquid={liquidGlassOn} style={{ borderRadius: designRadius.xl }} />
            <TouchableOpacity style={styles.left} onPress={handleNavigate} activeOpacity={0.8}>
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
    [glassTint, glassOpacity, liquidGlassOn, theme.isDark, isHome, handleNavigate, safeAreaBottom, isHorizontalMode, collapseAnim],
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
