import { memo, useState, useCallback, useEffect, type ComponentProps } from 'react'
import { View, FlatList, RefreshControl, Keyboard } from 'react-native'
import { useWySubscribedAlbums } from '@/store/user/hook'
import wyApi from '@/utils/musicSdk/wy/user'
import { setWySubscribedAlbums } from '@/store/user/action'
import { createStyle, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import Text from '@/components/common/Text'
import ListItem from './ListItem'
import { useHorizontalMode } from '@/utils/hooks'
import PageTopInset from '@/components/common/PageTopInset'
import { useBottomOverlayInset } from '@/store/common/hook'

type AlbumItem = ComponentProps<typeof ListItem>['item']

// 模块级稳定引用：FlatList 的 renderItem / keyExtractor 一旦每次渲染新建，
// VirtualizedList 就会认为 props 变了，多做一轮 props 比对与单元格处理。
const keyExtractor = (item: AlbumItem) => String(item.id)

export default memo(() => {
  const subscribedAlbums = useWySubscribedAlbums()
  const [loading, setLoading] = useState(false)
  const theme = useTheme()
  const cookie = useSettingValue('common.wy_cookie')
  const isHorizontal = useHorizontalMode()
  // 底部悬浮层（迷你播放器 + 底部 Tab + 安全区）统一避让高度
  const bottomInset = useBottomOverlayInset()

  const onRefresh = useCallback(() => {
    if (!cookie) {
      setLoading(false)
      setWySubscribedAlbums([])
      return
    }
    setLoading(true)
    wyApi.getAllSubAlbumList()
      .then(albums => {
        setWySubscribedAlbums(albums)
      })
      .catch(err => {
        toast(`刷新失败: ${err.message}`)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [cookie])

  useEffect(() => {
    if (!subscribedAlbums.length && cookie) {
      onRefresh()
    }
  }, [onRefresh, subscribedAlbums.length, cookie])

  // 稳定 renderItem：只在横竖屏形态变化时重建。
  const renderItem = useCallback(({ item }: { item: AlbumItem }) => (
    <View style={isHorizontal ? styles.itemWrapper : null}>
      <ListItem item={item} showSubscribeButton={false} />
    </View>
  ), [isHorizontal])

  // 未登录占位页必须放在所有 Hook 之后：提前 return 会让 Hook 调用数量随 cookie 有无而变化，
  // cookie 从空变为有值时 React 检测到 Hook 顺序不一致会直接抛错（rules-of-hooks 报的就是这处）。
  if (!cookie) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>请先设置网易云 Cookie</Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        onScrollBeginDrag={Keyboard.dismiss}
        data={subscribedAlbums}
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
