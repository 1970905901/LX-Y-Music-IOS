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
import PageTopInset from '@/components/common/PageTopInset'

const Tabs = ({
  activeTab,
  onTabChange,
  isStylized,
  setIsStylized,
  onOpenModal
}: {
  activeTab: 'songs' | 'playlists'
  onTabChange: (tab: 'songs' | 'playlists') => void
  isStylized: boolean
  setIsStylized: (v: boolean) => void
  onOpenModal: () => void
}) => {
  const theme = useTheme()
  return (
    <View>
      {/* 主 tab 与大标题同行（见 pageHeader 的 titleRow） */}
      <View style={styles.titleTabs}>
        <TouchableOpacity style={styles.tab} onPress={() => onTabChange('songs')}>
          <Text
            style={[styles.tabText, { borderBottomColor: activeTab === 'songs' ? theme['c-primary-font-active'] : 'transparent' }]}
            color={theme['c-font']}
          >
            推荐歌曲
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tab} onPress={() => onTabChange('playlists')}>
          <Text
            style={[styles.tabText, { borderBottomColor: activeTab === 'playlists' ? theme['c-primary-font-active'] : 'transparent' }]}
            color={theme['c-font']}
          >
            推荐歌单
          </Text>
        </TouchableOpacity>
      </View>
      {activeTab === 'songs' ? (
        <View style={[styles.subTabsRow, { justifyContent: 'flex-start', alignItems: 'center' }]}>
          <TouchableOpacity
            onPress={() => setIsStylized(false)}
            style={[
              { marginRight: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 0, borderWidth: BorderWidths.normal },
              !isStylized ? { borderColor: theme['c-primary-font'] } : { borderColor: 'transparent' }
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
              { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 0, borderWidth: BorderWidths.normal },
              isStylized ? { borderColor: theme['c-primary-font'] } : { borderColor: 'transparent' }
            ]}
          >
            <Text color={isStylized ? theme['c-primary-font'] : theme['c-font']} size={13}>
              {isStylized ? '风格化推荐 ▾' : '风格化推荐'}
            </Text>
          </TouchableOpacity>
        </View>
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

  const pageHeader = (
    <>
      <PageTopInset />
      <View style={styles.titleRow}>
        <Text style={styles.titleText} size={34} color={theme['c-font']}>
          {t('nav_daily_rec')}
        </Text>
        <Tabs
          activeTab={activeTab}
          onTabChange={handleTabChange}
          isStylized={isStylized}
          setIsStylized={setIsStylized}
          onOpenModal={() => setShowStylizedModal(true)}
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
    return () => subscription.remove()
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
          onClose={() => setShowStylizedModal(false)}
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
  titleTabs: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subTabsRow: {
    paddingHorizontal: designSpacing.lg,
    paddingTop: 2,
    paddingBottom: 4,
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
