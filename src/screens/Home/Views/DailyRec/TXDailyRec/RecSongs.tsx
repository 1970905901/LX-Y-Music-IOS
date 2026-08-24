import { memo, useEffect, useRef, useCallback, useState } from 'react'
import { View, FlatList, TouchableOpacity, Image, RefreshControl } from 'react-native'
import OnlineList, { type OnlineListType } from '@/components/OnlineList'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { createStyle, toast } from '@/utils/tools'
import txApi from '@/utils/musicSdk/tx'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { LIST_IDS } from '@/config/constant'
import { setTempList, setActiveList } from '@/core/list'
import { playList } from '@/core/player/player'
import { clearPlayedList } from '@/core/player/playedList'
import { type ListInfoItem } from '@/store/songlist/state'

type RecType = 'home' | 'radar' | 'newsong'

interface Props {
  type: RecType
  onOpenDetail?: (playlistInfo: ListInfoItem) => void
}

const handlePlay = async (list: LX.Music.MusicInfoOnline[], listId: string, index = 0) => {
  await setTempList(listId, [...list])
  clearPlayedList()
  setActiveList(LIST_IDS.TEMP)
  void playList(LIST_IDS.TEMP, index)
}

const PlaylistItem = ({ item, onPress }: { item: { id: string; name: string; cover: string; playCount: number }; onPress: () => void }) => {
  const theme = useTheme()
  return (
    <TouchableOpacity style={styles.item} onPress={onPress}>
      <Image source={{ uri: item.cover || 'https://y.gtimg.cn/mediastyle/y/img/cover_qzone_130.jpg' }} style={styles.cover} />
      <View style={styles.info}>
        <Text style={styles.title} color={theme['c-font']} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.subtitle} color={theme['c-font-label']} size={12}>
          {item.playCount > 0 ? `${(item.playCount / 10000).toFixed(1)}万` : '推荐'}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

export default memo(({ type, onOpenDetail }: Props) => {
  const listRef = useRef<OnlineListType>(null)
  const playerMusicInfo = usePlayerMusicInfo()
  const [playlists, setPlaylists] = useState<{ id: string; name: string; cover: string; playCount: number }[]>([])
  const [loading, setLoading] = useState(false)
  const theme = useTheme()

  const loadPlaylists = useCallback(async (refresh = false) => {
    if (type !== 'home') return
    if (!refresh && playlists.length > 0) return
    setLoading(true)
    try {
      const result = await txApi.dailyRec.getHomeFeed()
      if (result && result.list) {
        setPlaylists(result.list.map((item: any) => ({
          id: String(item.id),
          name: item.name,
          cover: item.cover,
          playCount: item.playCount,
        })))
      }
    } catch (error) {
      console.error('获取QQ主页推荐失败:', error)
      toast('加载失败', 'long')
    } finally {
      setLoading(false)
    }
  }, [type, playlists.length])

  const fetchSongs = useCallback(async () => {
    try {
      let result: { list: LX.Music.MusicInfoOnline[] } | null = null

      switch (type) {
        case 'radar':
          const radarResult = await txApi.dailyRec.getRadarRecommend()
          result = { list: radarResult.list }
          break
        case 'newsong':
          const newsongResult = await txApi.dailyRec.getRecommendNewsong()
          result = { list: newsongResult.list }
          break
        default:
          return
      }

      if (result && result.list) {
        listRef.current?.setList(result.list, false)
      }
    } catch (error) {
      console.error(`获取QQ${type === 'radar' ? '雷达推荐' : '推荐新歌'}失败:`, error)
      toast('加载失败', 'long')
      listRef.current?.setStatus('error')
    } finally {
      listRef.current?.setStatus('idle')
    }
  }, [type])

  useEffect(() => {
    if (type === 'home') {
      loadPlaylists()
    } else {
      listRef.current?.setStatus('refreshing')
      fetchSongs()
    }
  }, [type, loadPlaylists, fetchSongs])

  const handleRefresh = useCallback(() => {
    if (type === 'home') {
      loadPlaylists(true)
    } else {
      listRef.current?.setStatus('refreshing')
      fetchSongs()
    }
  }, [type, loadPlaylists, fetchSongs])

  const handlePlayList = useCallback((index: number) => {
    const list = listRef.current?.getList()
    if (!list) return
    const listId = `tx_daily_rec_${type}`
    handlePlay(list, listId, index)
  }, [type])

  const handlePlaylistPress = (item: { id: string; name: string; cover: string; playCount: number }) => {
    if (onOpenDetail) {
      const listInfo: ListInfoItem = {
        id: item.id,
        name: item.name,
        img: item.cover,
        songCount: 0,
        playCount: item.playCount,
        source: 'tx',
        author: '',
      }
      onOpenDetail(listInfo)
    }
  }

  if (type === 'home') {
    return (
      <View style={{ flex: 1 }}>
        <FlatList
          data={playlists}
          renderItem={({ item }) => <PlaylistItem item={item} onPress={() => handlePlaylistPress(item)} />}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl colors={[theme['c-primary']]} refreshing={loading} onRefresh={handleRefresh} />
          }
        />
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <OnlineList
        ref={listRef}
        listId={`tx_daily_rec_${type}`}
        forcePlayList={true}
        playingId={playerMusicInfo.id}
        onPlayList={handlePlayList}
        onRefresh={handleRefresh}
        onLoadMore={() => {}}
        checkHomePagerIdle
      />
    </View>
  )
})

const styles = createStyle({
  item: {
    flexDirection: 'row',
    padding: 15,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
  },
  cover: {
    width: 60,
    height: 60,
    borderRadius: 6,
  },
  info: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '500',
  },
  subtitle: {
    marginTop: 4,
  },
})