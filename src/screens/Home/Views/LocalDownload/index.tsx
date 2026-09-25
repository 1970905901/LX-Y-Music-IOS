import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native'
import LandscapeDetailLayout from '@/components/LandscapeDetailLayout'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useHorizontalMode } from '@/utils/hooks'
import { useI18n } from '@/lang'
import { createStyle, toast } from '@/utils/tools'
import { useDownloadTasks } from '@/store/download/hook'
import { useSettingValue } from '@/store/setting/hook'
import { usePlayMusicInfo } from '@/store/player/hook'
import { overwriteListMusics } from '@/core/list'
import { playList } from '@/core/player/player'
import { LIST_IDS } from '@/config/constant'
import { getDefaultDownloadPath } from '@/utils/downloadPath'
import downloadActions from '@/store/download/action'
import { mkdir, readDir, unlink, stat } from '@/utils/fs'
import { sizeFormate } from '@/utils'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import { useSafeAreaBottom } from '@/store/common/hook'
import PageTopInset from '@/components/common/PageTopInset'

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
    selected,
    onPress,
  }: {
    title: string
    subText: string
    isPlaying: boolean
    selected: boolean
    onPress: () => void
  }) => {
    const theme = useTheme()
    return (
      <TouchableOpacity
        style={{
          ...styles.songItem,
          backgroundColor: isPlaying || selected
            ? theme['c-primary-background-hover']
            : theme['c-content-background'],
          borderColor: isPlaying || selected
            ? theme['c-primary-background-active']
            : theme['c-border-background'],
        }}
        onPress={onPress}
      >
        <View style={styles.itemInfo}>
          <Text
            size={designTypography.body}
            style={styles.songTitle}
            color={isPlaying ? theme['c-primary-font'] : theme['c-font']}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text
            size={designTypography.caption}
            color={isPlaying ? theme['c-primary-alpha-200'] : theme['c-500']}
            numberOfLines={1}
          >
            {subText}
          </Text>
        </View>
        {selected && (
          <View style={{ ...styles.selectedMark, borderColor: theme['c-primary-background-active'] }}>
            <Text size={13} color={theme['c-primary-font-active']}>
              ✓
            </Text>
          </View>
        )}
      </TouchableOpacity>
    )
  },
)

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const isHorizontal = useHorizontalMode()
  const safeAreaBottom = useSafeAreaBottom()
  const downloadPathSetting = useSettingValue('download.path')
  const tasks = useDownloadTasks()
  const playMusicInfo = usePlayMusicInfo()

  const [tab, setTab] = useState<TabId>('download')
  const [localFiles, setLocalFiles] = useState<LocalFileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [taskSizes, setTaskSizes] = useState<Record<string, number>>({})

  const downloadDir = useMemo(() => getDownloadDir(downloadPathSetting), [downloadPathSetting])
  const localDir = useMemo(() => `${downloadDir}/${getLocalDirName()}`, [downloadDir])

  const completedTasks = useMemo(
    () => tasks.filter(task => task.status === 'completed' && task.filePath),
    [tasks],
  )

  // 读取已完成下载文件的真实大小（progress.total 在某些场景为 0，导致页面上不显示大小）
  const completedKey = useMemo(
    () => completedTasks.map(task => task.id).join(','),
    [completedTasks],
  )
  useEffect(() => {
    let active = true
    if (completedTasks.length === 0) {
      setTaskSizes({})
      return
    }
    void Promise.all(
      completedTasks.map(async task => {
        if (!task.filePath) return null
        try {
          const info = await stat(task.filePath)
          return { id: task.id, size: info.size }
        } catch {
          return null
        }
      }),
    ).then(results => {
      if (!active) return
      const next: Record<string, number> = {}
      for (const r of results) {
        if (r) next[r.id] = r.size
      }
      setTaskSizes(next)
    })
    return () => {
      active = false
    }
  }, [completedKey])

  // 扫描下载路径下的「本地」文件夹
  const scanLocalDir = useCallback(async() => {
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
    [localFiles],
  )

  const handlePlayTask = useCallback(
    (task: LX.Download.DownloadTask, index: number) => {
      const playListData = completedTasks.map(taskToPlayItem)
      void overwriteListMusics(LIST_IDS.TEMP, playListData).then(() => {
        void playList(LIST_IDS.TEMP, index)
      })
    },
    [completedTasks],
  )

  // 批量管理模式：点击行改为切换选中，底部出现 全选 / 已选 / 删除 操作栏
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const enterSelecting = useCallback(() => {
    setSelecting(true)
    setSelectedIds(new Set())
  }, [])

  const exitSelecting = useCallback(() => {
    setSelecting(false)
    setSelectedIds(new Set())
  }, [])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    const current = tab === 'download' ? completedTasks : localFiles
    const allIds = current.map(i => i.id)
    const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id))
    setSelectedIds(allSelected ? new Set() : new Set(allIds))
  }, [tab, completedTasks, localFiles, selectedIds])

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return
    if (tab === 'download') {
      for (const id of selectedIds) {
        const task = completedTasks.find(t => t.id === id)
        if (!task) continue
        const removeFile = task.filePath ? unlink(task.filePath).catch(() => {}) : Promise.resolve()
        void removeFile.then(() => { downloadActions.removeTask(id) })
      }
    } else {
      for (const id of selectedIds) {
        const item = localFiles.find(f => f.id === id)
        if (!item) continue
        void unlink(item.path).catch(() => {})
      }
    }
    toast('已删除', 'short')
    exitSelecting()
    void scanLocalDir()
  }, [selectedIds, tab, completedTasks, localFiles, exitSelecting, scanLocalDir])

  const isPlayingId = playMusicInfo.musicInfo?.id

  const pageHeader = (
    <>
      {/* 竖屏下共享页头已含状态栏占位，这里再叠加 PageTopInset 会出现大段空白；
          仅横屏（LandscapeDetailLayout 自带页头、共享页头隐藏）需要保留 */}
      {isHorizontal ? <PageTopInset /> : null}
          <View style={styles.header}>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={{ ...styles.headerBtn, backgroundColor: theme['c-primary-background'] }}
                onPress={selecting ? exitSelecting : enterSelecting}
              >
                <Text size={designTypography.caption} color={theme['c-primary-font']}>
                  {selecting ? '取消' : '批量管理'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ ...styles.refreshBtn, backgroundColor: theme['c-primary-background'] }}
                onPress={handleRefresh}
              >
                <Text size={designTypography.caption} color={theme['c-primary-font']}>
                  刷新
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ ...styles.tabs, borderColor: theme['c-border-background'] }}>
            {(['download', 'local'] as TabId[]).map(id => (
              <TouchableOpacity
                key={id}
                style={[
                  styles.tabItem,
                  tab === id && { ...styles.tabItemActive, backgroundColor: theme['c-primary'] },
                ]}
                onPress={() => { setTab(id) }}
              >
                <Text
                  size={designTypography.caption}
                  color={tab === id ? theme['c-primary-light-1000'] : theme['c-font-label']}
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
    </>
  )

  return (
    <LandscapeDetailLayout
      header={isHorizontal ? pageHeader : null}
      body={
        <View style={styles.listArea}>
          {tab === 'download' ? (
            <FlatList
              style={styles.list}
              data={completedTasks}
              ListHeaderComponent={isHorizontal ? undefined : pageHeader}
              contentContainerStyle={{ paddingBottom: 180 + safeAreaBottom }}
              key={isHorizontal ? 'horizontal' : 'vertical'}
              numColumns={isHorizontal ? 2 : 1}
              columnWrapperStyle={isHorizontal ? styles.columnWrapper : undefined}
              keyExtractor={item => item.id}
              renderItem={({ item, index }) => {
                const fileSize = taskSizes[item.id] ?? item.progress?.total ?? 0
                return (
                <View style={isHorizontal ? styles.itemWrapper : null}>
                  <SongRow
                    title={item.musicInfo.name}
                    subText={[
                      item.musicInfo.singer,
                      item.quality ? item.quality.toUpperCase() : '',
                      fileSize ? sizeFormate(fileSize) : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    isPlaying={isPlayingId == item.id}
                    selected={selectedIds.has(item.id)}
                    onPress={() => { selecting ? toggleSelect(item.id) : handlePlayTask(item, index) }}
                  />
                </View>
                )
              }
            }
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text color={theme['c-500']}>{loading ? '加载中...' : t('no_item')}</Text>
                </View>
              }
            />
          ) : (
            <FlatList
              style={styles.list}
              data={localFiles}
              ListHeaderComponent={isHorizontal ? undefined : pageHeader}
              contentContainerStyle={{ paddingBottom: 180 + safeAreaBottom }}
              key={isHorizontal ? 'horizontal' : 'vertical'}
              numColumns={isHorizontal ? 2 : 1}
              columnWrapperStyle={isHorizontal ? styles.columnWrapper : undefined}
              keyExtractor={item => item.id}
              renderItem={({ item, index }) => (
                <View style={isHorizontal ? styles.itemWrapper : null}>
                  <SongRow
                    title={item.name}
                    subText={[item.singer, item.size ? sizeFormate(item.size) : ''].filter(Boolean).join(' · ')}
                    isPlaying={isPlayingId == item.id}
                    selected={selectedIds.has(item.id)}
                    onPress={() => { selecting ? toggleSelect(item.id) : handlePlayLocal(item, index) }}
                  />
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text color={theme['c-500']}>{loading ? '正在扫描...' : `「${getLocalDirName()}」文件夹为空`}</Text>
                </View>
              }
            />
          )}

          {selecting && (
            <View
              style={[
                styles.selectBar,
                {
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme['c-border-background'],
                  backgroundColor: theme['c-content-background'],
                  // 悬浮在迷你播放器胶囊上方：胶囊 + tab 栏最高约到 safeAreaBottom + 150
                  bottom: 160 + safeAreaBottom,
                },
              ]}
            >
              <TouchableOpacity style={styles.selectBarBtn} onPress={toggleSelectAll}>
                <Text size={designTypography.caption} color={theme['c-primary-font']}>
                  {tab === 'download'
                    ? completedTasks.length > 0 && completedTasks.every(t => selectedIds.has(t.id))
                      ? '取消全选'
                      : '全选'
                    : localFiles.length > 0 && localFiles.every(f => selectedIds.has(f.id))
                      ? '取消全选'
                      : '全选'}
                </Text>
              </TouchableOpacity>
              <Text size={designTypography.caption} color={theme['c-font-label']} style={{ marginLeft: 'auto' }}>
                已选 {selectedIds.size} 项
              </Text>
              <TouchableOpacity
                style={[styles.selectBarBtn, selectedIds.size === 0 && styles.selectBarBtnDisabled]}
                onPress={handleDeleteSelected}
              >
                <Text
                  size={designTypography.caption}
                  color={selectedIds.size === 0 ? theme['c-500'] : theme['c-primary-font']}
                >
                  删除
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      }
      />
  )
})

const styles = createStyle({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: designSpacing.sm,
    paddingBottom: designSpacing.xs,
    paddingLeft: designSpacing.md,
    paddingRight: designSpacing.md,
  },
  headerActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBtn: {
    height: 32,
    paddingHorizontal: designSpacing.sm,
    borderRadius: designRadius.pill,
    justifyContent: 'center',
  },
  refreshBtn: {
    height: 32,
    paddingHorizontal: designSpacing.sm,
    borderRadius: designRadius.pill,
    justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row',
    height: 38,
    marginHorizontal: designSpacing.md,
    marginBottom: designSpacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: designRadius.pill,
    overflow: 'hidden',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabItemActive: {},
  tip: {
    paddingLeft: designSpacing.md,
    paddingRight: designSpacing.md,
    paddingBottom: designSpacing.sm,
  },
  columnWrapper: {
    paddingHorizontal: 8,
  },
  itemWrapper: {
    flex: 1,
    maxWidth: '50%',
  },
  songItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 62,
    marginHorizontal: designSpacing.md,
    marginBottom: designSpacing.sm,
    paddingHorizontal: designSpacing.md,
    borderWidth: 1,
    borderRadius: designRadius.lg,
  },
  songTitle: {
    fontWeight: '600',
  },
  itemInfo: {
    flex: 1,
    gap: 4,
  },
  empty: {
    paddingTop: 60,
    alignItems: 'center',
  },
  listArea: {
    flex: 1,
    // selectBar 绝对定位的参照容器
    position: 'relative',
  },
  list: {
    flex: 1,
  },
  selectBar: {
    position: 'absolute',
    left: designSpacing.md,
    right: designSpacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: designSpacing.sm,
    paddingHorizontal: designSpacing.sm,
    borderRadius: designRadius.lg,
  },
  selectBarBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  selectBarBtnDisabled: {
    opacity: 0.5,
  },
  selectedMark: {
    width: 22,
    height: 22,
    marginLeft: designSpacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
