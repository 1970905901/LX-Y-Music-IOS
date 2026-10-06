import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  Keyboard,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type ListRenderItem,
} from 'react-native'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import Image from '@/components/common/Image'
import { Icon } from '@/components/common/Icon'
import { SvgIcon } from '@/components/common/SvgIcon'
import { useTheme } from '@/store/theme/hook'
import { confirmDialog, createStyle, toast, getRowInfo } from '@/utils/tools'
import { LIST_IDS, LIST_ITEM_HEIGHT } from '@/config/constant'
import { scaleSizeH } from '@/utils/pixelRatio'
import { overwriteListMusics } from '@/core/list'
import { playList } from '@/core/player/player'
import { addTempPlayList } from '@/core/player/tempPlayList'
import { useHorizontalMode } from '@/utils/hooks'
import { usePlayMusicInfo } from '@/store/player/hook'
import playerState from '@/store/player/state'
import {
  fetchWebDAVPic,
  getWebDAVConfig,
  listWebDAVFolders,
  saveWebDAVFilterPath,
  saveWebDAVSelectedFolder,
  scanWebDAVSongs,
  updateWebDAVMusicMeta,
} from '@/core/webdavMusic/drive'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import { useBottomOverlayInset } from '@/store/common/hook'
import PageTopInset from '@/components/common/PageTopInset'
import WebDAVListMenu, { type WebDAVListMenuType, type SelectInfo as WebDAVSelectInfo } from './WebDAVListMenu'
import WebDAVDownloadPath from './components/WebDAVDownloadPath'
import MetadataEditModal from '@/components/MetadataEditModal'
import {
  handleWebDAVDownload,
  handleFetchWebDAVPicFromOnline,
  handleWebDAVRemove,
  handleWebDAVDownloadAndImport,
} from './WebDAVListAction'
import { readMetadata, readPic } from '@/utils/localMediaMetadata'
import { useSettingValue } from '@/store/setting/hook'
import { testConnection, resetClient } from '@/utils/webdav'
import { existsFile } from '@/utils/fs'
import InputItem from '@/screens/Home/Views/Setting/components/InputItem'
import { updateSetting } from '@/core/common'

type ActiveTab = 'config' | 'list' | 'folders'
const ITEM_HEIGHT = scaleSizeH(LIST_ITEM_HEIGHT)

// 模块级稳定引用：FlatList 的 keyExtractor 每次渲染新建会让 VirtualizedList 认为
// props 变了，多做一轮 props 比对。（renderItem 已是稳定 useCallback。）
const keyExtractor = (item: LX.WebDAV.MusicInfo) => item.id

const TabButton = ({ label, tab, activeTab, onPress }: {
  label: string
  tab: ActiveTab
  activeTab: ActiveTab
  onPress: () => void
}) => {
  const theme = useTheme()
  return (
    <TouchableOpacity
      style={{
        ...styles.tab,
        backgroundColor: activeTab === tab ? theme['c-primary'] : theme['c-primary-light-900-alpha-300'],
        borderColor: activeTab === tab ? theme['c-primary'] : theme['c-border-background'],
      }}
      onPress={onPress}
    >
      <Text
        style={{
          ...styles.tabText,
          color: activeTab === tab ? theme['c-primary-light-1000'] : theme['c-font-label'],
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  )
}

const formatTime = (time?: number) => {
  if (!time) return ''
  return new Date(time).toLocaleString()
}

const formatBriefTime = (time?: number) => {
  if (!time) return ''
  const date = new Date(time)
  const pad = (num: number) => String(num).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatSize = (size?: number) => {
  if (!size) return ''
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

const getFolderName = (folder?: LX.WebDAV.DriveFolder | null) => folder?.path || 'WebDAV 根目录'

const SongItem = memo(
  ({
    item,
    index,
    isPlaying,
    rowWidth = '100%',
    onPress,
    onShowMenu,
  }: {
    item: LX.WebDAV.MusicInfo
    index: number
    isPlaying: boolean
    /** 横屏多列时每列宽度（如 '50%'），竖屏为 '100%' */
    rowWidth?: `${number}%`
    onPress: (musicInfo: LX.WebDAV.MusicInfo) => void
    onShowMenu: (
      item: LX.WebDAV.MusicInfo,
      index: number,
      position: { x: number, y: number, w: number, h: number }
    ) => void
  }) => {
    const theme = useTheme()
    const moreButtonRef = useRef<TouchableOpacity>(null)
    // 没有歌手时退回展示远程路径（filePath 只表示本地已下载文件，未下载时为空）
    const subText = item.singer || item.meta.remotePath || item.meta.filePath || ''
    const sizeText = formatSize(item.meta.size)
    const timeText = formatBriefTime(item.meta.lastModifiedTime)
    const detailText = [sizeText, timeText].filter(Boolean).join(' · ')

    const handleShowMenu = () => {
      if (moreButtonRef.current?.measure) {
        moreButtonRef.current.measure((fx, fy, width, height, px, py) => {
          onShowMenu(item, index, {
            x: Math.ceil(px),
            y: Math.ceil(py),
            w: Math.ceil(width),
            h: Math.ceil(height),
          })
        })
      }
    }

    return (
      <View
        style={{
          ...styles.songItem,
          width: rowWidth,
          backgroundColor: isPlaying
            ? theme['c-primary-background-hover']
            : theme['c-content-background'],
          borderColor: isPlaying
            ? theme['c-primary-background-active']
            : theme['c-border-background'],
        }}
      >
        <TouchableOpacity style={styles.songItemLeft} onPress={() => { onPress(item) }}>
          <View style={styles.sn}>
            {item.meta.picUrl ? (
              <Image url={item.meta.picUrl} style={styles.albumArt} cache={false} />
            ) : (
              <View style={styles.albumArtPlaceholder} />
            )}
          </View>
          <View style={styles.itemInfo}>
            <Text
              size={designTypography.body}
              style={styles.songTitle}
              color={isPlaying ? theme['c-primary-font'] : theme['c-font']}
              numberOfLines={1}
            >
              {item.name || item.meta.fileName}
            </Text>
            <View style={styles.listItemSingle}>
              <Text
                style={styles.listItemSingleText}
                size={designTypography.caption}
                color={isPlaying ? theme['c-primary-alpha-200'] : theme['c-500']}
                numberOfLines={1}
              >
                {subText}
              </Text>
            </View>
            {detailText ? (
              <Text
                size={designTypography.caption}
                color={isPlaying ? theme['c-primary-alpha-200'] : theme['c-500']}
                numberOfLines={1}
              >
                {detailText}
              </Text>
            ) : null}
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleShowMenu} ref={moreButtonRef} style={styles.moreButton}>
          <Icon name="dots-vertical" style={{ color: theme['c-350'] }} size={17} />
        </TouchableOpacity>
      </View>
    )
  },
)

export default memo(() => {
  const theme = useTheme()
  const playMusicInfo = usePlayMusicInfo()
  const [activeTab, setActiveTab] = useState<ActiveTab>('list')
  const [loading, setLoading] = useState(false)
  const [folderStack, setFolderStack] = useState<LX.WebDAV.DriveFolder[]>([])
  const [folders, setFolders] = useState<LX.WebDAV.DriveFolder[]>([])
  const [selectedFolder, setSelectedFolder] = useState<LX.WebDAV.DriveFolder | null>(null)
  const [songs, setSongs] = useState<LX.WebDAV.MusicInfo[]>([])
  const [scannedAt, setScannedAt] = useState<number | undefined>()
  const [filterPath, setFilterPath] = useState<string | null>(null)
  const [folderLoading, setFolderLoading] = useState(false)
  const [scanText, setScanText] = useState('')
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [batchLoadingText, setBatchLoadingText] = useState('')
  const listRef = useRef<FlatList<LX.WebDAV.MusicInfo>>(null)
  const searchInputRef = useRef<TextInput>(null)
  const pendingJumpIdRef = useRef<string | null>(null)
  const webDAVListMenuRef = useRef<WebDAVListMenuType>(null)
  const metadataEditTypeRef = useRef<any>(null)
  const selectedMusicInfoRef = useRef<LX.WebDAV.MusicInfo | null>(null)

  const currentFolder = folderStack.at(-1) ?? null

  // 连接配置（与「设置 → 数据同步 → WebDAV 同步」写的是同一批键，两边永远同源）。
  // 必须是响应式的：此前用 useMemo(..., []) 只在挂载时算一次 —— 用户先在设置里填好
  // 再回到本页，页面仍认定「未配置」，扫描/下载/目录按钮永远灰着（本页不能用的主因之一）。
  const webdavUrl = useSettingValue('sync.webdav.url')
  const webdavUsername = useSettingValue('sync.webdav.username')
  const webdavPassword = useSettingValue('sync.webdav.password')
  const hasConfig = !!(webdavUrl && webdavUsername)
  const [isTesting, setIsTesting] = useState(false)

  const filteredSongs = useMemo(() => {
    let list = songs
    if (filterPath) {
      list = list.filter(song => {
        const path = song.meta.remotePath
        if (!path) return false
        const lastSlashIndex = path.lastIndexOf('/')
        const folderPath = path.substring(0, lastSlashIndex) || '/'
        return folderPath === filterPath
      })
    }
    const text = searchText.trim().toLowerCase()
    if (!text) return list
    return list.filter((item) => {
      return [
        item.name,
        item.singer,
        item.meta.fileName,
        item.meta.filePath,
        item.meta.remotePath,
      ].some(value => (value ?? '').toLowerCase().includes(text))
    })
  }, [searchText, songs, filterPath])

  const songFolders = useMemo(() => {
    const foldersMap = new Map<string, { name: string, path: string, count: number }>()
    songs.forEach(song => {
      const path = song.meta.remotePath
      if (!path) return
      const lastSlashIndex = path.lastIndexOf('/')
      if (lastSlashIndex === -1) return
      const folderPath = path.substring(0, lastSlashIndex) || '/'
      const folderName = folderPath === '/' ? '根目录' : (folderPath.split('/').pop() || '未知目录')

      const existing = foldersMap.get(folderPath)
      if (existing) {
        existing.count++
      } else {
        foldersMap.set(folderPath, { name: folderName, path: folderPath, count: 1 })
      }
    })
    return Array.from(foldersMap.values()).sort((a, b) => a.path.localeCompare(b.path))
  }, [songs])

  const syncSongsCover = useCallback(async(songList: LX.WebDAV.MusicInfo[]) => {
    // 仅补充网盘内封面（快速直连下载到本地），不触发全平台搜索；
    // 全平台封面由播放详情页按需获取。限制并发 4，避免批量下载风暴。
    let index = 0
    const workers = Array.from({ length: 4 }, async() => {
      while (index < songList.length) {
        const i = index++
        const song = songList[i]
        if (song.meta.picUrl) continue
        try {
          const picUrl = await fetchWebDAVPic(song)
          if (picUrl) {
            songList[i] = { ...song, meta: { ...song.meta, picUrl } }
          }
        } catch {
          // ignore error
        }
      }
    })
    await Promise.all(workers)
    setSongs([...songList])
  }, [])

  const loadConfig = useCallback(async() => {
    return getWebDAVConfig().then(config => {
      setSelectedFolder(config.selectedFolder ?? null)
      const songs = config.songs ?? []
      setSongs(songs)
      setScannedAt(config.scannedAt)
      setFilterPath(config.filterPath ?? null)
      void syncSongsCover(songs)
    })
  }, [syncSongsCover])

  const handleSetFilterPath = useCallback((path: string | null) => {
    setFilterPath(path)
    void saveWebDAVFilterPath(path)
  }, [])

  // 连接配置：与「设置 → 数据同步 → WebDAV 同步」共用 sync.webdav.* 同一批键，
  // 写完立刻 resetClient()，让页面内的目录浏览/扫描/下载用上新凭据。
  const handleWebdavSettingChanged = useCallback(
    (key: 'sync.webdav.url' | 'sync.webdav.username' | 'sync.webdav.password') =>
      (text: string, callback: (value: string) => void) => {
        updateSetting({ [key]: text })
        resetClient()
        callback(text)
      },
    [],
  )

  const handleTestConnection = useCallback(async() => {
    if (isTesting) return
    setIsTesting(true)
    toast('正在测试连接...')
    try {
      await testConnection()
      toast('连接成功！')
    } catch (error: any) {
      toast(`连接失败：${error.message}`, 'long')
    } finally {
      setIsTesting(false)
    }
  }, [isTesting])

  // 下拉刷新 = 重新读取**已下载到本地**文件的标签（联网扫描请用「扫描」按钮）。
  // 旧实现对所有歌曲都拿 meta.filePath 去 readMetadata —— 未下载时那是远程路径，
  // 必然读失败，却照样弹「标签加载完成」，看着像刷新了其实什么都没做。
  const handleRefresh = useCallback(() => {
    const localSongs = songs.filter(song => !!song.meta.filePath)
    if (!localSongs.length) {
      toast('没有已下载到本地的歌曲；联网扫描请点「扫描」', 'long')
      return
    }
    setLoading(true)
    setScanText(`正在读取 ${localSongs.length} 首本地文件的标签...`)
    void Promise.all(
      localSongs.map(async(song) => {
        if (!song.meta.filePath) return song
        try {
          const fileMetadata = await readMetadata(song.meta.filePath).catch(() => null)
          const picPath = await readPic(song.meta.filePath).catch(() => null)
          if (fileMetadata) {
            const updates: Record<string, any> = {}
            if (fileMetadata.albumName) updates.albumName = fileMetadata.albumName
            if (fileMetadata.name && !song.name) updates.name = fileMetadata.name
            if (fileMetadata.singer && !song.singer) updates.singer = fileMetadata.singer
            if (picPath) {
              const newPicUrl = picPath.startsWith('/') ? `file://${picPath}` : picPath
              updates.picUrl = newPicUrl
            }
            if (Object.keys(updates).length > 0) {
              await updateWebDAVMusicMeta(song.id, updates)
            }
          }
        } catch (e) {
          // ignore
        }
        return song
      }),
    ).then(async() => {
      return getWebDAVConfig()
    }).then((config) => {
      setSongs(config.songs ?? [])
      setScanText('')
      toast(`已更新 ${localSongs.length} 首本地文件的标签`)
    }).catch((err: any) => {
      const message = err.message ?? String(err)
      setScanText(message)
      toast(message, 'long')
    }).finally(() => {
      setLoading(false)
    })
  }, [songs])

  const showMenu = useCallback(
    (musicInfo: LX.WebDAV.MusicInfo, index: number, position: { x: number, y: number, w: number, h: number }) => {
      webDAVListMenuRef.current?.show(
        { musicInfo, index },
        position,
      )
    },
    [],
  )

  const handlePlay = useCallback(
    (musicInfo: LX.WebDAV.MusicInfo) => {
      const index = songs.findIndex(item => item.id === musicInfo.id)
      if (index < 0) return
      void overwriteListMusics(LIST_IDS.TEMP, songs).then(() => {
        void playList(LIST_IDS.TEMP, index).then(() => {
          void (async() => {
            const config = await getWebDAVConfig()
            const updatedSongs = config.songs ?? []
            setSongs(updatedSongs)
            void syncSongsCover(updatedSongs)
          })()
        })
      })
    },
    [songs, syncSongsCover],
  )

  const handlePlayLater = useCallback((info: WebDAVSelectInfo) => {
    const musicInfo = info.musicInfo
    addTempPlayList([{
      listId: null,
      musicInfo,
    }])
    toast('已添加到稍后播放')
  }, [])

  const handleLoadMetadata = useCallback(async(info: WebDAVSelectInfo) => {
    const musicInfo = info.musicInfo
    if (!musicInfo.meta.filePath) {
      toast('请先下载歌曲')
      return
    }
    try {
      toast('正在读取标签...')
      const fileMetadata = await readMetadata(musicInfo.meta.filePath)
      const picPath = await readPic(musicInfo.meta.filePath).catch(() => null)

      if (!fileMetadata) {
        toast('没有找到标签信息')
        return
      }

      const updates: Record<string, any> = {}
      if (fileMetadata.albumName) updates.albumName = fileMetadata.albumName
      if (fileMetadata.name && !musicInfo.name) updates.name = fileMetadata.name
      if (fileMetadata.singer && !musicInfo.singer) updates.singer = fileMetadata.singer
      if (picPath) {
        const newPicUrl = picPath.startsWith('/') ? `file://${picPath}` : picPath
        updates.picUrl = newPicUrl
      }

      if (Object.keys(updates).length > 0) {
        await updateWebDAVMusicMeta(musicInfo.id, updates)
        setSongs(prevSongs => prevSongs.map(song =>
          song.id === musicInfo.id
            ? { ...song, ...updates, meta: { ...song.meta, ...updates } }
            : song,
        ))
        toast('标签加载成功')
      } else {
        toast('没有新的标签信息')
      }
    } catch (error: any) {
      toast(`加载标签失败：${error.message}`, 'long')
    }
  }, [])

  const handleDownload = useCallback((info: WebDAVSelectInfo) => {
    void handleWebDAVDownload(info.musicInfo).then((newPicUrl) => {
      if (newPicUrl) {
        setSongs(prevSongs => prevSongs.map(song =>
          song.id === info.musicInfo.id
            ? { ...song, meta: { ...song.meta, picUrl: newPicUrl } }
            : song,
        ))
      }
    })
  }, [])

  const handleFetchPicFromOnline = useCallback((info: WebDAVSelectInfo) => {
    void handleFetchWebDAVPicFromOnline(info.musicInfo).then((newPicUrl) => {
      setSongs(prevSongs => prevSongs.map(song =>
        song.id === info.musicInfo.id
          ? { ...song, meta: { ...song.meta, picUrl: newPicUrl } }
          : song,
      ))
    })
  }, [])

  const handleEditMetadata = useCallback((info: WebDAVSelectInfo) => {
    const filePath = info.musicInfo.meta.filePath
    // 编辑标签只能改本地文件：未下载的歌曲 filePath 为空（旧数据里还可能是远程路径），
    // 直接弹编辑器会去读写一个根本不在本地的文件。
    if (!filePath) {
      toast('请先下载歌曲，再编辑标签')
      return
    }
    void existsFile(filePath).then((exists) => {
      if (!exists) {
        toast('本地文件不存在，请先下载', 'long')
        return
      }
      selectedMusicInfoRef.current = info.musicInfo
      metadataEditTypeRef.current?.show(filePath, info.musicInfo)
    })
  }, [])

  const handleUpdateMetadata = useCallback(() => {
    if (!selectedMusicInfoRef.current) return
    loadConfig().catch(() => {})
  }, [loadConfig])

  const handleRemove = useCallback((info: WebDAVSelectInfo) => {
    void handleWebDAVRemove(info.musicInfo).then(() => {
      setSongs(prevSongs => prevSongs.filter(song => song.id !== info.musicInfo.id))
    })
  }, [])

  const handleBatchDownload = useCallback(() => {
    if (!hasConfig) {
      toast('请先在「配置」里填写 WebDAV 地址与账号')
      setActiveTab('config')
      return
    }
    void confirmDialog({
      title: '扫描并下载',
      message: '此操作将先扫描 WebDAV 目录，然后下载所有扫描到的歌曲。下载后的歌曲将添加到下载列表中，并自动读取音乐标签。',
      confirmButtonText: '开始扫描并下载',
    }).then((confirmed) => {
      if (!confirmed) return

      setLoading(true)
      setScanText('开始扫描...')
      void scanWebDAVSongs(selectedFolder, (count, path) => {
        setScanText(`已找到 ${count} 首，正在扫描：${path}`)
      })
        .then((config) => {
          const scannedSongs = config.songs ?? []
          setSongs(scannedSongs)
          setScannedAt(config.scannedAt)
          setScanText('')

          if (scannedSongs.length === 0) {
            toast('没有扫描到可下载的歌曲')
            return
          }

          void handleWebDAVDownloadAndImport(scannedSongs, setBatchLoadingText)
        })
        .catch((err: any) => {
          const message = err.message ?? String(err)
          setScanText(message)
          toast(message, 'long')
        })
        .finally(() => {
          setLoading(false)
        })
    })
  }, [hasConfig, selectedFolder])

  const loadFolders = useCallback((folder: LX.WebDAV.DriveFolder | null) => {
    setFolderLoading(true)
    void listWebDAVFolders(folder)
      .then(setFolders)
      .catch((err: any) => {
        const message = err.message ?? String(err)
        toast(message, 'long')
      })
      .finally(() => {
        setFolderLoading(false)
      })
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useEffect(() => {
    if (!hasConfig) return
    loadFolders(currentFolder)
  }, [hasConfig, currentFolder, loadFolders])

  useEffect(() => {
    const handleWebdavPicUpdated = (musicId: string, picUrl: string) => {
      setSongs(prevSongs => prevSongs.map(song =>
        song.id === musicId
          ? { ...song, meta: { ...song.meta, picUrl } }
          : song,
      ))
    }

    global.app_event.on('webdavPicUpdated', handleWebdavPicUpdated)
    return () => {
      global.app_event.off('webdavPicUpdated', handleWebdavPicUpdated)
    }
  }, [])

  const handleScan = useCallback(() => {
    if (!hasConfig) {
      toast('请先在「配置」里填写 WebDAV 地址与账号')
      setActiveTab('config')
      return
    }
    const runScan = () => {
      setLoading(true)
      setScanText('开始扫描...')
      void scanWebDAVSongs(selectedFolder, (count, path) => {
        setScanText(`已找到 ${count} 首，正在扫描：${path}`)
      })
        .then((config) => {
          setSongs(config.songs ?? [])
          setScannedAt(config.scannedAt)
          setScanText('')
          setActiveTab('list')
          toast(`扫描完成：${config.songs.length} 首`)
        })
        .catch((err: any) => {
          const message = err.message ?? String(err)
          setScanText(message)
          toast(message, 'long')
        })
        .finally(() => {
          setLoading(false)
        })
    }
    if (!selectedFolder) {
      void confirmDialog({
        title: '扫描 WebDAV 根目录',
        message:
          '根目录扫描会递归读取所有子目录。文件夹很多时可能较慢。确定继续扫描根目录？',
        confirmButtonText: '继续扫描',
      }).then((confirmed) => {
        if (confirmed) runScan()
      })
      return
    }
    runScan()
  }, [hasConfig, selectedFolder])

  const handleSelectCurrentFolder = useCallback(() => {
    setLoading(true)
    void saveWebDAVSelectedFolder(currentFolder)
      .then((config) => {
        setSelectedFolder(config.selectedFolder ?? null)
        toast(`已选择：${getFolderName(config.selectedFolder)}`)
      })
      .catch((err: any) => {
        toast(err.message ?? String(err), 'long')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [currentFolder])

  const scrollToMusic = useCallback((musicId: string) => {
    let list = filteredSongs
    let index = list.findIndex(item => item.id === musicId)
    if (index < 0 && searchText) {
      setSearchText('')
      list = songs
      index = list.findIndex(item => item.id === musicId)
    }
    if (index < 0) return
    setActiveTab('list')
    requestAnimationFrame(() => {
      setTimeout(() => {
        listRef.current?.scrollToIndex({
          index,
          viewPosition: 0.3,
          animated: true,
        })
      }, searchText ? 160 : 80)
    })
  }, [filteredSongs, searchText, songs])

  useEffect(() => {
    const handleJumpPosition = () => {
      const rawMusicInfo = playerState.playMusicInfo.musicInfo
      const musicInfo = rawMusicInfo && 'progress' in rawMusicInfo ? rawMusicInfo.metadata.musicInfo : rawMusicInfo
      if (!musicInfo) return
      pendingJumpIdRef.current = musicInfo.id
      scrollToMusic(musicInfo.id)
    }
    // @ts-expect-error - jumpWebDAVPosition is a custom event
    global.app_event.on('jumpWebDAVPosition', handleJumpPosition)
    return () => {
      // @ts-expect-error - jumpWebDAVPosition is a custom event
      global.app_event.off('jumpWebDAVPosition', handleJumpPosition)
    }
  }, [scrollToMusic])

  useEffect(() => {
    if (activeTab !== 'list' || !pendingJumpIdRef.current) return
    const musicId = pendingJumpIdRef.current
    pendingJumpIdRef.current = null
    scrollToMusic(musicId)
  }, [activeTab, scrollToMusic])

  // 列数响应式（对齐 OnlineList）：iPad 横屏/分屏时双列，避免歌曲行在超宽屏上
  // 被拉得过长、左右留白；竖屏保持单列零回归。
  // numColumns 变更时 FlatList 必须重挂载（RN 不支持运行中改列数），故加 key。
  const isHorizontal = useHorizontalMode()
  // 底部悬浮层（迷你播放器 + 底部 Tab + 安全区）统一避让高度
  const bottomInset = useBottomOverlayInset()
  const rowInfo = useMemo(() => {
    void isHorizontal
    return getRowInfo()
  }, [isHorizontal])
  const numColumns = rowInfo.rowNum ?? 1

  const renderSong: ListRenderItem<LX.WebDAV.MusicInfo> = useCallback(
    ({ item, index }) => (
      <SongItem
        item={item}
        index={index}
        isPlaying={playMusicInfo.musicInfo?.id === item.id}
        rowWidth={rowInfo.rowWidth}
        onPress={handlePlay}
        onShowMenu={showMenu}
      />
    ),
    [handlePlay, showMenu, playMusicInfo.musicInfo?.id, rowInfo.rowWidth],
  )

  const headerText = useMemo(() => {
    if (batchLoadingText) return batchLoadingText
    if (searchText.trim()) return `${filteredSongs.length}/${songs.length} 首`
    return `${songs.length} 首${scannedAt ? ` · ${formatTime(scannedAt)}` : ''}`
  }, [batchLoadingText, filteredSongs.length, scannedAt, searchText, songs.length])

  const handleToggleSearch = useCallback(() => {
    setSearchVisible((visible) => {
      const nextVisible = !visible
      if (nextVisible) {
        requestAnimationFrame(() => {
          searchInputRef.current?.focus()
        })
      } else {
        setSearchText('')
        Keyboard.dismiss()
      }
      return nextVisible
    })
  }, [])

  const handleClearSearch = useCallback(() => {
    if (searchText) {
      setSearchText('')
      searchInputRef.current?.focus()
      return
    }
    setSearchVisible(false)
    Keyboard.dismiss()
  }, [searchText])

  const renderTabsHeader = () => (
    <>
      <PageTopInset />
      <View style={{ ...styles.tabs, borderBottomColor: theme['c-border-background'] }}>
        <TabButton label="列表" tab="list" activeTab={activeTab} onPress={() => { setActiveTab('list') }} />
        <TabButton label="目录" tab="folders" activeTab={activeTab} onPress={() => { setActiveTab('folders') }} />
        <TabButton label="配置" tab="config" activeTab={activeTab} onPress={() => { setActiveTab('config') }} />
      </View>
    </>
  )

  const renderConfig = () => (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      onScrollBeginDrag={Keyboard.dismiss}
      style={styles.scroll}
      contentContainerStyle={styles.content}
    >
      {renderTabsHeader()}
      {/* 连接配置就地可改：与「设置 → 数据同步 → WebDAV 同步」共用同一批设置键
          （sync.webdav.*），不再像旧版那样只给一句「请在设置中配置」把人赶去别的页面。
          注：输入项本身已是卡片（InputItem 自带边框/底色），这里不再套一层 panel，避免双层边框。 */}
      <View style={styles.section}>
        <Text style={styles.label}>连接</Text>
        <Text size={12} color={theme['c-font-label']} style={styles.sectionTip}>
          与「设置 → 数据同步 → WebDAV 同步」是同一份配置，两边改哪边都生效。
        </Text>
      </View>
      <InputItem
        label="服务器地址"
        value={webdavUrl}
        onChanged={handleWebdavSettingChanged('sync.webdav.url')}
        placeholder="https://example.com/webdav"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <InputItem
        label="用户名"
        value={webdavUsername}
        onChanged={handleWebdavSettingChanged('sync.webdav.username')}
        placeholder="请输入用户名"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <InputItem
        label="密码"
        value={webdavPassword}
        onChanged={handleWebdavSettingChanged('sync.webdav.password')}
        placeholder="请输入密码"
        secureTextEntry
      />
      <View style={styles.buttonRow}>
        <Button
          style={{ ...styles.button, backgroundColor: theme['c-button-background'] }}
          disabled={!hasConfig || isTesting}
          onPress={handleTestConnection}
        >
          <Text color={theme['c-button-font']}>{isTesting ? '测试中...' : '测试连接'}</Text>
        </Button>
      </View>
      <Text color={hasConfig ? theme['c-primary-font'] : theme['c-font-label']} style={styles.meta}>
        {hasConfig ? '已配置：可直接浏览目录、扫描歌曲' : '未配置：填好服务器地址与用户名后即可使用'}
      </Text>

      <WebDAVDownloadPath />

      <View style={{ ...styles.panel, borderColor: theme['c-border-background'] }}>
        <Text style={styles.label}>扫描范围</Text>
        <Text color={theme['c-font-label']} style={styles.meta}>
          {getFolderName(selectedFolder)}
        </Text>
        <Text size={12} color={theme['c-font-label']} style={styles.meta}>
          到「目录」页浏览服务器目录并选择；不选则扫描整个根目录。
        </Text>
      </View>
    </ScrollView>
  )

  const renderFolders = () => (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      contentContainerStyle={styles.content}
    >
      {renderTabsHeader()}
      {/* 服务器目录：浏览并选择「扫描范围」。旧版把这块藏在「配置」页里，
          与这里「已扫描歌曲的目录」分属两页、两个名字，是用户说的「割裂」来源之一。 */}
      <View style={{ ...styles.panel, borderColor: theme['c-border-background'] }}>
        <Text style={styles.label}>服务器目录</Text>
        <Text color={theme['c-font-label']} style={styles.meta}>
          当前：{getFolderName(currentFolder)}
        </Text>
        <Text color={theme['c-font-label']} style={styles.meta}>
          扫描范围：{getFolderName(selectedFolder)}
        </Text>
        <View style={styles.buttonRow}>
          <Button
            style={{ ...styles.button, backgroundColor: theme['c-button-background'] }}
            disabled={!hasConfig || folderLoading || !folderStack.length}
            onPress={() => { setFolderStack(prev => prev.slice(0, -1)) }}
          >
            <Text color={theme['c-button-font']}>返回上级</Text>
          </Button>
          <Button
            style={{ ...styles.button, backgroundColor: theme['c-button-background'] }}
            disabled={!hasConfig || loading}
            onPress={handleSelectCurrentFolder}
          >
            <Text color={theme['c-button-font']}>选择当前目录</Text>
          </Button>
        </View>

        {folderLoading ? (
          <Text style={styles.tip} color={theme['c-font-label']}>
            正在读取目录...
          </Text>
        ) : folders.length ? (
          folders.map(folder => (
            <TouchableOpacity
              key={folder.id}
              style={{ ...styles.folderItem, borderBottomColor: theme['c-border-background'] }}
              onPress={() => { setFolderStack(prev => [...prev, folder]) }}
            >
              <Text numberOfLines={1}>{folder.name}</Text>
              <Text size={11} color={theme['c-font-label']} numberOfLines={1}>
                {folder.path}
              </Text>
            </TouchableOpacity>
          ))
        ) : (
          <Text style={styles.tip} color={theme['c-font-label']}>
            {hasConfig ? '当前目录没有子目录。' : '请先在「配置」里填写服务器地址与用户名。'}
          </Text>
        )}
      </View>

      {/* 已扫描歌曲按目录分组：点一行就把歌曲列表筛到该目录 */}
      <View style={{ ...styles.panel, borderColor: theme['c-border-background'] }}>
        <Text style={styles.label}>已扫描歌曲的目录</Text>
        <TouchableOpacity
          style={{ ...styles.folderItem, borderBottomColor: theme['c-border-background'] }}
          onPress={() => {
            handleSetFilterPath(null)
            setActiveTab('list')
          }}
        >
          <View style={styles.folderItemInfo}>
            <SvgIcon name="music-list" size={18} color={theme['c-primary-font']} style={{ marginRight: 10 }} />
            <View style={{ flex: 1 }}>
              <Text>全部歌曲</Text>
            </View>
            <Text size={12} color={theme['c-font-label']}>{songs.length} 首</Text>
          </View>
        </TouchableOpacity>
        {songFolders.length ? (
          songFolders.map(folder => (
            <TouchableOpacity
              key={folder.path}
              style={{ ...styles.folderItem, borderBottomColor: theme['c-border-background'] }}
              onPress={() => {
                handleSetFilterPath(folder.path)
                setActiveTab('list')
              }}
            >
              <View style={styles.folderItemInfo}>
                <SvgIcon name="folder" size={18} color={theme['c-primary-font']} style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1}>{folder.name}</Text>
                  <Text size={11} color={theme['c-font-label']} numberOfLines={1}>
                    {folder.path}
                  </Text>
                </View>
                <Text size={12} color={theme['c-font-label']}>{folder.count} 首</Text>
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.empty}>
            <Text color={theme['c-font-label']}>还没有扫描到包含音乐的文件夹</Text>
          </View>
        )}
      </View>
    </ScrollView>
  )

  const renderList = () => (
    <View style={styles.listPage}>
      <FlatList
        key={`cols-${numColumns}`}
        ref={listRef}
        data={filteredSongs}
        ListHeaderComponent={
          <>
            {renderTabsHeader()}
            <View style={{ ...styles.listHeader, borderBottomColor: theme['c-border-background'] }}>
              <View style={styles.listHeaderText}>
          {searchVisible ? (
            <TextInput
              ref={searchInputRef}
              value={searchText}
              placeholder="搜索歌曲或歌手"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onChangeText={setSearchText}
              placeholderTextColor={theme['c-font-label']}
              selectionColor={theme['c-primary-light-100-alpha-300']}
              style={{
                ...styles.searchInput,
                color: theme['c-font'],
                borderColor: theme['c-border-background'],
              }}
            />
          ) : (
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text numberOfLines={1} style={{ flex: 1 }}>
                  {filterPath ? `文件夹：${filterPath.split('/').pop() || '根目录'}` : `已选择：${getFolderName(selectedFolder)}`}
                </Text>
                {filterPath ? (
                  <TouchableOpacity onPress={() => { handleSetFilterPath(null) }} style={{ marginLeft: 8 }}>
                    <Icon name="close" size={12} color={theme['c-primary-font']} />
                  </TouchableOpacity>
                ) : null}
              </View>
              <Text size={11} color={theme['c-font-label']} numberOfLines={1}>
                {!hasConfig ? '未配置 WebDAV：请到「配置」页填写服务器地址与用户名' : (scanText || headerText)}
              </Text>
            </View>
          )}
              </View>
              <TouchableOpacity style={styles.headerIconButton} onPress={handleToggleSearch}>
                <Icon name="search-2" size={16} color={searchVisible ? theme['c-primary-font'] : theme['c-font-label']} />
              </TouchableOpacity>
              {searchVisible ? (
                <TouchableOpacity style={styles.headerIconButton} onPress={handleClearSearch}>
                  <Icon name="close" size={13} color={theme['c-font-label']} />
                </TouchableOpacity>
              ) : null}
              <Button
                style={{ ...styles.scanButton, backgroundColor: theme['c-button-background'] }}
                disabled={loading || !!batchLoadingText}
                onPress={handleScan}
              >
                <Text color={theme['c-button-font']}>扫描</Text>
              </Button>
              <Button
                style={{ ...styles.scanButton, backgroundColor: theme['c-primary-background-hover'], marginLeft: 8 }}
                disabled={loading || !!batchLoadingText}
                onPress={handleBatchDownload}
              >
                <Text color={theme['c-primary-font']}>扫描并下载</Text>
              </Button>
            </View>
          </>
        }
        contentContainerStyle={{ paddingBottom: bottomInset }}
        numColumns={numColumns}
        renderItem={renderSong}
        keyExtractor={keyExtractor}
        style={{ flex: 1 }}
        // 限制渲染窗口 + 离屏行视图摘除（iOS 滚动掉帧主杠杆；getItemLayout 固定行高下回挂安全）
        initialNumToRender={20}
        windowSize={5}
        maxToRenderPerBatch={10}
        removeClippedSubviews={true}
        updateCellsBatchingPeriod={50}
        getItemLayout={(data, index) => ({
          length: ITEM_HEIGHT,
          offset: ITEM_HEIGHT * Math.floor(index / numColumns),
          index,
        })}
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({
            offset: Math.max(0, info.averageItemLength * info.index),
            animated: true,
          })
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text color={theme['c-font-label']}>
              {!hasConfig
                ? '未配置 WebDAV：请到「配置」页填写服务器地址与用户名'
                : searchText.trim()
                  ? '没有匹配的歌曲'
                  : '还没有扫描到歌曲，点右上角「扫描」'}
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            colors={[theme['c-primary']]}
            refreshing={loading}
            onRefresh={handleRefresh}
          />
        }
      />
    </View>
  )

  return (
    <View style={styles.container}>
      {activeTab === 'config' ? renderConfig() : activeTab === 'folders' ? renderFolders() : renderList()}
      <WebDAVListMenu
        ref={webDAVListMenuRef}
        onPlay={(info) => { handlePlay(info.musicInfo) }}
        onPlayLater={handlePlayLater}
        onDownload={handleDownload}
        onFetchPicFromOnline={handleFetchPicFromOnline}
        onEditMetadata={handleEditMetadata}
        onRemove={handleRemove}
        onLoadMetadata={handleLoadMetadata}
      />
      <MetadataEditModal ref={metadataEditTypeRef} onUpdate={handleUpdateMetadata} />
    </View>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    height: 44,
    paddingHorizontal: designSpacing.md,
    alignItems: 'center',
    gap: designSpacing.xs,
  },
  tab: {
    height: 32,
    paddingHorizontal: designSpacing.sm,
    borderWidth: 1,
    borderRadius: designRadius.pill,
    justifyContent: 'center',
  },
  tabText: {
    fontSize: designTypography.caption,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 12,
  },
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    padding: 10,
    marginBottom: 10,
  },
  label: {
    marginBottom: 6,
  },
  // 说明型小节（不套 panel）：InputItem 自带卡片边框，外层再画框会成双层容器
  section: {
    marginBottom: designSpacing.xs,
  },
  sectionTip: {
    marginTop: 2,
    marginBottom: designSpacing.sm,
  },
  meta: {
    marginTop: 5,
  },
  tip: {
    marginTop: 6,
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    marginRight: 10,
    marginBottom: 8,
  },
  folderItem: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
  },
  folderItemInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  listPage: {
    flex: 1,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  listHeaderText: {
    flex: 1,
    paddingRight: 8,
  },
  searchInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    height: 34,
    paddingHorizontal: 8,
    paddingVertical: 0,
    fontSize: 13,
  },
  headerIconButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  songItem: {
    height: ITEM_HEIGHT,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    paddingLeft: designSpacing.sm,
    paddingRight: designSpacing.sm,
    marginBottom: designSpacing.sm,
    borderWidth: 1,
    borderRadius: designRadius.lg,
  },
  songItemLeft: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sn: {
    width: 74,
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: designSpacing.xs,
    paddingRight: designSpacing.xs,
  },
  albumArtPlaceholder: {
    width: 54,
    height: 54,
    borderRadius: designRadius.md,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  albumArt: {
    width: 54,
    height: 54,
    borderRadius: designRadius.md,
  },
  itemInfo: {
    flexGrow: 1,
    flexShrink: 1,
    paddingRight: 2,
  },
  listItemSingle: {
    paddingTop: 3,
    flexDirection: 'row',
  },
  listItemSingleText: {
    flexGrow: 0,
    flexShrink: 1,
    fontWeight: '400',
  },
  songTitle: {
    fontWeight: '600',
  },
  moreButton: {
    height: '80%',
    paddingLeft: designSpacing.sm,
    paddingRight: designSpacing.sm,
    justifyContent: 'center',
  },
  empty: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
