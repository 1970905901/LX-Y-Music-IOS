import { memo, useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useNavActiveId, useSafeAreaBottom } from '@/store/common/hook'
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
    borderWidth: 1,
    ...shadow(10),
    overflow: 'hidden',
  },
  item: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeItem: {
    width: 62,
    height: 46,
    borderRadius: designRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
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

  const barStyle = useMemo(
    () => StyleSheet.compose(styles.bar, {
      backgroundColor: theme['c-content-background'],
      borderColor: theme['c-border-background'],
    }),
    [theme],
  )

  const activeItemStyle = useMemo(
    () => StyleSheet.compose(styles.activeItem, {
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
              <View style={isActive ? activeItemStyle : null}>
                <Icon
                  name={tab.icon}
                  size={21}
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
