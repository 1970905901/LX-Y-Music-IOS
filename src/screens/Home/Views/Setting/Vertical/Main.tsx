import { memo, useCallback, useMemo, useState, useEffect, type ComponentType } from 'react'
import { ScrollView, View } from 'react-native'
import { subscribeScrollLock } from '@/utils/scrollLock'

import Basic from '../settings/Basic'
import Player from '../settings/Player'
import Search from '../settings/Search'
import List from '../settings/List'
import Sync from '../settings/Sync'
import Download from '../settings/Download'
import Backup from '../settings/Backup'
import Other from '../settings/Other'
import About from '../settings/About'
import ThemeScreen from '../settings/ThemeScreen'
import PlatformScreen from '../settings/PlatformScreen'
import { createStyle } from '@/utils/tools'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { SETTING_SCREENS, type SettingScreenIds } from '../Main'
import { useSafeAreaBottom } from '@/store/common/hook'
import Text from '@/components/common/Text'
import PageHeader from '@/components/common/PageHeader'

const SETTING_COMPONENTS: Record<SettingScreenIds, ComponentType> = {
  theme: ThemeScreen,
  platform: PlatformScreen,
  player: Player,
  search: Search,
  list: List,
  download: Download,
  sync: Sync,
  backup: Backup,
  other: Other,
  about: About,
  basic: Basic,
}

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const safeAreaBottom = useSafeAreaBottom()
  const [activeId, setActiveId] = useState<SettingScreenIds>(
    global.lx.settingActiveId as SettingScreenIds,
  )
  const [scrollLocked, setScrollLocked] = useState(false)

  useEffect(() => subscribeScrollLock(setScrollLocked), [])

  const ActiveScreen = useMemo(() => {
    return SETTING_COMPONENTS[activeId] ?? Basic
  }, [activeId])

  const handleChangeId = useCallback((id: SettingScreenIds) => {
    setActiveId(id)
    global.lx.settingActiveId = id
  }, [])

  const chipStyle = useCallback((isActive: boolean) => ({
    backgroundColor: isActive
      ? theme['c-primary']
      : theme['c-primary-light-900-alpha-200'],
    borderColor: isActive ? theme['c-primary'] : theme['c-border-background'],
  }), [theme])

  const contentContainer = useMemo(() => ({
    paddingHorizontal: designSpacing.lg,
    paddingTop: designSpacing.sm,
    paddingBottom: designSpacing.xl + safeAreaBottom,
  }), [safeAreaBottom])

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.content}
        contentContainerStyle={contentContainer}
        keyboardShouldPersistTaps="always"
        scrollEnabled={!scrollLocked}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader title={t('nav_setting')} />
        <ScrollView
          style={styles.navScroll}
          contentContainerStyle={styles.navContent}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
        >
          {SETTING_SCREENS.map((id) => {
            const isActive = id === activeId
            return (
              <Text
                key={id}
                size={designTypography.caption}
                color={isActive ? theme['c-primary-light-1000'] : theme['c-font']}
                style={[styles.navItem, chipStyle(isActive)]}
                onPress={() => { handleChangeId(id) }}
              >
                {t(`setting_${id}`)}
              </Text>
            )
          })}
        </ScrollView>
        <ActiveScreen />
      </ScrollView>
    </View>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  navScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  navContent: {
    paddingHorizontal: designSpacing.lg,
    paddingVertical: designSpacing.sm,
  },
  navItem: {
    minHeight: 34,
    lineHeight: 32,
    paddingHorizontal: designSpacing.md,
    marginRight: designSpacing.sm,
    borderWidth: 1,
    borderRadius: designRadius.pill,
    fontWeight: '600',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
  },
})
