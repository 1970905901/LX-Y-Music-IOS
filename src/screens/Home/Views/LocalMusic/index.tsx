import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, TouchableOpacity, View } from 'react-native'
import PageContent from '@/components/PageContent'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle, toast } from '@/utils/tools'
import { useMyList } from '@/store/list/hook'
import { usePlayMusicInfo } from '@/store/player/hook'
import { getListMusics, overwriteListMusics } from '@/core/list'
import { playList } from '@/core/player/player'
import { LIST_IDS } from '@/config/constant'

type LocalMusicItem = LX.Music.MusicInfoLocal

const SongItem = memo(
  ({
    item,
    index,
    isPlaying,
    onPress,
  }: {
    item: LocalMusicItem
    index: number
    isPlaying: boolean
    onPress: (item: LocalMusicItem, index: number) => void
  }) => {
    const theme = useTheme()
    const subText = item.singer || item.meta.filePath.split(/\/|\\/).at(-1) || ''

    return (
      <TouchableOpacity
        style={{ ...styles.songItem, backgroundColor: isPlaying ? theme['c-primary-background-hover'] : 'transparent' }}
        onPress={() => onPress(item, index)}
      >
        <View style={styles.itemInfo}>
          <Text color={isPlaying ? theme['c-primary-font'] : theme['c-font']} numberOfLines={1}>
            {item.name}
          </Text>
          <Text size={11} color={isPlaying ? theme['c-primary-alpha-200'] : theme['c-500']} numberOfLines={1}>
            {subText}
          </Text>
        </View>
      </TouchableOpacity>
    )
  }
)

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const allList = useMyList()
  const playMusicInfo = usePlayMusicInfo()
  const [localSongs, setLocalSongs] = useState<LocalMusicItem[]>([])
  const [loading, setLoading] = useState(false)

  // 汇总所有用户列表中的本地歌曲（按文件路径去重）
  const loadLocalSongs = useCallback(async () => {
    setLoading(true)
    try {
      const result: LocalMusicItem[] = []
      const seen = new Set<string>()
      for (const list of allList) {
        const musics = await getListMusics(list.id).catch(() => [])
        for (const musicInfo of musics) {
          if ((musicInfo as any).source !== 'local') continue
          if (seen.has(musicInfo.id)) continue
          seen.add(musicInfo.id)
          result.push(musicInfo as LocalMusicItem)
        }
      }
      setLocalSongs(result)
    } finally {
      setLoading(false)
    }
  }, [allList])

  useEffect(() => {
    void loadLocalSongs()
  }, [loadLocalSongs])

  const handleRefresh = useCallback(() => {
    if (loading) return
    void loadLocalSongs().then(() => {
      toast('已刷新', 'short')
    })
  }, [loading, loadLocalSongs])

  const handlePlay = useCallback(
    (item: LocalMusicItem, index: number) => {
      void overwriteListMusics(LIST_IDS.TEMP, localSongs).then(() => {
        void playList(LIST_IDS.TEMP, index)
      })
    },
    [localSongs]
  )

  const tipText = useMemo(() => {
    return '本地歌曲（导入到歌单中的音乐）可离线播放；将同名 .lrc 歌词文件与音频放在同一目录即可离线显示歌词'
  }, [])

  return (
    <PageContent>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text size={18} color={theme['c-font']}>
            {t('nav_local_music')}
          </Text>
          <Text size={12} color={theme['c-500']} style={styles.countText}>
            {localSongs.length}
          </Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={handleRefresh}>
            <Text size={13} color={theme['c-primary-font-active']}>
              刷新
            </Text>
          </TouchableOpacity>
        </View>
        <Text size={11} color={theme['c-500']} style={styles.tip}>
          {tipText}
        </Text>
        <FlatList
          data={localSongs}
          keyExtractor={item => item.id}
          renderItem={({ item, index }) => (
            <SongItem
              item={item}
              index={index}
              isPlaying={playMusicInfo.musicInfo?.id == item.id}
              onPress={handlePlay}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text color={theme['c-500']}>{loading ? '加载中...' : t('no_item')}</Text>
            </View>
          }
        />
      </View>
    </PageContent>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
    paddingLeft: 14,
    paddingRight: 14,
  },
  countText: {
    marginLeft: 8,
  },
  refreshBtn: {
    marginLeft: 'auto',
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  tip: {
    paddingLeft: 14,
    paddingRight: 14,
    paddingBottom: 6,
  },
  songItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 14,
    paddingTop: 10,
    paddingBottom: 10,
  },
  itemInfo: {
    flex: 1,
    gap: 4,
  },
  empty: {
    paddingTop: 60,
    alignItems: 'center',
  },
})
