import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Animated, Easing, Pressable, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useNavActiveId, useSafeAreaBottom } from '@/store/common/hook'
import { setNavActiveId } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { createStyle } from '@/utils/tools'
import { scaleSizeW } from '@/utils/pixelRatio'
import { pulseLiquidGlass } from '@/utils/liquidGlassActivity'
import { useTabBarCollapsed, useMiniPlayerHeight } from '@/utils/tabBarCollapse'
import { setTabBarExpanded } from '@/utils/nativeModules/utils'
import { designRadius, designSpacing, bottomFloatGap } from '@/theme/DesignTokens'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import LiquidGlass from '@/components/common/LiquidGlass'

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
    // 外圈投影已移除（用户反馈胶囊下方有「底子」）：纯玻璃质感，立体感由玻璃
    // 自身边缘光 + 原生 0.5pt 内缘线提供
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

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const activeId = useNavActiveId()
  const safeAreaBottom = useSafeAreaBottom()

  // 深浅色模式均无描边（纯玻璃质感，玻璃材质自带边缘光）
  const barStyle = useMemo(() => styles.bar, [])

  // 主题染色：磨砂覆层基色（不透明主题浅色，明暗自适应）；不透明度独立由
  // theme.glassOpacity 用户设置驱动，实时响应滑杆调节
  const glassTint = useMemo(() => theme['c-primary-light-600'], [theme])
  const glassOpacity = useSettingValue('theme.glassOpacity') / 100

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
          <LiquidGlass tint={glassTint} glassOpacity={glassOpacity} style={{ borderRadius: designRadius.pill }} />
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
        pointerEvents={collapsed ? 'none' : 'auto'}
      >
        {/* 玻璃衬底带与容器一致的圆角：按压下陷内缩时仍呈圆角，不露直角边 */}
        <LiquidGlass tint={glassTint} glassOpacity={glassOpacity} style={{ borderRadius: designRadius.xl }} />
        {TAB_IDS.map((tab) => {
          const isActive = activeId === tab.id
          return (
            <Pressable
              key={tab.id}
              style={styles.item}
              onPress={() => { setNavActiveId(tab.id) }}
            >
              {/* 所有 tab 的图标统一放进同尺寸容器：love 是手绘描边心形，字形只占 1em 的
                  66%×63%，体量天生比别的字体图标小一成多，故放大到 30pt（相邻 21pt）
                  视觉高度才齐平；它仍居中在 24pt 容器里，不会撑高布局把文字顶下去。
                  ⚠️ 这个字号与 SvgIcon.HEART_STROKE_WIDTH 绑定（线宽 = 屏幕线宽*1024/字号），
                  改字号必须回去重算线宽，详见该常量注释与 scripts/sim-tabbar-icon-stroke.js */}
              <View style={styles.iconWrap}>
                <Icon
                  name={tab.icon}
                  size={tab.icon === 'love' ? 30 : 21}
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
      </Animated.View>
    </View>
  )
})
