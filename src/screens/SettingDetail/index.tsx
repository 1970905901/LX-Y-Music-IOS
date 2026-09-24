import { memo, useEffect, useMemo, type ComponentType } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'

import PageContent from '@/components/PageContent'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import LandscapeCentered from '@/components/LandscapeCentered'
import { pop } from '@/navigation'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useSafeAreaBottom, useStatusbarHeight } from '@/store/common/hook'
import { designSpacing } from '@/theme/DesignTokens'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import { type SettingScreenIds } from '@/screens/Home/Views/Setting/Main'
import Basic from '@/screens/Home/Views/Setting/settings/Basic'
import Player from '@/screens/Home/Views/Setting/settings/Player'
import Search from '@/screens/Home/Views/Setting/settings/Search'
import List from '@/screens/Home/Views/Setting/settings/List'
import Sync from '@/screens/Home/Views/Setting/settings/Sync'
import Download from '@/screens/Home/Views/Setting/settings/Download'
import Backup from '@/screens/Home/Views/Setting/settings/Backup'
import Other from '@/screens/Home/Views/Setting/settings/Other'
import About from '@/screens/Home/Views/Setting/settings/About'
import ThemeScreen from '@/screens/Home/Views/Setting/settings/ThemeScreen'
import PlatformScreen from '@/screens/Home/Views/Setting/settings/PlatformScreen'

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

export default memo(({ settingId, componentId }: {
  settingId: SettingScreenIds
  componentId: string
}) => {
  const theme = useTheme()
  const t = useI18n()
  const statusBarHeight = useStatusbarHeight()
  const safeAreaBottom = useSafeAreaBottom()

  useEffect(() => {
    setComponentId(COMPONENT_IDS.SETTING_DETAIL, componentId)
  }, [componentId])

  const ActiveScreen = useMemo(() => (
    SETTING_COMPONENTS[settingId] ?? Basic
  ), [settingId])

  const contentStyle = useMemo(() => ({
    paddingHorizontal: designSpacing.lg,
    paddingTop: designSpacing.sm,
    paddingBottom: designSpacing.xl + safeAreaBottom,
  }), [safeAreaBottom])

  return (
    <PageContent>
      <LandscapeCentered>
        <View style={{ ...styles.header, paddingTop: statusBarHeight }}>
          <TouchableOpacity style={styles.backButton} onPress={() => { void pop(componentId) }}>
            <Icon name="chevron-left" size={20} color={theme['c-font']} />
          </TouchableOpacity>
          <Text size={17} style={styles.title} color={theme['c-font']} numberOfLines={1}>
            {t(`setting_${settingId}`)}
          </Text>
          <View style={styles.headerSpace} />
        </View>
        <ScrollView
          style={styles.content}
          contentContainerStyle={contentStyle}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
        >
          <ActiveScreen />
        </ScrollView>
      </LandscapeCentered>
    </PageContent>
  )
})

const styles = createStyle({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    paddingHorizontal: designSpacing.sm,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '600',
  },
  headerSpace: {
    width: 44,
  },
  content: {
    flex: 1,
  },
})
