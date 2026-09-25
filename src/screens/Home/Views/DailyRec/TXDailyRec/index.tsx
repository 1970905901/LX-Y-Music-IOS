import { memo, useRef, useState, useCallback, useEffect } from 'react'
import { TouchableOpacity, View, BackHandler, StyleSheet, ScrollView } from 'react-native'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { designSpacing } from '@/theme/DesignTokens'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import RecSongs from './RecSongs'
import RecPlaylists from './RecPlaylists'
import { BorderWidths } from '@/theme'
import SonglistDetail from '../../../../SonglistDetail'
import { type ListInfoItem } from '@/store/songlist/state'
import commonState from '@/store/common/state'
import { setNavActiveId } from '@/core/common'
import PageTopInset from '@/components/common/PageTopInset'
import SwipeBackArea from '@/components/common/SwipeBackArea'

type TabType = 'home' | 'radar' | 'songlist' | 'newsong'

const TABS: Array<{ id: TabType, label: string }> = [
  { id: 'home', label: '主页推荐' },
  { id: 'radar', label: '雷达推荐' },
  { id: 'songlist', label: '推荐歌单' },
  { id: 'newsong', label: '推荐新歌' },
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
  const [activeTab, setActiveTab] = useState<TabType>('home')
  const pagerViewRef = useRef<PagerView>(null)
  const [selectedPlaylist, setSelectedPlaylist] = useState<ListInfoItem | null>(null)
  const selectedPlaylistRef = useRef(selectedPlaylist)
  selectedPlaylistRef.current = selectedPlaylist
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
      const newTab = TABS[event.nativeEvent.position]?.id || 'home'
      if (newTab !== activeTab) {
        setActiveTab(newTab)
      }
    },
    [activeTab],
  )

  const handleOpenDetail = useCallback((playlistInfo: ListInfoItem) => {
    setSelectedPlaylist(playlistInfo)
  }, [])

  const handleCloseDetail = useCallback(() => {
    setSelectedPlaylist(null)
  }, [])

  const handleBackToDiscovery = useCallback(() => {
    setNavActiveId('nav_discovery')
  }, [])

  useEffect(() => {
    const onBackPress = () => {
      if (selectedPlaylistRef.current) {
        if (commonState.componentIds.length > 1) {
          return false
        }
        setSelectedPlaylist(null)
        return true
      }
      return false
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress)
    return () => { subscription.remove() }
  }, [])

  const renderTabContent = () => {
    switch (activeTab) {
      case 'home':
        return <RecSongs type="home" onOpenDetail={handleOpenDetail} />
      case 'radar':
        return <RecSongs type="radar" />
      case 'songlist':
        return <RecPlaylists onOpenDetail={handleOpenDetail} />
      case 'newsong':
        return <RecSongs type="newsong" />
      default:
        return <RecSongs type="home" onOpenDetail={handleOpenDetail} />
    }
  }

  const pageHeader = (
    <>
      <PageTopInset />
      <View style={styles.titleRow}>
        <Text style={styles.titleText} size={34} color={theme['c-font']}>
          {t('nav_tx_daily_rec')}
        </Text>
        <Tabs activeTab={activeTab} onTabChange={handleTabChange} />
      </View>
    </>
  )

  return (
    <View style={{ flex: 1 }}>
      <View
        style={[{ flex: 1 }, selectedPlaylist ? { opacity: 0 } : null]}
        pointerEvents={selectedPlaylist ? 'none' : 'auto'}
      >
        <PagerView
          ref={pagerViewRef}
          style={{ flex: 1 }}
          initialPage={TABS.findIndex((t) => t.id === activeTab)}
          onPageSelected={onPageSelected}
          scrollEnabled
        >
          <View key="home">
            <RecSongs header={pageHeader} type="home" onOpenDetail={handleOpenDetail} />
          </View>
          <View key="radar">
            <RecSongs header={pageHeader} type="radar" />
          </View>
          <View key="songlist">
            <RecPlaylists header={pageHeader} onOpenDetail={handleOpenDetail} />
          </View>
          <View key="newsong">
            <RecSongs header={pageHeader} type="newsong" />
          </View>
        </PagerView>
      </View>
      {selectedPlaylist && (
        <View style={[StyleSheet.absoluteFill]}>
          <SonglistDetail info={selectedPlaylist} onBack={handleCloseDetail} initialScrollToInfo={null} />
        </View>
      )}
      <SwipeBackArea onBack={handleBackToDiscovery} enabled={!selectedPlaylist} />
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
