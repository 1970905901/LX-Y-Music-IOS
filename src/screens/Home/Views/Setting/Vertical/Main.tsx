import { memo, useCallback, useMemo } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import { createStyle } from '@/utils/tools'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { SETTING_SCREENS, type SettingScreenIds } from '../Main'
import commonState from '@/store/common/state'
import { useSafeAreaBottom } from '@/store/common/hook'
import Text from '@/components/common/Text'
import PageHeader from '@/components/common/PageHeader'
import { Icon } from '@/components/common/Icon'
import LandscapeCentered from '@/components/LandscapeCentered'
import { navigations } from '@/navigation'

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const safeAreaBottom = useSafeAreaBottom()

  const currentComponentId = commonState.componentIds[commonState.componentIds.length - 1]?.id

  const handlePress = useCallback((id: SettingScreenIds) => {
    global.lx.settingActiveId = id
    if (!currentComponentId) return
    navigations.pushSettingDetailScreen(currentComponentId, id)
  }, [currentComponentId])

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
          <View style={{
            ...styles.categoryList,
            backgroundColor: theme['c-content-background'],
            borderColor: theme['c-border-background'],
          }}>
            {SETTING_SCREENS.map((id, index, list) => (
              <TouchableOpacity
                key={id}
                style={[styles.categoryItem, index < list.length - 1 ? {
                  borderBottomWidth: 1,
                  borderBottomColor: theme['c-border-background'],
                } : null]}
                activeOpacity={0.7}
                onPress={() => { handlePress(id) }}
              >
                <Text size={16} color={theme['c-font']}>{t(`setting_${id}`)}</Text>
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
  categoryList: {
    borderRadius: designRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  categoryItem: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: designSpacing.md,
  },
  content: {
    flex: 1,
  },
})
