import { memo, useState, useCallback, type ComponentProps } from 'react'
import { View, FlatList, RefreshControl, Keyboard } from 'react-native'
import ListItem from './ListItem'
import { useWyFollowedArtists } from '@/store/user/hook.ts'
import wyApi from '@/utils/musicSdk/wy/user'
import { setWyFollowedArtists } from '@/store/user/action'
import { createStyle, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useHorizontalMode } from '@/utils/hooks'
import PageTopInset from '@/components/common/PageTopInset'
import { useBottomOverlayInset } from '@/store/common/hook'

type ArtistItem = ComponentProps<typeof ListItem>['artist']

// 模块级稳定引用：FlatList 的 renderItem / keyExtractor 一旦每次渲染新建，
// VirtualizedList 就会认为 props 变了，多做一轮 props 比对与单元格处理。
const keyExtractor = (item: ArtistItem) => String(item.id)

export default memo(() => {
  const followedArtists = useWyFollowedArtists()
  const [loading, setLoading] = useState(false)
  const theme = useTheme()
  const isHorizontal = useHorizontalMode()
  // 底部悬浮层（迷你播放器 + 底部 Tab + 安全区）统一避让高度
  const bottomInset = useBottomOverlayInset()
  const onRefresh = useCallback(() => {
    setLoading(true)
    wyApi.getAllSublist()
      .then(artists => {
        setWyFollowedArtists(artists)
      })
      .catch(err => {
        toast(`刷新失败: ${err.message}`)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  // 稳定 renderItem：只在横竖屏形态变化时重建，列表滚动/父级重渲染都不会换新引用。
  const renderItem = useCallback(({ item }: { item: ArtistItem }) => (
    <View style={isHorizontal ? styles.itemWrapper : null}>
      <ListItem artist={item} />
    </View>
  ), [isHorizontal])

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        onScrollBeginDrag={Keyboard.dismiss}
        data={followedArtists}
        ListHeaderComponent={PageTopInset}
        contentContainerStyle={{ paddingBottom: bottomInset }}
        key={isHorizontal ? 'horizontal' : 'vertical'}
        numColumns={isHorizontal ? 2 : 1}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        columnWrapperStyle={isHorizontal ? styles.columnWrapper : undefined}
        refreshControl={
          <RefreshControl
            colors={[theme['c-primary']]}
            refreshing={loading}
            onRefresh={onRefresh}
          />
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
})
