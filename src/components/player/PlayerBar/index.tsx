import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Animated, Easing, View, TouchableOpacity } from 'react-native'
import { useHorizontalMode, useKeyboard } from '@/utils/hooks'
import { scaleSizeW } from '@/utils/pixelRatio'
import { useTabBarCollapsed, setMiniPlayerHeight } from '@/utils/tabBarCollapse'
import Pic from './components/Pic'
import Title from './components/Title'
import PlayInfo from './components/PlayInfo'
import ControlBtn from './components/ControlBtn'
import { createStyle, isIOS26_2OrAbove } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { navigations } from '@/navigation'
import { PLAY_DETAIL_SCREEN } from '@/navigation/screenNames'
import commonState from '@/store/common/state'
import { useSafeAreaBottom, useScreenCovered, useAppActive } from '@/store/common/hook'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { designRadius, designSpacing, bottomFloatGap } from '@/theme/DesignTokens'
import LiquidGlass from '@/components/common/LiquidGlass'

export default memo(({ componentId, isHome = false }: { componentId?: string, isHome?: boolean }) => {
  // 省电门：本屏被压栈页覆盖（栈顶不是本屏）时暂停玻璃 Metal 渲染循环。
  // PlayerBar 多屏复用（Home / 专辑页 / 歌手页…），按各自 componentId 判定；
  // 调用方未传 componentId 时恒不门控（行为同旧版）。
  const screenCovered = useScreenCovered(componentId)
  // 省电门之二：App 退到后台/锁屏时也暂停玻璃 Metal 渲染循环——边听歌边锁屏时本页仍
  // 常驻，MTKView 连续渲染不会随锁屏自动停（详见 ModernTabBar 同处注释）。
  const appActive = useAppActive()
  const glassPaused = screenCovered || !appActive
  const { keyboardShown } = useKeyboard()
  const isHorizontalMode = useHorizontalMode()
  const theme = useTheme()
  const musicInfo = usePlayerMusicInfo()
  const navigatingRef = useRef(false)
  const safeAreaBottom = useSafeAreaBottom()

  // 纯玻璃（不跟随主题色）：磨砂覆层走原生中性色，浓度由 theme.glassOpacity 驱动；
  // 液态形态走 kit 预设动态色（不传 tint）
  const glassOpacity = useSettingValue('theme.glassOpacity') / 100
  // 液态玻璃开关：仅 iOS 14~26.1 生效（开 → vendored Metal 液态玻璃；关 → 系统
  // 磨砂），实时响应设置切换。**26.2+ 强制磨砂**（2026-09-30 定案）：UIGlassEffect
  // (.regular) 在白底/图底页面切换瞬间闪烁，开关已从设置页隐藏，残留的开关值在此
  // 屏蔽。最终兜底在 LiquidGlass 组件内部。
  const liquidGlassOn = useSettingValue('theme.liquidGlass') && !isIOS26_2OrAbove
  // 「Tab 栏距离」（0~100，默认 100 = 当前距离）：调节首页展开态迷你播放器与底部
  // Tab 栏之间的间距；0 = 贴在 Tab 栏上，100 = 现在的间距。
  // 间距是固定 token（与字体大小无关），滑杆只在 0~最大值之间缩放它。
  const tabBarDistance = useSettingValue('theme.tabBarDistance')

  // Tab 栏收起时（仅 Home）：迷你播放器下移到收起按钮所在行并左侧让位（对齐参考交互）。
  // 动画为逐帧收窄：bottom/paddingLeft 两布局属性随 220ms 插值同步变化，胶囊边收窄
  // 边滑入落点。收起/展开过程玻璃逐帧变形（背景捕获的动画跟踪由引擎内建）。
  const tabBarCollapsed = useTabBarCollapsed()
  const effectiveCollapsed = isHome && tabBarCollapsed
  const collapseAnim = useRef(new Animated.Value(effectiveCollapsed ? 1 : 0)).current
  useEffect(() => {
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
      // 首页悬浮态 = 收起态底缝 + Tab 栏高度 + 与 Tab 栏的间距（可调）。
      // 手机：底缝 4 + 栏高 64 + 间距 12 = 80；iPad 横屏：底缝 4 + 栏高 64 + 间距 8 = 76
      // —— 与历史硬编码值完全一致，默认（100）外观不变。
      const TAB_BAR_BAND_HEIGHT = 64
      const maxGap = isHorizontalMode ? 8 : 12
      const gapRatio = Math.min(Math.max(Number(tabBarDistance) || 0, 0), 100) / 100
      const bottomExpanded = safeAreaBottom + (isHome
        ? (bottomFloatGap + TAB_BAR_BAND_HEIGHT + maxGap * gapRatio)
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
            style={styles.container}
            onLayout={(e) => { setMiniPlayerHeight(e.nativeEvent.layout.height) }}
          >
            <LiquidGlass glassOpacity={glassOpacity} dark={theme.isDark} liquid={liquidGlassOn} paused={glassPaused} style={{ borderRadius: designRadius.glass }} />
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
    [glassOpacity, liquidGlassOn, glassPaused, theme.isDark, isHome, handleNavigate, safeAreaBottom, isHorizontalMode, collapseAnim, tabBarDistance],
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
    // 圆角与透镜一致（designRadius.glass = 28 = 透镜胶囊半高；高 ~54 下渲染
    // 收敛为标准胶囊，端头与透镜同观感）
    borderRadius: designRadius.glass,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    // 横屏不再限宽 760 居中：底部悬浮的 tab 栏（ModernTabBar）横屏是全宽，
    // 迷你播放器限宽后比 tab 栏短一大截（iPad 横屏两侧各空 ~200pt），两个
    // 底部悬浮条左右端不对齐、观感「长度不够」。去掉限宽后与 tab 栏同宽
    // 同位（left/right 24 边距对齐），竖屏行为不变（本就 100%）。
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
