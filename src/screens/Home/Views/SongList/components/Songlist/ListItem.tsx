import { memo, useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { createStyle } from '@/utils/tools'
import { type ListInfoItem } from '@/store/songlist/state'
import Text from '@/components/common/Text'
import { scaleSizeW } from '@/utils/pixelRatio'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import { useTheme } from '@/store/theme/hook'
import Image from '@/components/common/Image'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import { formatPlayCount } from '@/utils'

const gap = scaleSizeW(15)

interface ListItemProps {
  item: ListInfoItem
  index: number
  showSource: boolean
  width: number
  onPress: (item: ListInfoItem, index: number) => void
}

const formatCount = (value: ListInfoItem['play_count']) => {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? formatPlayCount(count) : ''
}

export default memo(({
  item,
  index,
  width,
  showSource,
  onPress,
}: ListItemProps) => {
  const theme = useTheme()
  const itemWidth = width - gap
  const playCount = formatCount(item.play_count)

  const handlePress = () => {
    onPress(item, index)
  }

  const coverStyle = useMemo(
    () => StyleSheet.compose(styles.cover, {
      backgroundColor: theme['c-primary-light-900-alpha-200'],
    }),
    [theme],
  )

  const titleStyle = useMemo(
    () => StyleSheet.compose(styles.title, {
      color: theme['c-font'],
    }),
    [theme],
  )

  return item.source ? (
    <Pressable style={[styles.card, { width: itemWidth, margin: gap / 2 }]} onPress={handlePress}>
      <View style={styles.coverWrapper}>
        <Image
          url={item.img}
          nativeID={`${NAV_SHEAR_NATIVE_IDS.songlistDetail_pic}_from_${item.id}`}
          style={coverStyle}
        />
        {showSource ? (
          <Text style={styles.sourceLabel} size={11} color="#FFFFFF">
            {item.source.toUpperCase()}
          </Text>
        ) : null}
        {playCount ? (
          <Text style={styles.playCount} size={11} color="#FFFFFF" numberOfLines={1}>
            {playCount}
          </Text>
        ) : null}
      </View>
      <Text style={titleStyle} size={designTypography.body} numberOfLines={2}>
        {item.name}
      </Text>
    </Pressable>
  ) : (
    <View style={{ ...styles.placeholder, width: itemWidth }} />
  )
})

const styles = createStyle({
  card: {
    borderRadius: designRadius.md,
    // 不能加 overflow: 'hidden'：圆角 + 裁剪会把紧贴卡片边缘的标题字形削掉半截
    // （封面自身的圆角裁剪由 cover 的 overflow: 'hidden' 负责）
    paddingBottom: 2,
  },
  coverWrapper: {
    position: 'relative',
  },
  cover: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: designRadius.md,
    overflow: 'hidden',
  },
  sourceLabel: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    // 水平内边距必须 ≥ 圆角半径（胶囊高度的一半），否则圆弧会削掉首尾字形；
    // 圆角背景无需裁剪内容，移除 overflow: 'hidden'。
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  playCount: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  title: {
    marginTop: designSpacing.sm,
    fontWeight: '600',
    lineHeight: designTypography.body * 1.3,
  },
  placeholder: {
    margin: gap / 2,
  },
})
