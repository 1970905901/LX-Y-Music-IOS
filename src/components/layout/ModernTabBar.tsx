import { memo, useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useNavActiveId, useSafeAreaBottom } from '@/store/common/hook'
import { useSettingValue } from '@/store/setting/hook'
import { setNavActiveId } from '@/core/common'
import { createStyle } from '@/utils/tools'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
import { shadow } from '@/utils/shadow'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'

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
    borderWidth: 0.8,
    ...shadow(8),
    overflow: 'hidden',
  },
  item: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 选中态整格遮罩：绝对定位垫在图标/文字下层，覆盖整个 tab 格。
  // 不能用带高度的底衬 View 包图标——那会在选中时把文字向下顶出，造成“文字跑到遮罩下方”。
  activeMask: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: designRadius.md,
  },
  label: {
    marginTop: 2,
    fontWeight: '600',
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
  // 视觉与迷你播放器同源：底色/描边跟随 theme.miniPlayerOpacity 半透明，深浅色分别以黑/白为基色
  const miniPlayerOpacity = useSettingValue('theme.miniPlayerOpacity')
  const opacity = (Number(miniPlayerOpacity) || 0) / 100
  const bgRgb = theme.isDark ? '0, 0, 0' : '255, 255, 255'

  const barStyle = useMemo(
    () => StyleSheet.compose(styles.bar, {
      backgroundColor: `rgba(${bgRgb}, ${Math.min(1, opacity)})`,
      borderColor: `rgba(${bgRgb}, ${Math.min(0.8, opacity * 0.7 + 0.15)})`,
    }),
    [bgRgb, opacity],
  )

  const activeMaskStyle = useMemo(
    () => StyleSheet.compose(styles.activeMask, {
      backgroundColor: theme['c-primary-background'],
    }),
    [theme],
  )

  return (
    <View
      style={[
        styles.wrapper,
        { paddingBottom: safeAreaBottom + designSpacing.sm },
      ]}
      pointerEvents="box-none"
    >
      <View style={barStyle}>
        {TAB_IDS.map((tab) => {
          const isActive = activeId === tab.id
          return (
            <Pressable
              key={tab.id}
              style={styles.item}
              onPress={() => setNavActiveId(tab.id)}
            >
              {isActive ? <View style={activeMaskStyle} pointerEvents="none" /> : null}
              <Icon
                name={tab.icon}
                size={21}
                color={isActive ? theme['c-primary'] : theme['c-font-label']}
              />
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
