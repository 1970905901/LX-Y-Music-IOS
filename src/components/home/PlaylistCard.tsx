import { memo, useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { designRadius, designTypography } from '@/theme/DesignTokens'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import type { ListInfoItem } from '@/store/songlist/state'
import Image from '@/components/common/Image'
import Text from '@/components/common/Text'

interface PlaylistCardProps {
  item: ListInfoItem
  width: number
  onPress: (item: ListInfoItem) => void
}

const styles = createStyle({
  cover: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: designRadius.md,
    overflow: 'hidden',
  },
  playCount: {
    position: 'absolute',
    top: designRadius.sm,
    right: designRadius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
    overflow: 'hidden',
  },
  title: {
    marginTop: designRadius.sm,
    fontWeight: '600',
  },
})

export default memo(({ item, width, onPress }: PlaylistCardProps) => {
  const theme = useTheme()

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

  return (
    <Pressable style={{ width }} onPress={() => onPress(item)}>
      <View>
        <Image
          style={coverStyle}
          url={item.img}
          nativeID={`${NAV_SHEAR_NATIVE_IDS.songlistDetail_pic}_from_${item.id}`}
        />
        {item.play_count ? (
          <View style={styles.playCount}>
            <Text size={11} color="#FFFFFF" numberOfLines={1}>{item.play_count}</Text>
          </View>
        ) : null}
      </View>
      <Text style={titleStyle} size={designTypography.body} numberOfLines={2}>
        {item.name}
      </Text>
    </Pressable>
  )
})
