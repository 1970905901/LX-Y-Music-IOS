import { memo, useMemo } from 'react'
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
        keyExtractor={(item) => `${item.source}-${item.id}`}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <PlaylistCard item={item} width={cardWidth} onPress={onPressItem} />
          </View>
        )}
      />
    </>
  )
})
HorizontalShelf.displayName = 'HomeHorizontalShelf'
export default HorizontalShelf
