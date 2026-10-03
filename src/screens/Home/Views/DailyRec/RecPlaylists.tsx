import { memo, useEffect, useState, useCallback, type ReactElement } from 'react'
import { View, FlatList, RefreshControl, Keyboard, StyleSheet } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'
import { toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useHorizontalMode } from '@/utils/hooks'
import wyApi from '@/utils/musicSdk/wy/dailyRec'
import wy from '@/utils/musicSdk/wy/index'
import Text from '@/components/common/Text'
import ListItem from '../MyPlaylist/ListItem'
import { useBottomOverlayInset } from '@/store/common/hook'
import { getDailyRecPlaylistsCache, setDailyRecPlaylistsCache, clearDailyRecPlaylistsCache } from '@/core/cache'

export default memo(({ header, onOpenDetail }: { header?: ReactElement, onOpenDetail: (info: any) => void }) => {
  const [playlists, setPlaylists] = useState<any[]>([])
  // loading = 首次/缓存加载态；refreshing = 只有用户下拉才置位。
  // 【2026-10-03】此前 RefreshControl.refreshing 直接接 loading（初值 true）→ 首次进入（无缓存）
  // 时首帧就被程序化置为 refreshing，iOS 撑开刷新 inset、数据到达后回弹 = 「顶部上移一下」。
  // 与 TxPlaylist/KgPlaylist/MyPlaylist 保持一致：两套状态分离。
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const cookie = useSettingValue('common.wy_cookie')
  const theme = useTheme()
  const isHorizontal = useHorizontalMode()
  // 底部悬浮层（迷你播放器 + 底部 Tab + 安全区）统一避让高度
  const bottomInset = useBottomOverlayInset()

  const loadPlaylists = useCallback((isRefresh = false) => {
    if (!cookie) {
      setLoading(false)
      setPlaylists([])
      return
    }

    if (!isRefresh) {
      const cachedPlaylists = getDailyRecPlaylistsCache()
      if (cachedPlaylists) {
        setPlaylists(cachedPlaylists)
        setLoading(false)
        return
      }
    }

    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    wyApi.getRecPlaylists(cookie).then(async(list: any) => {
      const adaptedList = list
        // .filter(item => !item.name.includes('雷达'))
        .map((item: any) => ({
          id: item.id,
          name: item.name,
          trackCount: item.trackCount,
          coverImgUrl: item.picUrl,
          creator: { nickname: item.creator?.nickname ?? '推荐' },
          playCount: item.playcount,
          description: item.copywriter,
        }))

      let isFirstRadarFound = false
      for (let i = 0; i < adaptedList.length; i++) {
        if (!isFirstRadarFound && adaptedList[i].name.includes('私人雷达') && adaptedList[i].trackCount === 0) {
          isFirstRadarFound = true
          try {
            const detail = await wy.songList.getListDetail(String(adaptedList[i].id), 1)
            if (detail?.info) {
              adaptedList[i].name = detail.info.name || adaptedList[i].name
              adaptedList[i].trackCount = detail.total != null ? detail.total : adaptedList[i].trackCount
              adaptedList[i].coverImgUrl = detail.info.img || adaptedList[i].coverImgUrl
            }
          } catch (e) {
            console.log('Failed to fetch radar detail:', e)
          }
        }
      }

      setPlaylists(adaptedList)
      setDailyRecPlaylistsCache(adaptedList)
    }).catch((err: any) => {
      toast(`获取推荐歌单失败: ${err.message}`)
    }).finally(() => {
      setLoading(false)
      setRefreshing(false)
    })
  }, [cookie])

  useEffect(() => {
    loadPlaylists()
  }, [loadPlaylists])

  const handleItemPress = (playlistInfo: any) => {
    onOpenDetail(playlistInfo)
  }

  const handleRefresh = () => {
    clearDailyRecPlaylistsCache()
    loadPlaylists(true)
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ListHeaderComponent={header}
        onScrollBeginDrag={Keyboard.dismiss}
        data={playlists}
        contentContainerStyle={{ paddingBottom: bottomInset }}
        key={isHorizontal ? 'horizontal' : 'vertical'}
        numColumns={isHorizontal ? 2 : 1}
        columnWrapperStyle={isHorizontal ? { paddingHorizontal: 8 } : undefined}
        renderItem={({ item }) => (
          <View style={isHorizontal ? { flex: 1, maxWidth: '50%' } : null}>
            <ListItem item={item} onPress={handleItemPress} />
          </View>
        )}
        keyExtractor={item => String(item.id)}
        ListEmptyComponent={
          <View style={styles.emptyHint}>
            <Text size={13} color={theme['c-500']}>{loading ? '加载中...' : '暂无歌单'}</Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            colors={[theme['c-primary']]}
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        }
      />
    </View>
  )
})

const styles = StyleSheet.create({
  emptyHint: {
    paddingTop: 24,
    alignItems: 'center',
  },
})


