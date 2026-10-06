import { memo, useCallback, useMemo } from 'react'
import { FlatList, StyleSheet, View } from 'react-native'
import { createStyle } from '@/utils/tools'
import { designSpacing } from '@/theme/DesignTokens'
import type { ListInfoItem } from '@/store/songlist/state'
import SectionHeader from '@/components/common/SectionHeader'
import PlaylistCard from './PlaylistCard'

interface HorizontalShelfProps {
  title: string
  data: ListInfoItem[]
  cardWidth: number
  onPressItem: (item: ListInfoItem) => void
}

// 模块级稳定引用：横向货架是首页最长的列表，renderItem / keyExtractor 若每次渲染新建，
// VirtualizedList 每帧都要重新比对全部 props。
const keyExtractor = (item: ListInfoItem) => `${item.source}-${item.id}`

const styles = createStyle({
  list: {
    flexGrow: 0,
  },
  content: {
    paddingLeft: designSpacing.lg,
    paddingRight: designSpacing.md,
  },
  item: {
    marginRight: designSpacing.sm,
  },
})

const HorizontalShelf = memo(({ title, data, cardWidth, onPressItem }: HorizontalShelfProps) => {
  const contentStyle = useMemo(
    () => StyleSheet.compose(styles.content, {
      paddingLeft: designSpacing.lg,
    }),
    [],
  )

  const renderItem = useCallback(({ item }: { item: ListInfoItem }) => (
    <View style={styles.item}>
      <PlaylistCard item={item} width={cardWidth} onPress={onPressItem} />
    </View>
  ), [cardWidth, onPressItem])

  return (
    <>
      <SectionHeader title={title} />
      <FlatList
        style={styles.list}
        contentContainerStyle={contentStyle}
        data={data}
        horizontal
        showsHorizontalScrollIndicator={false}
        // 嵌套滚动容器内卡片触摸立即下发，避免概率性点击无响应
        delaysContentTouches={false}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
      />
    </>
  )
})
HorizontalShelf.displayName = 'HomeHorizontalShelf'
export default HorizontalShelf
