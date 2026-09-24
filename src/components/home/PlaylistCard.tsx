import { memo, useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import type { ListInfoItem } from '@/store/songlist/state'
import { formatPlayCount } from '@/utils'
import Image from '@/components/common/Image'
import Text from '@/components/common/Text'

interface PlaylistCardProps {
  item: ListInfoItem
  width: number
  onPress: (item: ListInfoItem) => void
}

const styles = createStyle({
  card: {
    borderRadius: designRadius.md,
    overflow: 'hidden',
  },
  cover: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: designRadius.sm,
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
    marginTop: designSpacing.sm,
    fontWeight: '600',
  },
  subtitle: {
    marginTop: 3,
  },
})

const PlaylistCard = memo(({ item, width, onPress }: PlaylistCardProps) => {
  const theme = useTheme()
  const playCount = Number(item.play_count)

  const cardStyle = useMemo(
    () => StyleSheet.compose(styles.card, {
      backgroundColor: theme['c-content-background'],
      borderColor: theme['c-border-background'],
      borderWidth: 1,
    }),
    [theme],
  )

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

  const subtitleStyle = useMemo(
    () => StyleSheet.compose(styles.subtitle, {
      color: theme['c-font-label'],
    }),
    [theme],
  )

  const subtitle = [item.source.toUpperCase(), item.author].filter(Boolean).join(' · ')

  return (
    <Pressable
      style={[cardStyle, { width, padding: designSpacing.sm }]}
      onPress={() => { onPress(item) }}
    >
      <View>
        <Image
          style={coverStyle}
          url={item.img}
          nativeID={`${NAV_SHEAR_NATIVE_IDS.songlistDetail_pic}_from_${item.id}`}
        />
        {Number.isFinite(playCount) && playCount > 0 ? (
          <View style={styles.playCount}>
            <Text size={11} color="#FFFFFF" numberOfLines={1}>{formatPlayCount(playCount)}</Text>
          </View>
        ) : null}
      </View>
      <Text style={titleStyle} size={designTypography.body} numberOfLines={2}>
        {item.name}
      </Text>
      {subtitle ? (
        <Text style={subtitleStyle} size={designTypography.caption} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  )
})
PlaylistCard.displayName = 'HomePlaylistCard'
export default PlaylistCard
