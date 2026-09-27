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
import { useTabBarCollapsed } from '@/utils/tabBarCollapse'
import { setTabBarExpanded } from '@/utils/nativeModules/utils'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
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
    height: 64,
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
    width: scaleSizeW(56),
    height: scaleSizeW(56),
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

const BAR_HEIGHT = 64
const LENS_VERTICAL_INSET = 6

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
  // 切 Tab 会整体替换背后内容，换主题会改变玻璃外观
  useEffect(() => {
    pulseLiquidGlass()
  }, [activeId, theme])

  // 透镜药丸：替换旧的主色高亮遮罩（iOS 26 风格）。切 Tab 时药丸原生弹簧滑动
  // 到目标项；长按 0.35s 抬起后可拖动（透镜跟手 + 挤压/拉伸），松手落点所在
  // tab 被选中（原生手势驱动，点击切换不受影响）。
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
  // 胶囊透镜覆盖整个 tab 项（图标 + 文字，对齐参考视频），左右各留 6px 间隙；
  // 高度即条带高度，圆角自动取高度一半呈胶囊两端
  const lensPillWidth = scaleSizeW(52)

  // 收起形态（iOS 26 风格）：歌曲列表滚动离开顶部 → 整条 tab 栏收成左下角
  // 圆形玻璃按钮（宫格图标）；点击按钮弹出，保持展开直到下一次滚动离开顶部。
  const collapsed = useTabBarCollapsed()
  const collapseAnim = useRef(new Animated.Value(collapsed ? 1 : 0)).current
  useEffect(() => {
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
        { paddingBottom: safeAreaBottom + designSpacing.sm },
      ]}
      pointerEvents="box-none"
    >
      {/* 收起态圆形玻璃按钮（宫格图标）：点击弹出完整 tab 栏 */}
      <Animated.View
        style={[
          styles.pillWrapper,
          {
            bottom: safeAreaBottom + designSpacing.sm,
            opacity: collapseAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
            transform: [{ scale: collapseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
          },
        ]}
        pointerEvents={collapsed ? 'auto' : 'none'}
      >
        <Pressable style={styles.pillInner} onPress={handlePillPress}>
          <LiquidGlass />
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
        <LiquidGlass tint={glassTint} />
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
