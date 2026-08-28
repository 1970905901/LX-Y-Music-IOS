import { memo, useCallback, useMemo } from 'react'
import { FlatList, TouchableOpacity, View } from 'react-native'
import PageContent from '@/components/PageContent'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { useDownloadTasks } from '@/store/download/hook'
import { usePlayMusicInfo } from '@/store/player/hook'
import { overwriteListMusics } from '@/core/list'
import { playList } from '@/core/player/player'
import { LIST_IDS } from '@/config/constant'
import { sizeFormate } from '@/utils'

type PlayableTask = LX.Download.DownloadTask

// 转为播放器可识别的 ListItem 结构（metadata.musicInfo 供播放策略/歌词/封面使用）
const toPlayItem = (task: PlayableTask): LX.Download.ListItem => ({
  id: task.id,
  isComplate: true,
  status: task.status,
  statusText: '',
  downloaded: task.progress?.downloaded ?? 0,
  total: task.progress?.total ?? 0,
  progress: task.progress?.percent ?? 1,
  speed: '',
  metadata: {
    musicInfo: task.musicInfo as LX.Music.MusicInfoOnline,
    url: null,
    quality: task.quality,
    ext: (task.fileName.split('.').pop() as any) ?? 'mp3',
    fileName: task.fileName,
    filePath: task.filePath,
  },
})

const SongItem = memo(
  ({
    item,
    index,
    isPlaying,
    onPress,
  }: {
    item: PlayableTask
    index: number
    isPlaying: boolean
    onPress: (item: PlayableTask, index: number) => void
  }) => {
    const theme = useTheme()
    const size = item.progress?.total || 0
    const subText = [item.musicInfo.singer, item.quality ? item.quality.toUpperCase() : '', size ? sizeFormate(size) : '']
      .filter(Boolean)
      .join(' · ')

    return (
      <TouchableOpacity
        style={{ ...styles.songItem, backgroundColor: isPlaying ? theme['c-primary-background-hover'] : 'transparent' }}
        onPress={() => onPress(item, index)}
      >
        <View style={styles.itemInfo}>
          <Text color={isPlaying ? theme['c-primary-font'] : theme['c-font']} numberOfLines={1}>
            {item.musicInfo.name}
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
  const tasks = useDownloadTasks()
  const playMusicInfo = usePlayMusicInfo()

  const completedTasks = useMemo(
    () => tasks.filter(task => task.status === 'completed' && task.filePath),
    [tasks]
  )

  const handlePlay = useCallback(
    (item: PlayableTask, index: number) => {
      const playListData = completedTasks.map(toPlayItem)
      void overwriteListMusics(LIST_IDS.TEMP, playListData as any).then(() => {
        void playList(LIST_IDS.TEMP, index)
      })
    },
    [completedTasks]
  )

  return (
    <PageContent>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text size={18} color={theme['c-font']}>
            {t('nav_download_music')}
          </Text>
          <Text size={12} color={theme['c-500']} style={styles.countText}>
            {completedTasks.length}
          </Text>
        </View>
        <FlatList
          data={completedTasks}
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
              <Text color={theme['c-500']}>{t('no_item')}</Text>
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
