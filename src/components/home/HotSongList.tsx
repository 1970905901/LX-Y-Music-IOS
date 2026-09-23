import { memo, useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import Image from '@/components/common/Image'
import SectionHeader from '@/components/common/SectionHeader'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'

interface HotSongListProps {
  title: string
  actionLabel?: string
  onPressAction?: () => void
  songs: LX.Music.MusicInfoOnline[]
  onSongPress: (song: LX.Music.MusicInfoOnline, index: number) => void
}

const styles = createStyle({
  card: {
    marginHorizontal: designSpacing.lg,
    paddingVertical: designSpacing.sm,
    borderRadius: designRadius.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designSpacing.md,
    paddingVertical: designSpacing.sm,
  },
  rank: {
    width: 28,
    alignItems: 'center',
    fontWeight: '800',
  },
  cover: {
    width: 46,
    height: 46,
    borderRadius: designRadius.md,
    marginLeft: designSpacing.sm,
  },
  content: {
    flex: 1,
    paddingHorizontal: designSpacing.md,
  },
  name: {
    fontWeight: '600',
  },
  artist: {
    marginTop: 3,
  },
  playButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

export default memo(({
  title,
  actionLabel,
  onPressAction,
  songs,
  onSongPress,
}: HotSongListProps) => {
  const theme = useTheme()

  const cardStyle = useMemo(
    () => StyleSheet.compose(styles.card, {
      backgroundColor: theme['c-content-background'],
      borderColor: theme['c-border-background'],
      borderWidth: 1,
    }),
    [theme],
  )

  const rankStyle = useMemo(
    () => StyleSheet.compose(styles.rank, {
      color: theme['c-primary'],
    }),
    [theme],
  )

  const coverStyle = useMemo(
    () => StyleSheet.compose(styles.cover, {
      backgroundColor: theme['c-primary-light-900-alpha-200'],
    }),
    [theme],
  )

  const nameStyle = useMemo(
    () => StyleSheet.compose(styles.name, {
      color: theme['c-font'],
    }),
    [theme],
  )

  const artistStyle = useMemo(
    () => StyleSheet.compose(styles.artist, {
      color: theme['c-font-label'],
    }),
    [theme],
  )

  const playButtonStyle = useMemo(
    () => StyleSheet.compose(styles.playButton, {
      backgroundColor: theme['c-primary-light-900-alpha-200'],
    }),
    [theme],
  )

  return (
    <>
      <SectionHeader title={title} actionLabel={actionLabel} onPressAction={onPressAction} />
      <View style={cardStyle}>
        {songs.map((song, index) => (
          <Pressable
            key={song.id}
            style={styles.row}
            onPress={() => onSongPress(song, index)}
          >
            <Text style={rankStyle} size={15}>{index + 1}</Text>
            <Image style={coverStyle} url={song.meta.picUrl ?? song.pic} />
            <View style={styles.content}>
              <Text style={nameStyle} size={designTypography.body} numberOfLines={1}>
                {song.name}
              </Text>
              <Text style={artistStyle} size={designTypography.caption} numberOfLines={1}>
                {song.singer}
              </Text>
            </View>
            <View style={playButtonStyle}>
              <Icon name="play" size={15} color={theme['c-primary']} />
            </View>
          </Pressable>
        ))}
      </View>
    </>
  )
})
