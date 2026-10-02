import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { InteractionManager, View, BackHandler, KeyboardAvoidingView, Platform } from 'react-native'
import HeaderBar, { type HeaderBarProps, type HeaderBarType } from './HeaderBar'
import SearchTypeSelector from './SearchTypeSelector'
import searchState, { type SearchType } from '@/store/search/state'
import commonState from '@/store/common/state'
import searchMusicState from '@/store/search/music/state'
import searchSonglistState, { type ListInfoItem } from '@/store/search/songlist/state'
import { getSearchSetting, saveSearchSetting } from '@/utils/data'
import { consumePendingAction } from '@/core/pendingAction'
import { createStyle } from '@/utils/tools'
import List, { type ListType } from './List'
import { addHistoryWord, setSearchText as setSearchState } from '@/core/search/search'
import SonglistDetail from '../../../SonglistDetail'
import { COMPONENT_IDS } from '@/config/constant'
import { useSettingValue } from '@/store/setting/hook'
import { designSpacing } from '@/theme/DesignTokens'

interface SearchInfo {
  temp_source: LX.OnlineSource
  source: LX.OnlineSource | 'all'
  searchType: 'music' | 'songlist' | 'singer' | 'album'
}

export default () => {
  const headerBarRef = useRef<HeaderBarType>(null)
  const listRef = useRef<ListType>(null)
  const searchInfo = useRef<SearchInfo>({ temp_source: 'kw', source: 'kw', searchType: 'music' })
  const [selectedList, setSelectedList] = useState<ListInfoItem | null>(null)
  const [source, setSource] = useState<SearchInfo['source']>(searchInfo.current.source)
  const [sourceType, setSourceType] = useState<SearchInfo['searchType']>(searchInfo.current.searchType)
  const selectedListRef = useRef(selectedList)
  selectedListRef.current = selectedList

  const enabledSources = useSettingValue('search.enabledSources')
  const filteredMusicSources = useMemo(
    () => searchMusicState.sources.filter(s => enabledSources[s]),
    [enabledSources],
  )
  const filteredSonglistSources = useMemo(
    () => searchSonglistState.sources.filter(s => enabledSources[s]),
    [enabledSources],
  )

  const availableSources = useMemo(
    () => sourceType === 'songlist' ? filteredSonglistSources : filteredMusicSources,
    [filteredMusicSources, filteredSonglistSources, sourceType],
  )

  const [headerKey, setHeaderKey] = useState(Date.now())

  useEffect(() => {
    const onBackPress = () => {
      if (selectedListRef.current) {
        const lastScreen = commonState.componentIds[commonState.componentIds.length - 1]

        if (lastScreen && lastScreen.name !== COMPONENT_IDS.home) {
          return false
        }

        setSelectedList(null)
        return true
      }
      return false
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress)

    return () => { subscription.remove() }
  }, [])

  useEffect(() => {
    if (!selectedList) {
      setHeaderKey(Date.now())
      if (searchState.searchText) {
        listRef.current?.loadList(
          searchState.searchText,
          searchInfo.current.source,
          searchInfo.current.searchType,
        )
      }
    }
  }, [selectedList])

  const handleSearch: HeaderBarProps['onSearch'] = useCallback((text) => {
    setSelectedList(null)
    setSearchState(text)
    headerBarRef.current?.setText(text)
    headerBarRef.current?.blur()
    void addHistoryWord(text)
    void listRef.current?.loadList(text, searchInfo.current.source, searchInfo.current.searchType)
  }, [])

  useEffect(() => {
    void getSearchSetting().then((info) => {
      searchInfo.current.temp_source = info.temp_source
      searchInfo.current.source = info.source
      searchInfo.current.searchType = info.type
      setSource(info.source)
      setSourceType(info.type)
      headerBarRef.current?.setText(searchState.searchText)
      void listRef.current?.loadList(
        searchState.searchText,
        searchInfo.current.source,
        searchInfo.current.searchType,
      )
    })

    const handleTypeChange = (type: SearchType) => {
      setSelectedList(null)
      searchInfo.current.searchType = type
      setSourceType(type)
      void saveSearchSetting({ type })
      if (searchState.searchText) {
        listRef.current?.loadList(searchState.searchText, searchInfo.current.source, type)
      }
    }
    global.app_event.on('searchTypeChanged', handleTypeChange)

    const handleSearchDeepLink = async(keyword: string, source: string, type: string) => {
      const info = await getSearchSetting()
      searchInfo.current.source = (source || info.source) as LX.OnlineSource
      searchInfo.current.searchType = (type || info.type) as SearchType
      setSource(searchInfo.current.source)
      setSourceType(searchInfo.current.searchType)
      if (type) {
        global.app_event.searchTypeChanged(searchInfo.current.searchType)
      }
      if (keyword) {
        listRef.current?.loadList(
          keyword,
          searchInfo.current.source,
          searchInfo.current.searchType,
        )
      }
      setTimeout(() => headerBarRef.current?.focus(), 300)
    }
    global.app_event.on('searchDeepLink', handleSearchDeepLink)

    return () => {
      global.app_event.off('searchTypeChanged', handleTypeChange)
      global.app_event.off('searchDeepLink', handleSearchDeepLink)
    }
  }, [filteredMusicSources, filteredSonglistSources, headerKey])

  useEffect(() => {
    const handleNavChange = async(id: string) => {
      if (id === 'nav_search') {
        const info = await getSearchSetting()
        searchInfo.current.source = info.source
        searchInfo.current.searchType = info.type
        setSource(info.source)
        setSourceType(info.type)
        headerBarRef.current?.setText(searchState.searchText)
        if (searchState.searchText) {
          void listRef.current?.loadList(searchState.searchText, info.source, info.type)
        }
        if (consumePendingAction('searchFocus')) {
          void InteractionManager.runAfterInteractions(() => {
            headerBarRef.current?.focus()
          })
        }
      }
    }
    global.state_event.on('navActiveIdUpdated', handleNavChange)

    if (consumePendingAction('searchFocus')) {
      void InteractionManager.runAfterInteractions(() => {
        headerBarRef.current?.focus()
      })
    }

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavChange)
    }
  }, [])
  const handleSourceChange: HeaderBarProps['onSourceChange'] = (source) => {
    setSelectedList(null)
    setSource(source)
    searchInfo.current.source = source
    void saveSearchSetting({ source: source as LX.OnlineSource })
    if (searchState.searchText) {
      listRef.current?.loadList(searchState.searchText, source, searchInfo.current.searchType)
    }
  }
  const handleCancelSearch = useCallback(() => {
    setSelectedList(null)
    setSearchState('')
    headerBarRef.current?.setText('')
    headerBarRef.current?.blur()
    void listRef.current?.loadList('', searchInfo.current.source, searchInfo.current.searchType)
  }, [])
  const handleOpenDetail = useCallback((item: ListInfoItem) => {
    setSelectedList(item)
  }, [])
  const searchHeader = selectedList ? null : (
    <View>
      <HeaderBar
        key={headerKey}
        ref={headerBarRef}
        sources={availableSources}
        source={source}
        onSourceChange={handleSourceChange}
        onSearch={handleSearch}
        onCancelSearch={handleCancelSearch}
      />
      <View style={styles.typeRow}>
        <SearchTypeSelector />
      </View>
    </View>
  )
  return (
    // 键盘规避：键盘弹出时压缩结果列表高度，避免键盘遮挡列表底部（iOS 用 padding）
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS == 'ios' ? 'padding' : undefined}
    >
      { !selectedList && (
        <List
          ref={listRef}
          header={searchHeader ?? undefined}
          onSearch={handleSearch}
          onOpenDetail={handleOpenDetail}
        />
      )}
      {selectedList ? (
        <View style={styles.content}>
          <SonglistDetail
            info={selectedList}
            onBack={() => { setSelectedList(null) }}
            initialScrollToInfo={null}
          />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  )
}


const styles = createStyle({
  container: {
    width: '100%',
    flex: 1,
  },
  content: {
    flex: 1,
  },
  typeRow: {
    height: 42,
    paddingHorizontal: designSpacing.lg,
    justifyContent: 'center',
  },
})
