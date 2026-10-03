import { memo, useEffect, useState, useCallback, useRef } from 'react'
import { View, FlatList, RefreshControl, BackHandler, StyleSheet, Keyboard } from 'react-native'
import ListItem from './ListItem'
import wyApi from '@/utils/musicSdk/wy/user'
import wyDailyRecApi from '@/utils/musicSdk/wy/dailyRec'
import wyMusicDetailApi from '@/utils/musicSdk/wy/musicDetail'
import { playOnlineList } from '@/core/list'
import { MUSIC_TOGGLE_MODE } from '@/config/constant'
import { updateSetting } from '@/core/common'
import { useWySubscribedPlaylists, useWyUid } from '@/store/user/hook.ts'
import { useBottomOverlayInset } from '@/store/common/hook'
import { useHorizontalMode } from '@/utils/hooks'
import { usePhantomScrollGuard } from '@/utils/hooks/usePhantomScrollGuard'
import { useI18n } from '@/lang'
import { designSpacing } from '@/theme/DesignTokens'
import PageTopInset from '@/components/common/PageTopInset'
import userState from '@/store/user/state'
import { useSettingValue } from '@/store/setting/hook'
import { toast, confirmDialog } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import SonglistDetail from '../../../SonglistDetail'
import { type ListInfoItem } from '@/store/songlist/state'
import commonState from '@/store/common/state'
import { setWySubscribedPlaylists, removeWySubscribedPlaylist } from '@/store/user/action.ts'
import { getPlaylistIndex } from '@/core/playlistIndex'
import Menu, { type MenuType, type Position } from '@/components/common/Menu'
import PlaylistEditModal, { type PlaylistEditModalType } from './PlaylistEditModal'
import MusicInfoOnline = LX.Music.MusicInfoOnline

export default memo(() => {
  const playlists = useWySubscribedPlaylists()
  const uid = useWyUid()
  // 底部悬浮层（迷你播放器 + 底部 Tab + 安全区）统一避让高度
  const bottomInset = useBottomOverlayInset()
  // loading = 首次/缓存加载态；refreshing = 只有用户下拉才置位。
  // 【2026-10-03 修复】此前把 RefreshControl.refreshing 直接接在 loading 上，而 loading 初值是
  // true —— 首次进入（无缓存、要联网拉歌单索引）时 RefreshControl 会在首帧就被程序化置为
  // refreshing：iOS 立刻撑开刷新 inset（内容被顶下去），数据到达后 endRefreshing 再回弹，
  // 表现为「首次进入顶部上移一下」；第二次进入有缓存、loading 为 false，所以正常。
  // 与同族页面（TxPlaylist/KgPlaylist）保持一致：只有 onRefresh（用户下拉）才动 refreshing。
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const cookie = useSettingValue('common.wy_cookie')
  const theme = useTheme()
  const t = useI18n()
  const isHorizontal = useHorizontalMode()
  const [selectedPlaylist, setSelectedPlaylist] = useState<ListInfoItem | null>(null)
  const [scrollToMusicInfo, setScrollToMusicInfo] = useState<MusicInfoOnline | null>(null)
  const listRef = useRef<FlatList>(null)
  // 首次进入的幽灵偏移修正（详见 usePhantomScrollGuard 注释）：本页页头（PageTopInset + 大标题）
  // 在列表内容里，首次上屏 / 首次拉取完歌单后原生安全区插图的一次性变化会把 contentOffset 抬到
  // 0 以上（幅度≈刘海高度），表现为整页上移、标题被顶到刘海后面，返回再进就正常。
  // 本页首次进入是联网拉取歌单索引（可能耗时数秒），保护窗口比默认值放宽。
  const phantomGuard = usePhantomScrollGuard(listRef as any, 6000)
  // 守卫与「拖动即收键盘」两个 onScrollBeginDrag 都要保留（前者负责用户一拖动就永久停用守卫）
  const handleScrollBeginDrag = useCallback(() => {
    Keyboard.dismiss()
    phantomGuard.props.onScrollBeginDrag()
  }, [phantomGuard])
  const selectedPlaylistRef = useRef(selectedPlaylist)
  selectedPlaylistRef.current = selectedPlaylist

  const [menuVisible, setMenuVisible] = useState(false)
  const menuRef = useRef<MenuType>(null)
  const selectedItemRef = useRef<any>(null)
  const playlistEditModalRef = useRef<PlaylistEditModalType>(null)

  // 记录上一次加载的 cookie+uid 组合，避免重复请求；cookie 或 uid 变化时强制刷新。
  const lastLoadKeyRef = useRef('')
  // 歌单列表已在启动时从本地缓存回填（core/playlistIndex），有数据就不再重复联网拉取
  const playlistsRef = useRef(playlists)
  playlistsRef.current = playlists
  useEffect(() => {
    if (!cookie || !uid) {
      lastLoadKeyRef.current = ''
      setLoading(false)
      setWySubscribedPlaylists([])
      return
    }
    const loadKey = `${uid}:${cookie}`
    if (lastLoadKeyRef.current === loadKey) {
      setLoading(false)
      return
    }
    lastLoadKeyRef.current = loadKey
    if (playlistsRef.current.length) {
      // 缓存命中：直接展示，不再联网；需要更新时用「设置 - 平台设置 - 刷新同步」或下拉刷新
      setLoading(false)
      return
    }
    setLoading(true)
    void getPlaylistIndex('wy') // 缓存优先，无缓存才联网拉取并写入缓存
      .catch((err: any) => {
        lastLoadKeyRef.current = ''
        toast(`获取歌单失败: ${err.message}`)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [cookie, uid])

  const onRefresh = useCallback(() => {
    if (!cookie || !uid) {
      setLoading(false)
      setWySubscribedPlaylists([])
      return
    }
    // 只动 refreshing：loading 仍代表「首次加载」，页面挂载期间它变 true→false 会让
    // iOS 刷新控件程序化撑开/回弹 inset（就是「顶部上移一下」的根因），这里必须隔离。
    setRefreshing(true)
    void getPlaylistIndex('wy', { force: true })
      .catch((err: any) => {
        toast(`刷新歌单失败: ${err.message}`)
      })
      .finally(() => {
        setRefreshing(false)
      })
  }, [cookie, uid])

  useEffect(() => {
    const onBackPress = () => {
      if (selectedPlaylistRef.current) {
        if (commonState.componentIds.length > 1) {
          return false
        }

        setSelectedPlaylist(null)
        return true
      }

      return false
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress)
    return () => { subscription.remove() }
  }, [])

  const handleItemPress = useCallback((playlistInfo: ListInfoItem) => {
    setSelectedPlaylist(playlistInfo)
  }, [])

  const handleHeartbeatPress = useCallback(async(playlistInfo: ListInfoItem) => {
    if (!cookie || !uid) return
    try {
      toast('正在开启心动模式...')
      let ids = Array.from(userState.wy_liked_song_ids)
      if (!ids?.length) {
        ids = (await wyApi.getLikedSongList(uid, cookie)).map(String)
      }

      if (!ids?.length) {
        toast('没有喜欢的歌曲')
        return
      }

      const randomSongId = ids[Math.floor(Math.random() * ids.length)]
      const musicInfoRes = await wyMusicDetailApi.getList([randomSongId])
      const mInfo = musicInfoRes.list[0]

      if (!mInfo) {
        toast('获取歌曲详情失败')
        return
      }

      const res = await wyDailyRecApi.getHeartbeatModeList(cookie, playlistInfo.id, randomSongId)
      const heartbeatList = [mInfo, ...res.list].filter(Boolean)

      updateSetting({ 'player.togglePlayMethod': MUSIC_TOGGLE_MODE.heartbeat })
      playOnlineList('heartbeat', heartbeatList, 0, false)
      toast('心动模式已开启')
    } catch (err: any) {
      toast(`开启心动模式失败: ${err.message}`)
    }
  }, [cookie, uid])

  const handleMenuPress = useCallback((item: any, position: Position) => {
    selectedItemRef.current = item
    setMenuVisible(true)
    requestAnimationFrame(() => {
      menuRef.current?.show(position)
    })
  }, [])

  const handleMenuAction = useCallback(({ action }: { action: string }) => {
    setMenuVisible(false)
    const item = selectedItemRef.current
    if (!item) return

    switch (action) {
      case 'edit':
        playlistEditModalRef.current?.show({
          id: String(item.id),
          name: item.name,
          desc: item.description || '',
        })
        break
      case 'delete':
        confirmDialog({
          message: `确定要删除歌单"${item.name}"吗？`,
          confirmButtonText: '删除',
        }).then(async(confirmed) => {
          if (!confirmed) return
          try {
            await wyApi.deletePlaylist(item.id)
            toast('删除成功')
            removeWySubscribedPlaylist(item.id)
          } catch (err: any) {
            toast(`删除失败: ${err.message}`)
          }
        })
        break
    }
  }, [])

  // 入口已按 Cookie 登录态显隐（FeatureGrid 门控），不再渲染未登录占位页
  const handleBack = useCallback(() => {
    setSelectedPlaylist(null)
    setScrollToMusicInfo(null)
  }, [])
  return (
    <View style={{ flex: 1 }}>
      <View style={[{ flex: 1 }, selectedPlaylist ? { opacity: 0 } : null]} pointerEvents={selectedPlaylist ? 'none' : 'auto'}>
        <FlatList
          ref={listRef}
          {...phantomGuard.props}
          onScrollBeginDrag={handleScrollBeginDrag}
          data={playlists}
          ListHeaderComponent={
            <>
              <PageTopInset />
              <View style={styles.titleRow}>
                <Text style={styles.titleText} size={34} color={theme['c-font']}>
                  {t('nav_my_playlist')}
                </Text>
              </View>
            </>
          }
          contentContainerStyle={{ paddingBottom: bottomInset }}
          key={isHorizontal ? 'horizontal' : 'vertical'}
          numColumns={isHorizontal ? 2 : 1}
          columnWrapperStyle={isHorizontal ? { paddingHorizontal: 8 } : undefined}
          renderItem={({ item }) => (
            <View style={isHorizontal ? { flex: 1 } : null}>
              <ListItem item={item} onPress={handleItemPress} onHeartbeatPress={handleHeartbeatPress} onMenuPress={handleMenuPress} />
            </View>
          )}
          keyExtractor={item => String(item.id)}
          ListEmptyComponent={
            // 首屏加载不再用 RefreshControl 的 spinner（那会撑开 inset 造成顶部回弹），
            // 改为列表内一条轻提示：加载中 / 暂无歌单
            <View style={styles.emptyHint}>
              <Text size={13} color={theme['c-500']}>{loading ? t('list_loading') : t('list_empty')}</Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              colors={[theme['c-primary']]}
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          }
        />
      </View>
      {selectedPlaylist && (
        <View style={[StyleSheet.absoluteFill]}>
          <SonglistDetail info={selectedPlaylist} onBack={handleBack} initialScrollToInfo={scrollToMusicInfo} />
        </View>
      )}
      {menuVisible && (
        <Menu
          ref={menuRef}
          menus={[{ action: 'edit', label: '编辑' }, { action: 'delete', label: '删除' }]}
          onPress={handleMenuAction}
          onHide={() => { setMenuVisible(false) }}
        />
      )}
      <PlaylistEditModal ref={playlistEditModalRef} />
    </View>
  )
})

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    // 与歌单卡片的 marginHorizontal(md=16) 对齐，标题与列表左右缩进一致
    paddingHorizontal: designSpacing.md,
    marginBottom: designSpacing.sm,
  },
  titleText: {
    fontWeight: '800',
    lineHeight: 36,
  },
  emptyHint: {
    paddingTop: designSpacing.lg,
    alignItems: 'center',
  },
})

