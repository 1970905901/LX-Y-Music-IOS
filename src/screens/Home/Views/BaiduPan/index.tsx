import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  Keyboard,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type ListRenderItem,
} from 'react-native'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { createStyle, toast } from '@/utils/tools'
import { LIST_IDS, LIST_ITEM_HEIGHT } from '@/config/constant'
import { scaleSizeH } from '@/utils/pixelRatio'
import { overwriteListMusics } from '@/core/list'
import { playList } from '@/core/player/player'
import { usePlayMusicInfo } from '@/store/player/hook'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import playerState from '@/store/player/state'
import { BaiduPanError, listBaiduPanDir } from '@/core/baiduPan/drive'
import { isBaiduPanMusicInfo } from '@/core/baiduPan/utils'

const ITEM_HEIGHT = scaleSizeH(LIST_ITEM_HEIGHT)

const formatSize = (size?: number) => {
  if (!size) return ''
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

type ListRow =
  | { type: 'folder'; name: string; path: string }
  | { type: 'music'; musicInfo: LX.BaiduPan.MusicInfo }

const SongItem = memo(
  ({
    item,
    isPlaying,
    onPress,
  }: {
    item: LX.BaiduPan.MusicInfo
    isPlaying: boolean
    onPress: (musicInfo: LX.BaiduPan.MusicInfo) => void
  }) => {
    const theme = useTheme()
    const subText = item.singer || item.meta.filePath
    const sizeText = formatSize(item.meta.size)
    const detailText = [sizeText].filter(Boolean).join(' · ')

    return (
      <View
        style={{
          ...styles.row,
          backgroundColor: isPlaying ? theme['c-primary-background-hover'] : 'transparent',
        }}
      >
        <TouchableOpacity style={styles.rowLeft} onPress={() => onPress(item)}>
          <View style={styles.coverBox}>
            <Icon name="music" size={22} color={isPlaying ? theme['c-primary-font'] : theme['c-500']} />
          </View>
          <View style={styles.itemInfo}>
            <Text color={isPlaying ? theme['c-primary-font'] : theme['c-font']} numberOfLines={1}>
              {item.name || item.meta.fileName}
            </Text>
            <View style={styles.listItemSingle}>
              <Text
                style={styles.listItemSingleText}
                size={11}
                color={isPlaying ? theme['c-primary-alpha-200'] : theme['c-500']}
                numberOfLines={1}
              >
                {subText}
              </Text>
            </View>
            {detailText ? (
              <Text size={10} color={isPlaying ? theme['c-primary-alpha-200'] : theme['c-500']} numberOfLines={1}>
                {detailText}
              </Text>
            ) : null}
          </View>
        </TouchableOpacity>
      </View>
    )
  }
)

export default memo(() => {
  const theme = useTheme()
  const playMusicInfo = usePlayMusicInfo()
  const cookie = useSettingValue('baidupan.cookie')
  const rootPath = useSettingValue('baidupan.rootPath')
  const hasCookie = !!(cookie ?? '').trim()

  const [path, setPath] = useState('/')
  const [folders, setFolders] = useState<LX.BaiduPan.DriveFolder[]>([])
  const [musics, setMusics] = useState<LX.BaiduPan.MusicInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [configOpen, setConfigOpen] = useState(!hasCookie)
  const listRef = useRef<FlatList<ListRow>>(null)

  const rows = useMemo<ListRow[]>(() => {
    const folderRows = folders.map(f => ({ type: 'folder' as const, name: f.name, path: f.path }))
    const musicRows = musics.map(m => ({ type: 'music' as const, musicInfo: m }))
    return [...folderRows, ...musicRows]
  }, [folders, musics])

  const loadDir = useCallback(
    (dir: string) => {
      if (!hasCookie) {
        setConfigOpen(true)
        toast('请先在设置中填写百度网盘 Cookie', 'long')
        return
      }
      setLoading(true)
      setError('')
      void listBaiduPanDir(dir)
        .then(content => {
          setFolders(content.folders)
          setMusics(content.musics)
          setPath(content.dir)
          setConfigOpen(false)
        })
        .catch((err: unknown) => {
          const message = err instanceof BaiduPanError ? err.message : err instanceof Error ? err.message : String(err)
          setError(message)
          if (err instanceof BaiduPanError && (err.code === -6 || err.code === -7)) {
            setConfigOpen(true)
          }
          toast(message, 'long')
        })
        .finally(() => {
          setLoading(false)
        })
    },
    [hasCookie]
  )

  useEffect(() => {
    setConfigOpen(!hasCookie)
  }, [hasCookie])

  const handleOpenFolder = useCallback(
    (folderPath: string) => {
      loadDir(folderPath)
    },
    [loadDir]
  )

  const handleBack = useCallback(() => {
    const parts = path.split('/').filter(Boolean)
    const parent = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : '/'
    loadDir(parent)
  }, [path, loadDir])

  const handlePlay = useCallback(
    (musicInfo: LX.BaiduPan.MusicInfo) => {
      const index = musics.findIndex(item => item.id === musicInfo.id)
      if (index < 0) return
      void overwriteListMusics(LIST_IDS.TEMP, musics).then(() => {
        void playList(LIST_IDS.TEMP, index)
      })
    },
    [musics]
  )

  const handlePlayAll = useCallback(() => {
    if (!musics.length) {
      toast('当前目录没有可播放的音乐')
      return
    }
    void overwriteListMusics(LIST_IDS.TEMP, musics).then(() => {
      void playList(LIST_IDS.TEMP, 0)
    })
  }, [musics])

  const scrollToMusic = useCallback(
    (musicId: string) => {
      const musicIndex = musics.findIndex(item => item.id === musicId)
      if (musicIndex < 0) return
      const rowIndex = folders.length + musicIndex
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index: rowIndex, viewPosition: 0.3, animated: true })
      })
    },
    [musics, folders.length]
  )

  useEffect(() => {
    const handleJump = () => {
      const raw = playerState.playMusicInfo.musicInfo
      const info = raw && 'progress' in raw ? raw.metadata.musicInfo : raw
      if (!info || !isBaiduPanMusicInfo(info)) return
      const netDir = ((info.meta as LX.BaiduPan.MusicInfo['meta']).filePath as string).split('/').slice(0, -1).join('/') || '/'
      if (netDir !== path) loadDir(netDir)
      else scrollToMusic(info.id)
    }
    global.app_event.on('jumpBaiduPanPosition', handleJump)
    return () => {
      global.app_event.off('jumpBaiduPanPosition', handleJump)
    }
  }, [path, loadDir, scrollToMusic])

  const renderRow: ListRenderItem<ListRow> = useCallback(
    ({ item }) => {
      if (item.type === 'folder') {
        return (
          <TouchableOpacity
            style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}
            onPress={() => handleOpenFolder(item.path)}
          >
            <View style={styles.rowLeft}>
              <View style={styles.coverBox}>
                <Icon name="folder" size={22} color={theme['c-primary-font']} />
              </View>
              <View style={styles.itemInfo}>
                <Text numberOfLines={1}>{item.name}</Text>
                <Text size={10} color={theme['c-500']} numberOfLines={1}>
                  文件夹
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        )
      }
      return (
        <SongItem
          item={item.musicInfo}
          isPlaying={playMusicInfo.musicInfo?.id === item.musicInfo.id}
          onPress={handlePlay}
        />
      )
    },
    [handleOpenFolder, handlePlay, playMusicInfo.musicInfo?.id, theme]
  )

  const renderedRootPath = (rootPath ?? '').trim() || '/'

  return (
    <View style={styles.container}>
      <View style={{ ...styles.header, borderBottomColor: theme['c-border-background'] }}>
        <TouchableOpacity
          style={styles.headerIconButton}
          disabled={path === '/' && !configOpen}
          onPress={configOpen ? () => setConfigOpen(false) : handleBack}
        >
          <Icon name="chevron-left" size={20} color={path === '/' && !configOpen ? theme['c-font-label'] : theme['c-font']} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text numberOfLines={1}>{configOpen ? '百度网盘设置' : `百度网盘：${path}`}</Text>
        </View>
        <TouchableOpacity style={styles.headerIconButton} onPress={() => setConfigOpen(v => !v)}>
          <Icon name="setting" size={18} color={configOpen ? theme['c-primary-font'] : theme['c-font-label']} />
        </TouchableOpacity>
      </View>

      {configOpen ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}
          style={styles.scroll}
          contentContainerStyle={styles.content}
        >
          <View style={{ ...styles.panel, borderColor: theme['c-border-background'] }}>
            <Text style={styles.label}>百度网盘 Cookie</Text>
            <TextInput
              value={cookie}
              editable={!loading}
              placeholder="BDUSS=...; STOKEN=...; 粘贴完整 Cookie"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              onChangeText={text => updateSetting({ 'baidupan.cookie': text })}
              placeholderTextColor={theme['c-font-label']}
              selectionColor={theme['c-primary-light-100-alpha-300']}
              style={{ ...styles.input, borderColor: theme['c-border-background'], color: theme['c-font'] }}
            />
            <Text style={styles.tip} color={theme['c-font-label']}>
              在浏览器登录百度网盘网页版，打开开发者工具（F12）→ Network/应用 → Cookie，复制以 BDUSS 开头的完整 Cookie 字符串。Cookie 仅保存在本机设置中。
            </Text>
          </View>

          <View style={{ ...styles.panel, borderColor: theme['c-border-background'] }}>
            <Text style={styles.label}>音乐目录路径（可选）</Text>
            <TextInput
              value={rootPath}
              editable={!loading}
              placeholder="/音乐"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={text => updateSetting({ 'baidupan.rootPath': text })}
              placeholderTextColor={theme['c-font-label']}
              selectionColor={theme['c-primary-light-100-alpha-300']}
              style={{ ...styles.input, borderColor: theme['c-border-background'], color: theme['c-font'] }}
            />
            <Text style={styles.tip} color={theme['c-font-label']}>
              留空则从根目录开始浏览。设置后会作为进入网盘的默认目录。
            </Text>
          </View>

          <Button
            style={{ ...styles.loadButton, backgroundColor: theme['c-button-background'] }}
            disabled={!hasCookie || loading}
            onPress={() => loadDir(renderedRootPath)}
          >
            <Text color={theme['c-button-font']}>{loading ? '加载中...' : '加载目录'}</Text>
          </Button>
        </ScrollView>
      ) : (
        <View style={styles.listPage}>
          <View style={styles.listHeader}>
            <Text size={11} color={theme['c-font-label']} numberOfLines={1}>
              {loading ? '加载中...' : error || (rows.length ? `${folders.length} 个文件夹 · ${musics.length} 首` : '空目录')}
            </Text>
            <Button
              style={{ ...styles.playAllButton, backgroundColor: theme['c-button-background'] }}
              disabled={!musics.length || loading}
              onPress={handlePlayAll}
            >
              <Text color={theme['c-button-font']}>播放全部</Text>
            </Button>
          </View>
          <FlatList
            ref={listRef}
            data={rows}
            renderItem={renderRow}
            keyExtractor={item => (item.type === 'folder' ? `folder_${item.path}` : `music_${item.musicInfo.id}`)}
            getItemLayout={(data, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text color={theme['c-font-label']}>
                  {loading ? '正在加载...' : error || '该目录没有文件夹或音乐文件'}
                </Text>
              </View>
            }
          />
        </View>
      )}
    </View>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    height: 46,
  },
  headerText: {
    flex: 1,
    paddingHorizontal: 6,
  },
  headerIconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
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
  tip: {
    marginTop: 6,
    lineHeight: 18,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    height: 38,
    paddingHorizontal: 6,
    paddingVertical: 0,
    marginTop: 6,
    fontSize: 13,
  },
  loadButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  listPage: {
    flex: 1,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  playAllButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  row: {
    height: ITEM_HEIGHT,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    paddingRight: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'transparent',
  },
  rowLeft: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  coverBox: {
    width: 70,
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 5,
    paddingRight: 5,
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
    fontWeight: '300',
  },
  empty: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
