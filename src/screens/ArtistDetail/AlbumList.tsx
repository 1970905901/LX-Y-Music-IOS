import { memo, useCallback, useMemo } from 'react'
import { FlatList, View, RefreshControl } from 'react-native'
import AlbumListItem from './AlbumListItem'
import { useHorizontalMode, useLayout } from '@/utils/hooks'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { scaleSizeW } from '@/utils/pixelRatio'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { useBottomOverlayInset } from '@/store/common/hook'

const MIN_WIDTH = scaleSizeW(120)
const HORIZONTAL_SPACING = 24

// 模块级稳定引用：FlatList 的 keyExtractor 每次渲染新建会让 VirtualizedList 认为
// props 变了，多做一轮 props 比对。（renderItem 已是稳定 useCallback。）
// albums 的 prop 类型是 any[]，故与 renderItem 一致用 any。
const keyExtractor = (item: any) => String(item.id)

interface AlbumListProps {
  componentId: string
  albums: any[]
  loading: boolean
  hasMore: boolean
  onLoadMore: () => void
  onRefresh: () => void
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null
  viewMode: 'grid' | 'list'
}

export default memo(({ componentId, albums, loading, hasMore, onLoadMore, onRefresh, ListHeaderComponent, viewMode }: AlbumListProps) => {
  const { onLayout, width } = useLayout()
  const theme = useTheme()
  const t = useI18n()
  const isHorizontal = useHorizontalMode()
  // 底部悬浮层（迷你播放器 + 安全区）统一避让高度
  const bottomInset = useBottomOverlayInset()

  const rowInfo = useMemo(() => {
    if (width === 0) return { num: 3, itemWidth: 0 }
    if (viewMode === 'list') {
      const num = isHorizontal ? 2 : 1
      const totalSpacing = HORIZONTAL_SPACING * (num - 1)
      const itemWidth = Math.floor((width - totalSpacing) / num)
      return { num, itemWidth }
    }
    const num = Math.max(Math.floor((width + HORIZONTAL_SPACING) / (MIN_WIDTH + HORIZONTAL_SPACING)), 3)
    const totalSpacing = HORIZONTAL_SPACING * (num - 1)
    const itemWidth = Math.floor((width - totalSpacing) / num)
    return { num, itemWidth }
  }, [width, viewMode, isHorizontal])

  const renderItem = useCallback(({ item }: { item: any }) => {
    if (item.id.toString().startsWith('white__')) {
      return <View style={{ width: rowInfo.itemWidth }} />
    }
    return <AlbumListItem componentId={componentId} item={item} width={rowInfo.itemWidth} viewMode={viewMode} />
  }, [componentId, rowInfo.itemWidth, viewMode])

  const list = useMemo(() => {
    const list = [...albums]
    if (rowInfo.num <= 1) return list
    if (rowInfo.num === 0) return list // Avoid division by zero
    let whiteItemNum = list.length % rowInfo.num
    if (whiteItemNum > 0) whiteItemNum = rowInfo.num - whiteItemNum
    for (let i = 0; i < whiteItemNum; i++) {
      list.push({ id: `white__${i}` })
    }
    return list
  }, [albums, rowInfo.num])

  // 原写法把 Footer 定义成组件函数并按组件类型传给 ListFooterComponent —— 每次渲染都是
  // 一个新函数类型，React 会判定类型不同而卸载重建整棵 Footer 子树。改为传记忆化元素。
  const listFooter = useMemo(() => {
    let text = ''
    if (loading && albums.length > 0) text = t('list_loading')
    else if (!hasMore) text = t('list_end')
    return (
      <View style={styles.footer}>
        <Text color={theme['c-font-label']}>{text}</Text>
      </View>
    )
  }, [loading, albums.length, hasMore, t, theme])

  return (
    <View style={styles.container} onLayout={onLayout}>
      {width > 0 && (
        <FlatList
          key={String(rowInfo.num) + viewMode}
          numColumns={rowInfo.num}
          data={list}
          // 底部内边距：让专辑列表能滚到屏幕底部，最后一行停下时让位给悬浮的迷你播放器。
          contentContainerStyle={{ paddingBottom: bottomInset }}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={ListHeaderComponent}
          ListFooterComponent={listFooter}
          refreshControl={
            <RefreshControl
              colors={[theme['c-primary']]}
              refreshing={loading && albums.length === 0}
              onRefresh={onRefresh}
            />
          }
          columnWrapperStyle={rowInfo.num > 1 ? styles.row : undefined}
        />
      )}
    </View>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
    paddingHorizontal: 8,
  },
  row: {
    justifyContent: 'space-between',
  },
  footer: {
    width: '100%',
    paddingVertical: 10,
    alignItems: 'center',
  },
})
