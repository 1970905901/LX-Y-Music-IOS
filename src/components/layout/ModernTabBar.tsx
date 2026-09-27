import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Pressable, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useNavActiveId, useSafeAreaBottom } from '@/store/common/hook'
import { setNavActiveId } from '@/core/common'
import { createStyle } from '@/utils/tools'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'
import { applyOpacity } from '@/utils/colorOpacity'
import { shadow } from '@/utils/shadow'
import { pulseLiquidGlass } from '@/utils/liquidGlassActivity'
import { useTabBarCollapsed, useMiniPlayerHeight } from '@/utils/tabBarCollapse'
import { setTabBarExpanded } from '@/utils/nativeModules/utils'
import { designRadius, designSpacing, bottomFloatGap } from '@/theme/DesignTokens'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import LiquidGlass from '@/components/common/LiquidGlass'
import LiquidLens from '@/components/common/LiquidLens'

const styles = createStyle({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: designSpacing.lg,
  },
  bar: {
    // 与迷你播放条胶囊(~54)接近的纤细高度；透镜条带高度按 BAR_HEIGHT 推导
    height: 56,
    flexDirection: 'row',
    borderRadius: designRadius.xl,
    ...shadow(8),
    overflow: 'hidden',
  },
  item: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 深浅色模式均无描边（纯玻璃质感，玻璃材质自带边缘光）——染色/描边见 barStyle 与 glassTint
  pillWrapper: {
    position: 'absolute',
    left: designSpacing.lg,
    // 宽=高，运行时对齐迷你播放器高度（见 pillSize）
  },
  pillInner: {
    width: '100%',
    height: '100%',
    borderRadius: designRadius.pill,
    overflow: 'hidden',
    ...shadow(6),
  },
  pillIcon: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 2,
    fontWeight: '600',
  },
  iconWrap: {
    height: 24,
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

const TAB_IDS = [
  { id: 'nav_discovery', icon: 'home' },
  { id: 'nav_songlist', icon: 'album' },
  { id: 'nav_search', icon: 'search-2' },
  { id: 'nav_love', icon: 'love' },
  { id: 'nav_setting', icon: 'setting' },
] as const

const TAB_LABEL_KEYS: Record<(typeof TAB_IDS)[number]['id'], string> = {
  nav_discovery: 'nav_discovery',
  nav_songlist: 'discovery_tab_discover',
  nav_search: 'nav_search',
  nav_love: 'discovery_tab_playlists',
  nav_setting: 'nav_setting',
}

const BAR_HEIGHT = 56
// 透镜条带与 tab 栏玻璃同高（上下不留内缩）：切换/拖拽时透镜胶囊与栏体
// 圆角边沿完全对齐，观感是"栏体玻璃的一部分"而非浮在栏上的独立贴片
const LENS_VERTICAL_INSET = 0

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const activeId = useNavActiveId()
  const safeAreaBottom = useSafeAreaBottom()

  // 深浅色模式均无描边（纯玻璃质感，玻璃材质自带边缘光）
  const barStyle = useMemo(() => styles.bar, [])

  // 主题染色：玻璃材质色跟随 App 主题（如绿主题 → 淡绿磨砂玻璃）。
  // 用不透明的主题浅色（c-primary-light-600）× 85%：shader 有效混合度 =
  // alpha × 0.8 ≈ 0.68，对齐上游 .regular 预设的磨砂强度（染色过弱时
  // 深色内容会从玻璃后直接透出，视觉上如同闪黑）。
  const glassTint = useMemo(() => applyOpacity(theme['c-primary-light-600'], 80), [theme])

  // 无触摸的内容变化时恢复玻璃渲染（静止时原生渲染时钟是暂停的）：
  // 切 Tab 会整体替换背后内容（页面切换动画约 300ms，脉冲 500ms 足够覆盖，
  // 之前默认 1200ms 让两块玻璃多空转捕获 0.7s——切 Tab 卡顿来源之一）；
  // 换主题的色彩过渡更长，保留长脉冲。
  useEffect(() => {
    pulseLiquidGlass(500)
  }, [activeId])
  useEffect(() => {
    pulseLiquidGlass(1200)
  }, [theme])

  // 透镜药丸：替换旧的主色高亮遮罩（iOS 26 风格）。切 Tab 时药丸原生弹簧滑动
  // 到目标项；长按 0.35s 立即选中按住的 tab、抬起后可拖动，或按住 tab 直接横向
  // 滑动切到目标 tab（透镜跟手 + 挤压/拉伸，原生手势驱动，点击切换不受影响）。
  const [barWidth, setBarWidth] = useState(0)

  const handleBarLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    setBarWidth(e.nativeEvent.layout.width)
  }, [])

  const handleDragSelect = useCallback((e: { nativeEvent: { index: number } }) => {
    const tab = TAB_IDS[e.nativeEvent.index]
    if (tab) setNavActiveId(tab.id)
  }, [])

  const activeIndex = Math.max(0, TAB_IDS.findIndex((tab) => tab.id === activeId))
  const itemWidth = barWidth > 0 ? barWidth / TAB_IDS.length : 0
  const lensX = itemWidth * activeIndex + itemWidth / 2
  const lensStripHeight = scaleSizeH(BAR_HEIGHT - LENS_VERTICAL_INSET * 2)
  // 胶囊透镜横向宽度 = 栏宽均分（5 个 tab 等分，与 tab 项边界对齐）；
  // 高度即条带高度（与栏体同高），圆角与 tab 栏圆角一致（经样式 borderRadius
  // 传入原生，透镜呈与栏体圆角对齐的圆角矩形）
  const lensPillWidth = itemWidth > 0 ? itemWidth : scaleSizeW(52)

  // 收起形态（iOS 26 风格）：歌曲列表滚动离开顶部 → 整条 tab 栏收成左下角
  // 圆形玻璃按钮（宫格图标）；点击按钮弹出，保持展开直到下一次滚动离开顶部。
  const collapsed = useTabBarCollapsed()
  // 圆钮尺寸对齐收起态迷你播放器高度（宽=高保持圆形）；未测量时 56 兜底
  const miniPlayerHeight = useMiniPlayerHeight()
  const pillSize = miniPlayerHeight > 0 ? miniPlayerHeight : scaleSizeW(56)
  const collapseAnim = useRef(new Animated.Value(collapsed ? 1 : 0)).current
  useEffect(() => {
    // 收起/展开过程玻璃容器逐帧变形：渲染时钟若保持暂停会拉伸旧帧、原生玻璃
    // 采样也可能脱帧（边缘出黑带），给一次覆盖整个动画时长的渲染脉冲
    pulseLiquidGlass(400)
    Animated.timing(collapseAnim, {
      toValue: collapsed ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start()
  }, [collapsed, collapseAnim])

  const handlePillPress = useCallback(() => {
    setTabBarExpanded()
  }, [])

  return (
    <View
      style={[
        styles.wrapper,
        { paddingBottom: safeAreaBottom + bottomFloatGap },
      ]}
      pointerEvents="box-none"
    >
      {/* 收起态圆形玻璃按钮（宫格图标）：点击弹出完整 tab 栏；尺寸对齐迷你播放器高度 */}
      <Animated.View
        style={[
          styles.pillWrapper,
          {
            bottom: safeAreaBottom + bottomFloatGap,
            width: pillSize,
            height: pillSize,
            opacity: collapseAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
            transform: [{ scale: collapseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
          },
        ]}
        pointerEvents={collapsed ? 'auto' : 'none'}
      >
        <Pressable style={styles.pillInner} onPress={handlePillPress}>
          <LiquidGlass tint={glassTint} style={{ borderRadius: designRadius.pill }} />
          <View style={styles.pillIcon} pointerEvents="none">
            <Icon name="menu" size={20} color={theme['c-primary']} />
          </View>
        </Pressable>
      </Animated.View>
      {/* 完整 tab 栏：列表在顶部或手动展开时显示，收起时下滑淡出且不再响应触摸 */}
      <Animated.View
        style={[
          barStyle,
          {
            opacity: collapseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            transform: [{ translateY: collapseAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 28] }) }],
          },
        ]}
        onLayout={handleBarLayout}
        pointerEvents={collapsed ? 'none' : 'auto'}
      >
        {/* 玻璃衬底带与容器一致的圆角：按压下陷内缩时仍呈圆角，不露直角边 */}
        <LiquidGlass tint={glassTint} style={{ borderRadius: designRadius.xl }} />
        {TAB_IDS.map((tab) => {
          const isActive = activeId === tab.id
          return (
            <Pressable
              key={tab.id}
              style={styles.item}
              onPress={() => { setNavActiveId(tab.id) }}
            >
              {/* 所有 tab 的图标统一放进同尺寸容器：love 字形占位偏小需放大一档，
                  但不能让它撑高布局把文字顶下去（与其他 tab 错位） */}
              <View style={styles.iconWrap}>
                <Icon
                  name={tab.icon}
                  size={tab.icon === 'love' ? 24 : 21}
                  color={isActive ? theme['c-primary'] : theme['c-font-label']}
                />
              </View>
              <Text
                style={styles.label}
                size={12}
                color={isActive ? theme['c-primary'] : theme['c-font-label']}
                numberOfLines={1}
              >
                {t(TAB_LABEL_KEYS[tab.id])}
              </Text>
            </Pressable>
          )
        })}
        {/* 透镜药丸条带：置于 tab 内容【之上】——抬起/滑动时玻璃罩住图标与文字，
            内容经折射进入透镜（kit 的 tab 透镜效果）；触摸穿透不影响 tab 点击 */}
        {barWidth > 0 ? (
          <LiquidLens
            style={{
              position: 'absolute',
              top: scaleSizeH(LENS_VERTICAL_INSET),
              left: 0,
              width: barWidth,
              height: lensStripHeight,
              borderRadius: designRadius.xl,
            }}
            x={lensX}
            tabCount={TAB_IDS.length}
            tint={glassTint}
            onDragSelect={handleDragSelect}
            pillWidth={lensPillWidth}
          />
        ) : null}
      </Animated.View>
    </View>
  )
})
