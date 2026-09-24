import { memo, useCallback, useMemo } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import { createStyle } from '@/utils/tools'
import { designSpacing } from '@/theme/DesignTokens'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import commonState from '@/store/common/state'
import { COMPONENT_IDS } from '@/config/constant'
import { navigations } from '@/navigation'
import { SETTING_SCREENS, type SettingScreenIds } from '../Main'
import { useSafeAreaBottom } from '@/store/common/hook'
import Text from '@/components/common/Text'
import PageHeader from '@/components/common/PageHeader'
import { Icon } from '@/components/common/Icon'
import LandscapeCentered from '@/components/LandscapeCentered'

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const safeAreaBottom = useSafeAreaBottom()

  const handlePress = useCallback((id: SettingScreenIds) => {
    const homeComponentId = commonState.componentIds.find(({ name }) => name === COMPONENT_IDS.home)?.id
    if (homeComponentId) navigations.pushSettingDetailScreen(homeComponentId, id)
  }, [])

  const contentContainer = useMemo(() => ({
    paddingHorizontal: designSpacing.lg,
    paddingBottom: designSpacing.xl + safeAreaBottom,
  }), [safeAreaBottom])

  return (
    <View style={styles.container}>
      <LandscapeCentered maxWidth={760}>
        <ScrollView
          style={styles.content}
          contentContainerStyle={contentContainer}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
        >
          <PageHeader title={t('nav_setting')} />
          <View>
            {SETTING_SCREENS.map((id) => (
              <TouchableOpacity
                key={id}
                style={styles.categoryItem}
                activeOpacity={0.7}
                onPress={() => { handlePress(id) }}
              >
                <Text
                  size={16}
                  color={theme['c-font']}
                >
                  {t(`setting_${id}`)}
                </Text>
                <Icon name="chevron-right" size={16} color={theme['c-font-label']} />
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </LandscapeCentered>
    </View>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  categoryItem: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
  },
})
