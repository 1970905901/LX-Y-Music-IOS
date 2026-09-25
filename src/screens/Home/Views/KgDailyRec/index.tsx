import { memo, useRef, useState, useCallback, useEffect } from 'react'
import { TouchableOpacity, View, BackHandler, StyleSheet } from 'react-native'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import RecSongs from './RecSongs'
import { BorderWidths } from '@/theme'
import SonglistDetail from '../../../SonglistDetail'
import { type ListInfoItem } from '@/store/songlist/state'
import PageTopInset from '@/components/common/PageTopInset'

type TabType = 'recommend' | 'everyday'

const TABS: { id: TabType; label: string }[] = [
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
    <View style={styles.tabsContainer}>
      {TABS.map((tab) => (
        <TouchableOpacity
          key={tab.id}
          style={styles.tab}
          onPress={() => onTabChange(tab.id)}
        >
          <Text
            style={[
              styles.tabText,
              { borderBottomColor: activeTab === tab.id ? theme['c-primary-font-active'] : 'transparent' },
            ]}
            color={activeTab === tab.id ? theme['c-primary-font'] : theme['c-font']}
          >
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

export default memo(() => {
  const [activeTab, setActiveTab] = useState<TabType>('recommend')
  const pagerViewRef = useRef<PagerView>(null)
  const theme = useTheme()

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
    [activeTab]
  )

  const pageHeader = (
    <>
      <PageTopInset />
      <Tabs activeTab={activeTab} onTabChange={handleTabChange} />
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
    </View>
  )
})

const styles = createStyle({
  tabsContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: 15,
    borderBottomWidth: BorderWidths.normal,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  tab: {
    paddingVertical: 5,
    paddingHorizontal: 15,
  },
  tabText: {
    paddingBottom: 5,
    borderBottomWidth: BorderWidths.normal3,
  },
})
