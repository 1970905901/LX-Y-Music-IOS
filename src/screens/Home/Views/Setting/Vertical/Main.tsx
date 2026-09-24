import { memo, useCallback, useMemo, useState } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import { createStyle } from '@/utils/tools'
import { designSpacing } from '@/theme/DesignTokens'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { SETTING_SCREENS, SETTING_COMPONENTS, type SettingScreenIds } from '../Main'
import { useSafeAreaBottom } from '@/store/common/hook'
import Text from '@/components/common/Text'
import PageHeader from '@/components/common/PageHeader'
import { Icon } from '@/components/common/Icon'
import LandscapeCentered from '@/components/LandscapeCentered'

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const safeAreaBottom = useSafeAreaBottom()
  const [activeId, setActiveId] = useState<SettingScreenIds>(global.lx.settingActiveId)

  const handlePress = useCallback((id: SettingScreenIds) => {
    setActiveId(id)
    global.lx.settingActiveId = id
  }, [])

  const ActiveScreen = useMemo(() => (
    SETTING_COMPONENTS[activeId] ?? SETTING_COMPONENTS.basic
  ), [activeId])

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
                  color={activeId === id ? theme['c-primary'] : theme['c-font']}
                >
                  {t(`setting_${id}`)}
                </Text>
                {activeId === id ? (
                  <Icon name="chevron-right" size={16} color={theme['c-primary']} />
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
          <ActiveScreen />
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
