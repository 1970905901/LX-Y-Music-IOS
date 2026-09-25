import { memo, useRef, useState, useCallback, useEffect } from 'react'
import { TouchableOpacity, View, BackHandler, StyleSheet, ScrollView } from 'react-native'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { designSpacing } from '@/theme/DesignTokens'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import RecSongs from './RecSongs'
import { BorderWidths } from '@/theme'
import SonglistDetail from '../../../SonglistDetail'
import { type ListInfoItem } from '@/store/songlist/state'
import { setNavActiveId } from '@/core/common'
import PageTopInset from '@/components/common/PageTopInset'
import SwipeBackArea from '@/components/common/SwipeBackArea'

type TabType = 'recommend' | 'everyday'

const TABS: Array<{ id: TabType, label: string }> = [
  { id: 'recommend', label: '每日推荐' },
  { id: 'everyday', label: '新歌速递' },
]

const Tabs = ({
  activeTab,
  onTabChange,
}: {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
}) => {
  const theme = useTheme()
  return (
    <ScrollView
      style={styles.tabsScroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tabsContainer}
    >
      {TABS.map((tab) => (
        <TouchableOpacity
          key={tab.id}
          style={styles.tab}
          onPress={() => { onTabChange(tab.id) }}
        >
          <Text
            style={[
              styles.tabText,
              { borderBottomColor: activeTab === tab.id ? theme['c-primary-font-active'] : 'transparent' },
            ]}
            color={theme['c-font']}
          >
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  )
}

export default memo(() => {
  const [activeTab, setActiveTab] = useState<TabType>('recommend')
  const pagerViewRef = useRef<PagerView>(null)
  const theme = useTheme()
  const t = useI18n()

  const handleTabChange = (newTab: TabType) => {
    if (activeTab === newTab) return
    setActiveTab(newTab)
    const tabIndex = TABS.findIndex((t) => t.id === newTab)
    pagerViewRef.current?.setPage(tabIndex)
  }

  const onPageSelected = useCallback(
    (event: PagerViewOnPageSelectedEvent) => {
      const newTab = TABS[event.nativeEvent.position]?.id || 'recommend'
      if (newTab !== activeTab) {
        setActiveTab(newTab)
      }
    },
    [activeTab],
  )

  const handleBackToDiscovery = useCallback(() => {
    setNavActiveId('nav_discovery')
  }, [])

  const pageHeader = (
    <>
      <PageTopInset />
      <View style={styles.titleRow}>
        <Text style={styles.titleText} size={34} color={theme['c-font']}>
          {t('nav_kg_daily_rec')}
        </Text>
        <Tabs activeTab={activeTab} onTabChange={handleTabChange} />
      </View>
    </>
  )

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <PagerView
          ref={pagerViewRef}
          style={{ flex: 1 }}
          initialPage={TABS.findIndex((t) => t.id === activeTab)}
          onPageSelected={onPageSelected}
          scrollEnabled
        >
          <View key="recommend">
            <RecSongs header={pageHeader} type="recommend" />
          </View>
          <View key="everyday">
            <RecSongs header={pageHeader} type="everyday" />
          </View>
        </PagerView>
      </View>
      <SwipeBackArea onBack={handleBackToDiscovery} />
    </View>
  )
})

const styles = createStyle({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: designSpacing.lg,
  },
  titleText: {
    fontWeight: '800',
    lineHeight: 36,
  },
  tabsScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  tabsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  tabText: {
    paddingBottom: 5,
    borderBottomWidth: BorderWidths.normal3,
  },
})
