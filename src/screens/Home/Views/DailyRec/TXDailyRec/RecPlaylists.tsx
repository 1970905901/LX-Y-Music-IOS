import { memo, useEffect, useState, useCallback } from 'react'
import { RefreshControl, View, FlatList, TouchableOpacity, Image } from 'react-native'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { createStyle, toast } from '@/utils/tools'
import { useI18n } from '@/lang'
import txApi from '@/utils/musicSdk/tx'
import { type ListInfoItem } from '@/store/songlist/state'

interface PlaylistInfo {
  id: number
  title: string
  picurl: string
  songnum: number
  listennum: number
  creator_nick: string
}

interface Props {
  onOpenDetail: (playlistInfo: ListInfoItem) => void
}

const ListItem = ({ item, onPress }: { item: PlaylistInfo; onPress: () => void }) => {
  const theme = useTheme()
  return (
    <TouchableOpacity style={styles.item} onPress={onPress}>
      <Image source={{ uri: item.picurl }} style={styles.cover} />
      <View style={styles.info}>
        <Text style={styles.title} color={theme['c-font']} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.subtitle} color={theme['c-font-label']} size={12}>
          {item.songnum}首歌 · {item.creator_nick}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

export default memo(({ onOpenDetail }: Props) => {
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([])
  const [loading, setLoading] = useState(false)
  const theme = useTheme()
  const t = useI18n()

  const loadPlaylists = useCallback(async (refresh = false) => {
    if (!refresh && playlists.length > 0) return
    setLoading(true)
    try {
      const result = await txApi.dailyRec.getRecommendSonglist()
      if (result && result.songlists) {
        setPlaylists(result.songlists)
      }
    } catch (error) {
      console.error('获取QQ推荐歌单失败:', error)
      toast(t('load_failed'), 'long')
    } finally {
      setLoading(false)
    }
  }, [playlists.length, t])

  useEffect(() => {
    loadPlaylists()
  }, [loadPlaylists])

  const handleItemPress = (playlistInfo: PlaylistInfo) => {
    const listInfo: ListInfoItem = {
      id: String(playlistInfo.id),
      name: playlistInfo.title,
      img: playlistInfo.picurl,
      songCount: playlistInfo.songnum,
      playCount: playlistInfo.listennum,
      source: 'tx',
      author: playlistInfo.creator_nick,
    }
    onOpenDetail(listInfo)
  }

  const handleRefresh = () => {
    loadPlaylists(true)
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        onScrollBeginDrag={() => {}}
        data={playlists}
        renderItem={({ item }) => <ListItem item={item} onPress={() => handleItemPress(item)} />}
        keyExtractor={(item) => String(item.id)}
        refreshControl={
          <RefreshControl colors={[theme['c-primary']]} refreshing={loading} onRefresh={handleRefresh} />
        }
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