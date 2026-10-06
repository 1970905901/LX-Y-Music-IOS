import { memo, useEffect, useState, useCallback, type ReactElement } from 'react'
import { RefreshControl, View, FlatList, TouchableOpacity, Image } from 'react-native'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useHorizontalMode } from '@/utils/hooks'
import { createStyle, toast } from '@/utils/tools'
import { useI18n } from '@/lang'
import txApi from '@/utils/musicSdk/tx'
import { type ListInfoItem } from '@/store/songlist/state'
import { useBottomOverlayInset } from '@/store/common/hook'

interface PlaylistInfo {
  id: number
  title: string
  picurl: string
  songnum: number
  listennum: number
  creator_nick: string
}

interface Props {
  header?: ReactElement
  onOpenDetail: (playlistInfo: ListInfoItem) => void
}

// 模块级稳定引用：FlatList 的 renderItem / keyExtractor 一旦每次渲染新建，
// VirtualizedList 就会认为 props 变了，多做一轮 props 比对与单元格处理。
const keyExtractor = (item: PlaylistInfo) => String(item.id)
const NOOP = () => {}

const ListItem = ({ item, onPress }: { item: PlaylistInfo, onPress: () => void }) => {
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

export default memo(({ header, onOpenDetail }: Props) => {
  const [playlists, setPlaylists] = useState<PlaylistInfo[]>([])
  const [loading, setLoading] = useState(false)
  const theme = useTheme()
  const isHorizontal = useHorizontalMode()
  const t = useI18n()
  // 底部悬浮层（迷你播放器 + 底部 Tab + 安全区）统一避让高度
  const bottomInset = useBottomOverlayInset()

  const loadPlaylists = useCallback(async(refresh = false) => {
    if (!refresh && playlists.length > 0) return
    setLoading(true)
    try {
      const result = await txApi.dailyRec.getRecommendSonglist()
      if (result?.songlists) {
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

  // useCallback：renderItem 依赖它，必须与之一同稳定。
  const handleItemPress = useCallback((playlistInfo: PlaylistInfo) => {
    const listInfo = {
      id: String(playlistInfo.id),
      name: playlistInfo.title,
      img: playlistInfo.picurl,
      songCount: playlistInfo.songnum,
      playCount: playlistInfo.listennum,
      source: 'tx',
      author: playlistInfo.creator_nick,
    } as ListInfoItem
    onOpenDetail(listInfo)
  }, [onOpenDetail])

  const handleRefresh = () => {
    loadPlaylists(true)
  }

  // 稳定 renderItem：依赖项均为稳定引用或低频变化值。
  const renderItem = useCallback(({ item }: { item: PlaylistInfo }) => (
    <View style={isHorizontal ? styles.itemWrapper : null}>
      <ListItem item={item} onPress={() => { handleItemPress(item) }} />
    </View>
  ), [isHorizontal, handleItemPress])

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        onScrollBeginDrag={NOOP}
        ListHeaderComponent={header}
        data={playlists}
        contentContainerStyle={{ paddingBottom: bottomInset }}
        key={isHorizontal ? 'horizontal' : 'vertical'}
        numColumns={isHorizontal ? 2 : 1}
        columnWrapperStyle={isHorizontal ? styles.columnWrapper : undefined}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        refreshControl={
          <RefreshControl colors={[theme['c-primary']]} refreshing={loading} onRefresh={handleRefresh} />
        }
      />
    </View>
  )
})

const styles = createStyle({
  columnWrapper: {
    paddingHorizontal: 8,
  },
  itemWrapper: {
    flex: 1,
    maxWidth: '50%',
  },
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
