import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useNavActiveId, useSafeAreaBottom } from '@/store/common/hook'
import { setNavActiveId } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { createStyle } from '@/utils/tools'
import { scaleSizeW } from '@/utils/pixelRatio'
import { useTabBarCollapsed, useMiniPlayerHeight } from '@/utils/tabBarCollapse'
import { setTabBarExpanded } from '@/utils/nativeModules/utils'
import { designRadius, designSpacing, bottomFloatGap } from '@/theme/DesignTokens'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import LiquidGlass from '@/components/common/LiquidGlass'
import LiquidLens from '@/components/common/LiquidLens'

// Tab 栏非选中项文字/图标色（按主题模式分派，替换 c-450）：
//   - c-450 在玻璃底衬上对比度只有 1.45~2.44:1（AA 4.5:1），且可用背景亮度区间
//     测度仅 2.5%，加厚材质也救不了 → 必须换色；
//   - 两个值均经 scripts/sim-glass-contrast.js 断言5/7 在「全部内置主题 × 背景 ×
//     glassOpacity 全域」验证达标（浅色最坏 5.9:1 / 深色最坏 4.7:1）；
//   - 不动全局 c-450（它服务全 App 次级文字，非玻璃背景上对比度尚可）——只改玻璃场景。
// ⚠️ 与脚本常量 TAB_INACTIVE_LIGHT_V(94) / TAB_INACTIVE_DARK_V(248) 人工同步。
const TAB_INACTIVE_LIGHT = 'rgb(94,94,94)'
const TAB_INACTIVE_DARK = 'rgb(248,248,248)'

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
    // 圆角与透镜一致（designRadius.glass 注释），玻璃衬底同值
    borderRadius: designRadius.glass,
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
  // 深浅色模式均无描边（纯玻璃质感，玻璃材质自带边缘光；覆层为中性色不随主题色）
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

  // 纯玻璃（2026-09-28 定案：玻璃不跟随主题色）：磨砂覆层走原生中性色（浅色白 /
  // 深色黑），浓度由 theme.glassOpacity 用户设置驱动，实时响应滑杆调节；
  // 液态形态走 kit 预设动态色（不传 tint）
  const glassOpacity = useSettingValue('theme.glassOpacity') / 100
  // 非选中项文字/图标色：c-450 在玻璃底衬上对比度只有 1.45~2.44:1（AA 需 4.5:1，
  // 且该色「可用背景亮度区间测度」仅 2.5%，材质救不了），按主题模式分派为经
  // scripts/sim-glass-contrast.js 断言5/7 验证的中性灰。⚠️ 与脚本常量
  // TAB_INACTIVE_LIGHT_V / TAB_INACTIVE_DARK_V 人工同步（脚本有反向指路注释）。
  const tabInactiveColor = theme.isDark ? TAB_INACTIVE_DARK : TAB_INACTIVE_LIGHT
  // 液态玻璃开关：全 iOS 版本生效（开 → vendored Metal 液态玻璃；关 → 系统磨砂）。
  // 实时响应设置切换，原生按 liquid prop 重建背衬并重放缓存的主题属性。
  const liquidGlassOn = useSettingValue('theme.liquidGlass')

  // 收起形态（iOS 26 风格）：歌曲列表滚动离开顶部 → 整条 tab 栏收成左下角
  // 圆形玻璃按钮（宫格图标）；点击按钮弹出，保持展开直到下一次滚动离开顶部。
  const collapsed = useTabBarCollapsed()
  // 圆钮尺寸对齐收起态迷你播放器高度（宽=高保持圆形）；未测量时 56 兜底
  const miniPlayerHeight = useMiniPlayerHeight()
  const pillSize = miniPlayerHeight > 0 ? miniPlayerHeight : scaleSizeW(56)
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

  // 液态透镜（上游 LiquidLensView 的 tab 切换动画，仅液态玻璃开启时渲染）：
  // 点击切 tab → 药丸淡入 + 抬起 morph + 弹簧滑到目标项（加速度挤压/拉伸由
  // 透镜内部 displayLink 跟踪产生，全部原生驱动，JS 只更新目标 x）。关闭液态
  // 玻璃 / 收起态不渲染（tab 切换回到直接变色）。透镜条带铺满 tab 栏，静止态
  // 半透明白色药丸常显在选中 tab 上（上游 resting 状态）。长按/横滑拖拽切页
  // 已整体移除（上游 LiquidGlassKit 无此手势层，2026-09-29 定案）。
  const [barWidth, setBarWidth] = useState(0)
  const lensStyle = useMemo(() => StyleSheet.absoluteFill, [])
  const handleLensBarLayout = useCallback((e: LayoutChangeEvent) => {
    setBarWidth(e.nativeEvent.layout.width)
  }, [])
  const activeIndex = Math.max(TAB_IDS.findIndex((tab) => tab.id === activeId), 0)
  // 药丸目标中心 = 目标 tab 的中点；首次设置直接落位（不显形），之后原生弹簧滑动
  const lensX = barWidth > 0 ? ((activeIndex + 0.5) * barWidth) / TAB_IDS.length : 0
  // 药丸压扁（2026-09-29 定案）：宽度恒 = 一个 tab 区间的宽度 → 无论停在哪个 tab
  // 形状都一样；最左/最右 tab 时药丸左右边缘恰与胶囊（栏体玻璃）左右边缘重叠，
  // 上下边缘随条带铺满栏体高度而重叠（透镜与胶囊融合成一块玻璃）。圆角由原生取
  // min(宽,高)/2 = 28 = 栏体圆角，端头观感不变。
  const lensPillWidth = barWidth / TAB_IDS.length

  return (
    <View
      style={[
        styles.wrapper,
        { paddingBottom: safeAreaBottom + bottomFloatGap },
      ]}
      pointerEvents="box-none"
    >
      {/* 收起态圆形玻璃按钮（宫格图标）：点击弹出完整 tab 栏；尺寸对齐迷你播放器高度。
          玻璃必须直接挂在动画容器下（与展开态 tab 栏同构），不能包进 Pressable——
          玻璃被 Pressable 包裹时收起圆钮显不出玻璃质感 */}
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
        <LiquidGlass glassOpacity={glassOpacity} dark={theme.isDark} liquid={liquidGlassOn} style={{ borderRadius: designRadius.pill }} />
        <Pressable style={styles.pillInner} onPress={handlePillPress}>
          <View style={styles.pillIcon} pointerEvents="none">
            <Icon name="menu" size={20} color={theme['c-primary']} />
          </View>
        </Pressable>
      </Animated.View>
      {/* 完整 tab 栏：列表在顶部或手动展开时显示，收起时下滑淡出且不再响应触摸 */}
      <Animated.View
        onLayout={handleLensBarLayout}
        style={[
          barStyle,
          {
            opacity: collapseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            transform: [{ translateY: collapseAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 28] }) }],
          },
        ]}
        pointerEvents={collapsed ? 'none' : 'auto'}
      >
        {/* 玻璃衬底带与容器一致的圆角：按压下陷内缩时仍呈圆角，不露直角边。
            圆角 28 = 透镜圆角（56 药丸的胶囊半高，见 LiquidLensView），2026-09-29
            起玻璃端头曲线统一 circular，观感与透镜一致 */}
        <LiquidGlass glassOpacity={glassOpacity} dark={theme.isDark} liquid={liquidGlassOn} style={{ borderRadius: designRadius.glass }} />
        {/* 液态透镜药丸（tab 切换动画）：玻璃之上、tab 内容之下；快速点击走
            Pressable 切页，透镜动画由原生弹簧驱动 */}
        {liquidGlassOn && !collapsed && barWidth > 0 && (
          <LiquidLens
            style={lensStyle}
            x={lensX}
            pillWidth={lensPillWidth}
          />
        )}
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
                  color={isActive ? theme['c-primary'] : tabInactiveColor}
                />
              </View>
              <Text
                style={styles.label}
                size={12}
                color={isActive ? theme['c-primary'] : tabInactiveColor}
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
