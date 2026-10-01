import { getSongListSetting, saveSongListSetting } from '@/utils/data'
import { useEffect, useRef, useState, useCallback } from 'react'
import { StyleSheet, View, BackHandler } from 'react-native'
import { consumePendingAction } from '@/core/pendingAction'

import HeaderBar, { type HeaderBarProps, type HeaderBarType } from './HeaderBar'
import songlistState, { type InitState, type SortInfo, type ListInfoItem } from '@/store/songlist/state'
import List, { type ListType } from './List'
import SonglistDetail from '../../../SonglistDetail'
import { rememberHomeSubView, clearHomeSubView, takeRestorableSubView } from '@/core/homeSubView'
import commonState from '@/store/common/state'
import { useI18n } from '@/lang'
import MusicInfoOnline = LX.Music.MusicInfoOnline

interface SonglistInfo {
  source: InitState['sources'][number]
  sortId: SortInfo['id']
  tagId: string
}

export default () => {
  const headerBarRef = useRef<HeaderBarType>(null)
  const t = useI18n()
  const listRef = useRef<ListType>(null)
  const [selectedList, setSelectedList] = useState<ListInfoItem | null>(null)
  const [scrollToMusicInfo, setScrollToMusicInfo] = useState<MusicInfoOnline | null>(null)
  const selectedListRef = useRef(selectedList)
  selectedListRef.current = selectedList
  const songlistInfo = useRef<SonglistInfo>({ source: 'kw', sortId: '5', tagId: '' })
  const [headerKey, setHeaderKey] = useState(Date.now())
  const loadList = useCallback(() => {
    listRef.current?.loadList(songlistInfo.current.source, songlistInfo.current.sortId, songlistInfo.current.tagId)
  }, [])

  // 退出恢复：上次停留在某张歌单详情时，进入本页直接把它打开（核心状态见 core/homeSubView）
  useEffect(() => {
    void takeRestorableSubView('nav_songlist').then((info) => {
      if (info) setSelectedList(info)
    })
  }, [])

  useEffect(() => {
    const onBackPress = () => {
      if (selectedListRef.current) {
        if (commonState.componentIds.length > 1) {
          return false
        }

        setSelectedList(null)
        clearHomeSubView()
        return true
      }

      return false
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress)
    return () => { subscription.remove() }
  }, [])

  useEffect(() => {
    void getSongListSetting().then((info) => {
      songlistInfo.current.source = info.source
      songlistInfo.current.sortId = info.sortId
      songlistInfo.current.tagId = info.tagId
      headerBarRef.current?.setSource(info.source, info.sortId, info.tagName, info.tagId)
      loadList()
    })
  }, [loadList, headerKey])

  useEffect(() => {
    if (!selectedList) {
      setHeaderKey(Date.now())
      loadList()
    }
  }, [selectedList, loadList])


  const handleSortChange: HeaderBarProps['onSortChange'] = (id) => {
    songlistInfo.current.sortId = id
    void saveSongListSetting({ sortId: id })
    listRef.current?.loadList(songlistInfo.current.source, id, songlistInfo.current.tagId)
  }

  const handleTagChange: HeaderBarProps['onTagChange'] = (name, id) => {
    songlistInfo.current.tagId = id
    void saveSongListSetting({ tagName: name, tagId: id })
    listRef.current?.loadList(songlistInfo.current.source, songlistInfo.current.sortId, id)
  }

  const handleSourceChange: HeaderBarProps['onSourceChange'] = (source) => {
    songlistInfo.current.source = source
    songlistInfo.current.tagId = ''
    // 汽水等仅支持「打开歌单链接」的平台没有 sortList，取空避免访问 [0].id 崩溃
    songlistInfo.current.sortId = songlistState.sortList[source]?.[0]?.id ?? ''
    void saveSongListSetting({
      sortId: songlistInfo.current.sortId,
      source,
      tagId: '',
      tagName: '',
    })
    headerBarRef.current?.setSource(
      source,
      songlistInfo.current.sortId,
      '',
      songlistInfo.current.tagId,
    )
    listRef.current?.loadList(source, songlistInfo.current.sortId, songlistInfo.current.tagId)
  }

  const handleOpenDetail = useCallback((item: ListInfoItem) => {
    setSelectedList(item)
    rememberHomeSubView(item, 'nav_songlist')
  }, [])

  const handleBack = useCallback(() => {
    setSelectedList(null)
    setScrollToMusicInfo(null)
    clearHomeSubView()
  }, [])

  useEffect(() => {
    const handleOpenImport = () => {
      (headerBarRef.current as any)?.setSource(
        songlistInfo.current.source,
        songlistInfo.current.sortId,
        '',
        songlistInfo.current.tagId,
      );
      (global.app_event as any).emit('_openSonglistModal', songlistInfo.current.source)
    }
    global.app_event.on('openSonglistImport', handleOpenImport)

    if (consumePendingAction('songlistImport')) {
      setTimeout(() => { handleOpenImport() }, 300)
    }

    return () => {
      global.app_event.off('openSonglistImport', handleOpenImport)
    }
  }, [])

  return (
    <View style={styles.container}>
      <View style={[styles.baseContent, selectedList ? { opacity: 0 } : null]} pointerEvents={selectedList ? 'none' : 'auto'}>
        <List
          ref={listRef}
          header={(
            // 负边距抵消 Songlist 列表 FlatList 的 10pt 水平框架内边距，
            // 让平台/分类/标签横滑行的滚动范围直达屏幕左右两缘（与推荐页一致）
            <View style={{ marginHorizontal: -10 }}>
              <HeaderBar
                key={headerKey}
                ref={headerBarRef}
                title={t('discovery_tab_discover')}
                onSortChange={handleSortChange}
                onTagChange={handleTagChange}
                onSourceChange={handleSourceChange}
              />
            </View>
          )}
          onOpenDetail={handleOpenDetail}
        />
      </View>
      {selectedList ? (
        <View style={StyleSheet.absoluteFill}>
          <SonglistDetail info={selectedList} onBack={handleBack} initialScrollToInfo={scrollToMusicInfo} />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    flex: 1,
  },
  baseContent: {
    flex: 1,
  },
})
