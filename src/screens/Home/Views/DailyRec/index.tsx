import { memo, useRef, useState, useCallback, useEffect } from 'react'
import { TouchableOpacity, View, BackHandler, StyleSheet } from 'react-native'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { designSpacing } from '@/theme/DesignTokens'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import RecPlaylists from './RecPlaylists'
import RecSongs from './RecSongs'
import StylizedModal, { type StylizedSelection, loadStylizedSelection } from './StylizedModal'
import { BorderWidths } from '@/theme'
import SonglistDetail from '../../../SonglistDetail'
import { type ListInfoItem } from '@/store/songlist/state'
import commonState from '@/store/common/state'
import { setNavActiveId } from '@/core/common'
import PageTopInset from '@/components/common/PageTopInset'
import SwipeBackArea from '@/components/common/SwipeBackArea'

const Tabs = ({
  activeTab,
  onTabChange,
  isStylized,
  setIsStylized,
  onOpenModal,
}: {
  activeTab: 'songs' | 'playlists'
  onTabChange: (tab: 'songs' | 'playlists') => void
  isStylized: boolean
  setIsStylized: (v: boolean) => void
  onOpenModal: () => void
}) => {
  const theme = useTheme()
  return (
    // 标题移到大标题下方独占一行（见 pageHeader 的 titleBlock），四个按钮并到同一行：
    // 推荐歌曲 / 推荐歌单 是主 tab（下划线选区），默认推荐 / 风格化推荐 是「推荐歌曲」下的子模式
    // （切到「推荐歌单」时没有风格化概念，故只在 songs 下显示）。
    // flexWrap：字号被调大或窄屏（375pt）放不下时自动换行，不至于把最后一个按钮裁掉。
    <View style={styles.tabsRow}>
      <TouchableOpacity style={styles.tab} onPress={() => { onTabChange('songs') }}>
        <Text
          style={[styles.tabText, { borderBottomColor: activeTab === 'songs' ? theme['c-primary-font-active'] : 'transparent' }]}
          color={theme['c-font']}
        >
          推荐歌曲
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.tab} onPress={() => { onTabChange('playlists') }}>
        <Text
          style={[styles.tabText, { borderBottomColor: activeTab === 'playlists' ? theme['c-primary-font-active'] : 'transparent' }]}
          color={theme['c-font']}
        >
          推荐歌单
        </Text>
      </TouchableOpacity>
      {activeTab === 'songs' ? (
        <>
          <TouchableOpacity
            onPress={() => { setIsStylized(false) }}
            style={[
              styles.subTab,
              !isStylized ? { borderColor: theme['c-primary-font'] } : { borderColor: 'transparent' },
            ]}
          >
            <Text color={!isStylized ? theme['c-primary-font'] : theme['c-font']} size={13}>默认推荐</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              if (!isStylized) setIsStylized(true)
              else onOpenModal()
            }}
            style={[
              styles.subTab,
              isStylized ? { borderColor: theme['c-primary-font'] } : { borderColor: 'transparent' },
            ]}
          >
            <Text color={isStylized ? theme['c-primary-font'] : theme['c-font']} size={13}>
              {isStylized ? '风格化推荐 ▾' : '风格化推荐'}
            </Text>
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  )
}

export default memo(() => {
  const [activeTab, setActiveTab] = useState<'songs' | 'playlists'>('songs')
  const [isStylized, setIsStylized] = useState(false)
  const [showStylizedModal, setShowStylizedModal] = useState(false)
  const [stylizedSelection, setStylizedSelection] = useState<StylizedSelection>(null)

  useEffect(() => {
    loadStylizedSelection().then(data => {
      if (data) setStylizedSelection(data)
    })
  }, [])

  const pagerViewRef = useRef<PagerView>(null)
  const [selectedPlaylist, setSelectedPlaylist] = useState<ListInfoItem | null>(null)
  const selectedPlaylistRef = useRef(selectedPlaylist)
  selectedPlaylistRef.current = selectedPlaylist
  const theme = useTheme()
  const t = useI18n()
  const handleTabChange = (newTab: 'songs' | 'playlists') => {
    if (activeTab === newTab) return
    setActiveTab(newTab)
    pagerViewRef.current?.setPage(newTab === 'songs' ? 0 : 1)
  }

  const onPageSelected = useCallback((event: PagerViewOnPageSelectedEvent) => {
    const newTab = event.nativeEvent.position === 0 ? 'songs' : 'playlists'
    if (newTab !== activeTab) {
      setActiveTab(newTab)
    }
  }, [activeTab])

  const handleOpenDetail = useCallback((playlistInfo: ListInfoItem) => {
    setSelectedPlaylist(playlistInfo)
  }, [])

  const handleCloseDetail = useCallback(() => {
    setSelectedPlaylist(null)
  }, [])

  const handleBackToDiscovery = useCallback(() => {
    setNavActiveId('nav_discovery')
  }, [])

  const pageHeader = (
    <>
      <PageTopInset />
      {/* 标题在上、四个按钮在同一行在其下方（原来按钮挤在标题右侧、子模式还另起一行） */}
      <View style={styles.titleBlock}>
        <Text style={styles.titleText} size={34} color={theme['c-font']}>
          {t('nav_daily_rec')}
        </Text>
        <Tabs
          activeTab={activeTab}
          onTabChange={handleTabChange}
          isStylized={isStylized}
          setIsStylized={setIsStylized}
          onOpenModal={() => { setShowStylizedModal(true) }}
        />
      </View>
    </>
  )

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

  return (
    <View style={{ flex: 1 }}>
      <View style={[{ flex: 1 }, selectedPlaylist ? { opacity: 0 } : null]} pointerEvents={selectedPlaylist ? 'none' : 'auto'}>
        <PagerView
          ref={pagerViewRef}
          style={{ flex: 1 }}
          initialPage={activeTab === 'songs' ? 0 : 1}
          onPageSelected={onPageSelected}
          scrollEnabled
        >
          <View key="1">
            {(activeTab === 'songs') && (
              <RecSongs
                header={pageHeader}
                isStylized={isStylized}
                stylizedSelection={stylizedSelection}
              />
            )}
          </View>
          <View key="2">
            <RecPlaylists header={pageHeader} onOpenDetail={handleOpenDetail} />
          </View>
        </PagerView>
        <StylizedModal
          visible={showStylizedModal}
          onClose={() => { setShowStylizedModal(false) }}
          onConfirm={(selection) => {
            setStylizedSelection(selection)
            setShowStylizedModal(false)
            setIsStylized(true)
          }}
        />
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
  // 标题独占一行，四个按钮在它下方另起一行（左右内边距与标题对齐）
  titleBlock: {
    paddingHorizontal: designSpacing.lg,
  },
  titleText: {
    fontWeight: '800',
    lineHeight: 36,
  },
  // 四个按钮同一行；窄屏 / 放大字号放不下时自动换行，避免最后一个按钮被裁掉
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  tab: {
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  tabText: {
    paddingBottom: 5,
    borderBottomWidth: BorderWidths.normal3,
  },
  // 子模式按钮（默认推荐 / 风格化推荐）：与主 tab 间隔 6，描边 chip 样式
  subTab: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 0,
    borderWidth: BorderWidths.normal,
  },
})
