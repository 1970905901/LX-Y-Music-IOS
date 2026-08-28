import {forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef} from 'react'
import { View, TouchableOpacity } from 'react-native'
import OnlineList from '@/components/OnlineList'
import AlbumList from './AlbumList'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { playOnlineList } from '@/core/list'
import { BorderWidths } from '@/theme'
import { Icon } from '@/components/common/Icon.tsx'
import { type OnlineListType } from '@/components/OnlineList'

interface SongListProps {
  componentId: string
  artistId: string
  songs: { list: any[], hasMore: boolean, page: number, loading: boolean, sort: string }
  albums: { list: any[], hasMore: boolean, page: number, loading: boolean }
  activeTab: 'songs' | 'albums'
  albumViewMode: 'grid' | 'list'
  playingId: string | null
  onTabChange: (tab: 'songs' | 'albums') => void
  onLoadMoreSongs: () => void
  onLoadMoreAlbums: () => void
  onSortChange: (sort: 'hot' | 'time') => void
  onRefresh: () => void
  onAlbumViewModeChange: (mode: 'grid' | 'list') => void
  onSongListUpdate: (list: LX.Music.MusicInfoOnline[]) => void
}

interface SongListRef {
  scrollToInfo: (info: LX.Music.MusicInfoOnline) => void
}

const SongList = forwardRef<SongListRef, SongListProps>(({
                                                           componentId,
                                                           artistId,
                                                           songs, albums, activeTab, onTabChange,
                                                           onLoadMoreSongs, onLoadMoreAlbums,
                                                           onSortChange, onRefresh,
                                                           playingId,
                                                           albumViewMode, onAlbumViewModeChange,
                                                           onSongListUpdate,
                                                         }, ref) => {
  const theme = useTheme()
  const songListRef = useRef<OnlineListType>(null)
  // 上次同步进 OnlineList 的列表引用。播放中 wy 音质详情回填会触发 musicInfoUpdate
  // → OnlineList 内部更新列表 → onListUpdate 回写 songs.list → 本 effect 再次整表
  // setList 替换 FlatList 数据，反复重置渲染窗口（initialNumToRender=12），表现为
  // "播放时列表只显示 12 首下方空白"。引用相同（内容由 OnlineList 自身已更新）时
  // 跳过 setList，阻断回环；仅在真实分页/排序/刷新产生新引用时才同步。
  const lastSyncedListRef = useRef<LX.Music.MusicInfoOnline[] | null>(null)

  useImperativeHandle(ref, () => ({
    scrollToInfo: (info) => {
      songListRef.current?.scrollToInfo(info)
    },
  }))

  const onPlayList = useCallback((index: number) => {
    if (!songs.list.length) return
    const listId = `artist_detail_${artistId}`
    void playOnlineList(listId, songs.list, index)
  }, [songs.list, artistId])

  useEffect(() => {
    if (activeTab === 'songs') {
      // 下一页加载期间也必须保持 loading，避免 iOS FlatList 的 onEndReached
      // 连续触发多个分页请求；之前只有“首屏为空”时才设 loading，导致滚动
      // 到底部时状态立刻回到 idle，分页请求互相覆盖/丢页。
      songListRef.current?.setStatus(songs.loading ? 'loading' : songs.hasMore ? 'idle' : 'end')
      // page 表示“下一次要请求的页码”：首屏返回后 page=2，但列表仍应替换；
      // 从第二页返回后 page=3，才是追加已有列表。
      if (lastSyncedListRef.current !== songs.list) {
        lastSyncedListRef.current = songs.list
        songListRef.current?.setList(songs.list, songs.page > 2, false)
      }
    }
  }, [songs.list, songs.loading, songs.hasMore, songs.page, activeTab])

  const Header = () => (
    <View style={styles.listHeader}>
      <View style={styles.tabs}>
        <TouchableOpacity style={styles.tab} onPress={() => onTabChange('songs')}>
          <Text
            style={[styles.tabText, { borderBottomColor: activeTab === 'songs' ? theme['c-primary-font-active'] : 'transparent' }]}
            color={activeTab === 'songs' ? theme['c-primary-font'] : theme['c-font']}
          >
            所有歌曲
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tab} onPress={() => onTabChange('albums')}>
          <Text
            style={[styles.tabText, { borderBottomColor: activeTab === 'albums' ? theme['c-primary-font-active'] : 'transparent' }]}
            color={activeTab === 'albums' ? theme['c-primary-font'] : theme['c-font']}
          >
            所有专辑
          </Text>
        </TouchableOpacity>
      </View>
      { activeTab === 'songs' && (
        <View style={styles.sorts}>
          <TouchableOpacity onPress={() => onSortChange('hot')} style={styles.sortBtn}>
            <Text
              style={[styles.tabText, { borderBottomColor: songs.sort === 'hot' ? theme['c-primary-font-active'] : 'transparent' }]}
              color={songs.sort === 'hot' ? theme['c-primary-font'] : theme['c-font']}
            >
              热门
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onSortChange('time')} style={styles.sortBtn}>
            <Text
              style={[styles.tabText, { borderBottomColor: songs.sort === 'time' ? theme['c-primary-font-active'] : 'transparent' }]}
              color={songs.sort === 'time' ? theme['c-primary-font'] : theme['c-font']}
            >
              时间
            </Text>
          </TouchableOpacity>
        </View>
      )}
      { activeTab === 'albums' && (
        <View style={styles.viewModeContainer}>
          <TouchableOpacity style={styles.viewModeBtn} onPress={() => onAlbumViewModeChange('grid')}>
            <Icon name="album" color={albumViewMode === 'grid' ? theme['c-primary-font-active'] : theme['c-font']} size={18} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.viewModeBtn} onPress={() => onAlbumViewModeChange('list')}>
            <Icon name="menu" color={albumViewMode === 'list' ? theme['c-primary-font-active'] : theme['c-font']} size={18} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  )

  return (
    <View style={{ flex: 1 }}>
      <Header />
      <View style={{ flex: 1 }}>
        {activeTab === 'songs' ? (
          <OnlineList
            key="artist-songs"
            ref={songListRef}
            listId="artist_detail"
            forcePlayList={true}
            onPlayList={onPlayList}
            onRefresh={onRefresh}
            onLoadMore={onLoadMoreSongs}
            onListUpdate={onSongListUpdate}
            playingId={playingId}
          />
        ) : (
          <AlbumList
            key="artist-albums"
            componentId={componentId}
            albums={albums.list}
            loading={albums.loading}
            hasMore={albums.hasMore}
            onRefresh={onRefresh}
            viewMode={albumViewMode}
            onLoadMore={onLoadMoreAlbums}
          />
        )}
      </View>
    </View>
  )
})

export default memo(SongList)

const styles = createStyle({
  listHeader: {
    paddingHorizontal: 15,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tabs: {
    flexDirection: 'row',
  },
  tab: {
    paddingVertical: 8,
    paddingRight: 15,
  },
  viewModeContainer: {
    flexDirection: 'row',
  },
  viewModeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  sorts: {
    flexDirection: 'row',
  },
  sortBtn: {
    paddingVertical: 8,
    paddingLeft: 15,
  },
  tabText: {
    paddingBottom: 3,
    borderBottomWidth: BorderWidths.normal3,
  },
})
