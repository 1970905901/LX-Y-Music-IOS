import { memo, useCallback, useMemo } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import { createStyle } from '@/utils/tools'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
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

  // ⚠️ 这里只放纵向内边距，**不要**再把水平内边距加回来：
  // PageHeader 自身带着 lg(24) 的水平内边距（与推荐页 Discovery 的 header 同值），
  // 若在 ScrollView 的外层再加一层水平内边距，大标题「设置」会被额外右推，
  // 而推荐页的「推荐」仍在 lg(24) 处 —— 两者相差正好是外层那层内边距
  // （历史上这里是 xl(32)，表现为「设置」比「推荐」右缩进 32pt，左右切 Tab 时标题横向跳一下）。
  const contentContainer = useMemo(() => ({
    // 底部悬浮的迷你播放器胶囊 + tab 栏最高约到 safeAreaBottom+150pt，
    // 参照 Discovery 页的 180 底部留白并叠加安全区，保证最后一项滚到底后完全脱离悬浮区可点。
    paddingBottom: 180 + safeAreaBottom,
  }), [safeAreaBottom])

  // 分类列表与本页大标题无关，它的水平内边距单独挂在列表容器上：
  // 与设置详情页（SettingDetail/index.tsx）保持一致，用 xl(32)。
  // 用内联常量而非 createStyle，是为了保持 32 这个原始值不被 scaleSizeW 再放大一次
  // （createStyle 会把 padding/margin 过一遍 scaleSizeW），避免列表行位置发生变化。
  const listStyle = useMemo(() => ({ paddingHorizontal: designSpacing.xl }), [])

  // 分类入口统一走「推荐页排行榜按钮」那套视觉语言：圆角 + 1px 边框 + 半透明主题色底
  const categoryItemStyle = useMemo(() => ({
    ...styles.categoryItem,
    backgroundColor: theme['c-primary-light-900-alpha-200'],
    borderColor: theme['c-border-background'],
  }), [theme])

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
          <View style={listStyle}>
            {SETTING_SCREENS.map((id) => (
              <TouchableOpacity
                key={id}
                style={categoryItemStyle}
                activeOpacity={0.7}
                onPress={() => { handlePress(id) }}
              >
                <Text
                  size={17}
                  style={styles.categoryLabel}
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
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: designRadius.md,
    borderWidth: 1,
    paddingHorizontal: designSpacing.md,
    marginBottom: designSpacing.xs,
  },
  categoryLabel: {
    flexShrink: 1,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
})
