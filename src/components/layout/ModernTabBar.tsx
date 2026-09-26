import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useNavActiveId, useSafeAreaBottom } from '@/store/common/hook'
import { setNavActiveId } from '@/core/common'
import { createStyle } from '@/utils/tools'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
import { shadow } from '@/utils/shadow'
import { pulseLiquidGlass } from '@/utils/liquidGlassActivity'
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
  // 深色模式下去掉描边（避免玻璃边缘出现黑线），浅色模式保留白色细描边
  // （无独立样式，见 barStyle）
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
const LENS_PILL_WIDTH = 52

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const activeId = useNavActiveId()
  const safeAreaBottom = useSafeAreaBottom()

  // 深浅色模式均无描边（纯玻璃质感，玻璃材质自带边缘光）
  const barStyle = useMemo(() => styles.bar, [])

  // 无触摸的内容变化时恢复玻璃渲染（静止时原生渲染时钟是暂停的）：
  // 切 Tab 会整体替换背后内容，换主题会改变玻璃外观
  useEffect(() => {
    pulseLiquidGlass()
  }, [activeId, theme])

  // 透镜药丸：替换旧的主色高亮遮罩（iOS 26 风格）。切 Tab 时药丸原生弹簧滑动
  // 到目标项，按压时 morph 成完整液态玻璃。
  const [barWidth, setBarWidth] = useState(0)
  const [lifted, setLifted] = useState(false)

  const handleBarLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    setBarWidth(e.nativeEvent.layout.width)
  }, [])

  const activeIndex = Math.max(0, TAB_IDS.findIndex((tab) => tab.id === activeId))
  const itemWidth = barWidth > 0 ? barWidth / TAB_IDS.length : 0
  const lensX = itemWidth * activeIndex + itemWidth / 2
  const lensStripHeight = scaleSizeH(BAR_HEIGHT - LENS_VERTICAL_INSET * 2)

  const handlePressIn = useCallback(() => {
    setLifted(true)
  }, [])
  const handlePressOut = useCallback(() => {
    setLifted(false)
  }, [])

  return (
    <View
      style={[
        styles.wrapper,
        { paddingBottom: safeAreaBottom + designSpacing.sm },
      ]}
      pointerEvents="box-none"
    >
      <View style={barStyle} onLayout={handleBarLayout}>
        <LiquidGlass />
        {/* 透镜药丸条带：垫在 tab 内容之下，切 Tab 时原生弹簧滑动，按压时液态变形 */}
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
            lifted={lifted}
            pillWidth={scaleSizeW(LENS_PILL_WIDTH)}
          />
        ) : null}
        {TAB_IDS.map((tab) => {
          const isActive = activeId === tab.id
          return (
            <Pressable
              key={tab.id}
              style={styles.item}
              onPress={() => { setNavActiveId(tab.id) }}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
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
      </View>
    </View>
  )
})
