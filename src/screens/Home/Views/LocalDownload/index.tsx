import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native'
import PageContent from '@/components/PageContent'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle, toast } from '@/utils/tools'
import { useDownloadTasks } from '@/store/download/hook'
import { useSettingValue } from '@/store/setting/hook'
import { usePlayMusicInfo } from '@/store/player/hook'
import { overwriteListMusics } from '@/core/list'
import { playList } from '@/core/player/player'
import { LIST_IDS } from '@/config/constant'
import { getDefaultDownloadPath } from '@/utils/downloadPath'
import { mkdir, readDir } from '@/utils/fs'
import { sizeFormate } from '@/utils'

type TabId = 'local' | 'download'

const AUDIO_EXTS = new Set(['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wma', 'ape'])

// 下载路径下的「本地」音乐文件夹
const getLocalDirName = () => '本地'

const getDownloadDir = (settingPath: string) => {
  const path = (settingPath ?? '').trim() || getDefaultDownloadPath()
  return path.endsWith('/') ? path.slice(0, -1) : path
}

const getExt = (name: string) => {
  const ext = name.split('.').pop()
  return ext && ext != name ? ext.toLowerCase() : ''
}

const parseFileName = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf('.')
  const rawName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  if (!rawName.includes('-')) return { name: rawName.trim(), singer: '' }
  const [left, ...rest] = rawName.split('-')
  return { name: left.trim(), singer: rest.join('-').trim() }
}

interface LocalFileItem {
  id: string
  path: string
  fileName: string
  name: string
  singer: string
  size: number
}

// 本地文件转播放器可识别结构（走 localPlay 本地播放接口）
const localFileToPlayItem = (item: LocalFileItem): any => ({
  id: item.id,
  name: item.name,
  singer: item.singer,
  source: 'local',
  interval: null,
  meta: {
    songId: item.path,
    albumName: '',
    filePath: item.path,
    ext: getExt(item.fileName),
  },
})

// 下载任务转播放器可识别结构（metadata.musicInfo 供歌词/封面/回退使用）
const taskToPlayItem = (task: LX.Download.DownloadTask): any => ({
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

const SongRow = memo(
  ({
    title,
    subText,
    isPlaying,
    onPress,
  }: {
    title: string
    subText: string
    isPlaying: boolean
    onPress: () => void
  }) => {
    const theme = useTheme()
    return (
      <TouchableOpacity
        style={{ ...styles.songItem, backgroundColor: isPlaying ? theme['c-primary-background-hover'] : 'transparent' }}
        onPress={onPress}
      >
        <View style={styles.itemInfo}>
          <Text color={isPlaying ? theme['c-primary-font'] : theme['c-font']} numberOfLines={1}>
            {title}
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
  const downloadPathSetting = useSettingValue('download.path')
  const tasks = useDownloadTasks()
  const playMusicInfo = usePlayMusicInfo()

  const [tab, setTab] = useState<TabId>('download')
  const [localFiles, setLocalFiles] = useState<LocalFileItem[]>([])
  const [loading, setLoading] = useState(false)

  const downloadDir = useMemo(() => getDownloadDir(downloadPathSetting), [downloadPathSetting])
  const localDir = useMemo(() => `${downloadDir}/${getLocalDirName()}`, [downloadDir])

  const completedTasks = useMemo(
    () => tasks.filter(task => task.status === 'completed' && task.filePath),
    [tasks]
  )

  // 扫描下载路径下的「本地」文件夹
  const scanLocalDir = useCallback(async () => {
    setLoading(true)
    try {
      await mkdir(localDir).catch(() => {})
      const files = await readDir(localDir).catch(() => [])
      const items: LocalFileItem[] = []
      for (const file of files) {
        if (!file.isFile) continue
        if (!AUDIO_EXTS.has(getExt(file.name))) continue
        const parsed = parseFileName(file.name)
        items.push({
          id: `localdl_${file.path}`,
          path: file.path,
          fileName: file.name,
          name: parsed.name,
          singer: parsed.singer,
          size: file.size,
        })
      }
      items.sort((a, b) => a.name.localeCompare(b.name))
      setLocalFiles(items)
    } finally {
      setLoading(false)
    }
  }, [localDir])

  useEffect(() => {
    void scanLocalDir()
  }, [scanLocalDir])

  const handleRefresh = useCallback(() => {
    if (loading) return
    void scanLocalDir().then(() => {
      toast('已刷新', 'short')
    })
  }, [loading, scanLocalDir])

  const handlePlayLocal = useCallback(
    (item: LocalFileItem, index: number) => {
      const playListData = localFiles.map(localFileToPlayItem)
      void overwriteListMusics(LIST_IDS.TEMP, playListData).then(() => {
        void playList(LIST_IDS.TEMP, index)
      })
    },
    [localFiles]
  )

  const handlePlayTask = useCallback(
    (task: LX.Download.DownloadTask, index: number) => {
      const playListData = completedTasks.map(taskToPlayItem)
      void overwriteListMusics(LIST_IDS.TEMP, playListData).then(() => {
        void playList(LIST_IDS.TEMP, index)
      })
    },
    [completedTasks]
  )

  const isPlayingId = playMusicInfo.musicInfo?.id

  return (
    <PageContent>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text size={18} color={theme['c-font']}>
            {t('nav_local_download')}
          </Text>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={handleRefresh}
          >
            <Text size={13} color={theme['c-primary-font-active']}>
              刷新
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ ...styles.tabs, borderColor: theme['c-border-background'] }}>
          {(['download', 'local'] as TabId[]).map(id => (
            <TouchableOpacity
              key={id}
              style={[
                styles.tabItem,
                tab === id && { ...styles.tabItemActive, backgroundColor: theme['c-primary-background-hover'] },
              ]}
              onPress={() => setTab(id)}
            >
              <Text
                size={13}
                color={tab === id ? theme['c-primary-font-active'] : theme['c-500']}
              >
                {id === 'local' ? '本地' : '下载'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text size={11} color={theme['c-500']} style={styles.tip}>
          {tab === 'download'
            ? '软件内下载的音乐，离线可播放'
            : `下载目录下的「${getLocalDirName()}」文件夹，把音频放进来即可离线播放，支持同名 .lrc 歌词`}
        </Text>

        {tab === 'download' ? (
          <FlatList
            data={completedTasks}
            keyExtractor={item => item.id}
            renderItem={({ item, index }) => (
              <SongRow
                title={item.musicInfo.name}
                subText={[
                  item.musicInfo.singer,
                  item.quality ? item.quality.toUpperCase() : '',
                  item.progress?.total ? sizeFormate(item.progress.total) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                isPlaying={isPlayingId == item.id}
                onPress={() => handlePlayTask(item, index)}
              />
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text color={theme['c-500']}>{loading ? '加载中...' : t('no_item')}</Text>
              </View>
            }
          />
        ) : (
          <FlatList
            data={localFiles}
            keyExtractor={item => item.id}
            renderItem={({ item, index }) => (
              <SongRow
                title={item.name}
                subText={[item.singer, item.size ? sizeFormate(item.size) : ''].filter(Boolean).join(' · ')}
                isPlaying={isPlayingId == item.id}
                onPress={() => handlePlayLocal(item, index)}
              />
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text color={theme['c-500']}>{loading ? '正在扫描...' : `「${getLocalDirName()}」文件夹为空`}</Text>
              </View>
            }
          />
        )}
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
  refreshBtn: {
    marginLeft: 'auto',
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 14,
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    overflow: 'hidden',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  tabItemActive: {},
  tip: {
    paddingLeft: 14,
    paddingRight: 14,
    paddingBottom: 6,
  },
  songItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 6,
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
