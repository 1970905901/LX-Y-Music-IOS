import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { View, BackHandler, TouchableOpacity } from 'react-native'
import MusicList, { type MusicListType } from './MusicList'
import { type ListInfoItem } from '@/store/songlist/state'
import { ListInfoContext } from './state'
import ActionBar from './ActionBar'
import Image from '@/components/common/Image'
import Text from '@/components/common/Text'
import { NAV_SHEAR_NATIVE_IDS, COMPONENT_IDS, LIST_IDS } from '@/config/constant'
import { createStyle, toast } from '@/utils/tools'
import { scaleSizeW } from '@/utils/pixelRatio'
import { useTheme } from '@/store/theme/hook'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'

import commonState from '@/store/common/state'
import { pop } from '@/navigation'
import { Icon } from '@/components/common/Icon'
import { SvgIcon } from '@/components/common/SvgIcon'
import Input from '@/components/common/Input'
import { useIsWyPlaylistSubscribed, useWySubscribedPlaylists, useWyUid } from '@/store/user/hook'
import wyApi from '@/utils/musicSdk/wy/user'
import { addWySubscribedPlaylist, removeWySubscribedPlaylist } from '@/store/user/action'

import { type DetailInfo } from '@/screens/SonglistDetail/Header.tsx'
import LandscapeDetailLayout from '@/components/LandscapeDetailLayout'
import PageContent from '@/components/PageContent'
import SwipeBackArea from '@/components/common/SwipeBackArea'
import playerState from '@/store/player/state'

import listState from '@/store/list/state'
import { usePlayerMusicInfo } from '@/store/player/hook.ts'
import { useStatusbarHeight } from '@/store/common/hook'
import MusicInfoOnline = LX.Music.MusicInfoOnline

const IMAGE_WIDTH = scaleSizeW(104)

const ListHeader = ({ detailInfo, info, onBack, showSearchBar, searchText, isFuzzySearch, onToggleSearch, onSearchTextChanged, onToggleSearchMode }: { detailInfo: DetailInfo, info: ListInfoItem, onBack?: () => void, showSearchBar: boolean, searchText: string, isFuzzySearch: boolean, onToggleSearch: () => void, onSearchTextChanged: (text: string) => void, onToggleSearchMode: () => void }) => {
  const theme = useTheme()
  const statusBarHeight = useStatusbarHeight()
  const loggedInUserId = useWyUid()
  const isSubscribed = useIsWyPlaylistSubscribed(info.id)

  const isWyCreator = useMemo(() => {
    return info.source === 'wy' &&
      detailInfo.userId &&
      String(detailInfo.userId) === String(loggedInUserId)
  }, [info.source, detailInfo.userId, loggedInUserId])

  const showSubscribeButton = useMemo(() => {
    return info.source === 'wy' && !isWyCreator
  }, [info.source, isWyCreator])

  const toggleSubscribe = useCallback(() => {
    const newSubState = !isSubscribed
    wyApi.subPlaylist(String(info.id), newSubState).then(() => {
      toast(newSubState ? '收藏成功' : '取消收藏成功')
      if (newSubState) {
        addWySubscribedPlaylist({
          id: info.id,
          userId: detailInfo.userId as number,
          name: detailInfo.name,
          coverImgUrl: detailInfo.imgUrl || '',
          trackCount: (info.total || 0) as number,
        })
      } else {
        removeWySubscribedPlaylist(info.id)
      }
    }).catch((err: any) => {
      toast(`操作失败: ${err.message}，可能是Cookie已失效，请重新登录`)
    })
  }, [isSubscribed, info, detailInfo])

  return (
    <>
      {/* 内嵌在歌单/搜索等 Home 子页面时没有共享页头兜底状态栏，需自行让出状态栏高度；
          独立 push 模式由 RNN safeAreaInsets 负责顶部安全区，再叠加会出现大段空白 */}
      <View style={{ ...styles.listHeaderContainer, paddingTop: onBack ? statusBarHeight : 0 }}>
        <View style={styles.headerContent}>
          <View style={{ ...styles.listItemImg, width: IMAGE_WIDTH, height: IMAGE_WIDTH }}>
            {info.isFavorites ? (
              <View style={{ ...styles.favoritesPlaceholder, backgroundColor: theme['c-primary-background'] }}>
                <Icon name="love-filled" color="#FF4D6A" size={36} />
              </View>
            ) : (
              <Image
                nativeID={`${NAV_SHEAR_NATIVE_IDS.songlistDetail_pic}_to_${info.id}`}
                url={detailInfo.imgUrl}
                style={styles.cover}
              />
            )}
            {detailInfo.playCount ? (
              <Text style={styles.playCount} numberOfLines={1}>
                {detailInfo.playCount}
              </Text>
            ) : null}
          </View>
          <View
            style={styles.titleContent}
            nativeID={NAV_SHEAR_NATIVE_IDS.songlistDetail_title}
          >
            <Text size={designTypography.title} style={{ ...styles.name, color: theme['c-font'] }} numberOfLines={2}>
              {detailInfo.name}
            </Text>
            <View style={styles.descContainer}>
              <View style={{ flexGrow: 1, flexShrink: 1 }}>
                <Text size={designTypography.caption} color={theme['c-font-label']} numberOfLines={3}>
                  {detailInfo.desc}
                </Text>
              </View>
              {showSubscribeButton && (
                <TouchableOpacity style={styles.subscribeButton} onPress={toggleSubscribe}>
                  <Icon name={isSubscribed ? 'love-filled' : 'love'} color={isSubscribed ? theme['c-liked'] : theme['c-font-label']} size={20} />
                </TouchableOpacity>
              )}
            </View>
          </View>
          <TouchableOpacity
            style={{ ...styles.searchIcon, backgroundColor: theme['c-primary-background'] }}
            onPress={onToggleSearch}
          >
            <Icon name="search-2" size={20} color={theme['c-font-label']} />
          </TouchableOpacity>
        </View>
        {showSearchBar && (
          <View style={styles.searchBarContainer}>
            <Input
              placeholder="搜索歌曲名称、歌手..."
              value={searchText}
              onChangeText={onSearchTextChanged}
              autoFocus
              style={{ ...styles.searchInput, backgroundColor: theme['c-primary-input-background'] }}
            />
            <TouchableOpacity style={styles.searchModeButton} onPress={onToggleSearchMode}>
              {isFuzzySearch ? (
                <Icon name="search-2" size={20} color={theme['c-font-label']} />
              ) : (
                <SvgIcon name="fuzzy-search" size={24} color={theme['c-font-label']} />
              )}
            </TouchableOpacity>
          </View>
        )}
        <ActionBar onBack={onBack} />
      </View>
    </>
  )
}

export default ({ info, onBack, componentId, initialScrollToInfo }: { info: ListInfoItem, onBack?: () => void, componentId?: string, initialScrollToInfo: MusicInfoOnline | null }) => {
  const musicListRef = useRef<MusicListType>(null)
  const [detailInfo, setDetailInfo] = useState<DetailInfo>({
    name: info.name,
    desc: info.desc || '',
    playCount: info.play_count || '',
    imgUrl: info.img,
    userId: info.userId,
    total: Number(info.total) || 0,
  })
  const [showSearchBar, setShowSearchBar] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [isFuzzySearch, setIsFuzzySearch] = useState(true)
  const playlists = useWySubscribedPlaylists()
  const isInitialMount = useRef(true)
  const playerMusicInfo = usePlayerMusicInfo()
  const initialScrollDoneRef = useRef(false)

  // 内嵌模式由宿主页面传入 onBack；独立 push 模式没有 onBack，用 componentId pop 自己，
  // 否则返回按钮是个空操作
  const handleBack = useMemo(() => onBack ?? (componentId
    ? () => { void pop(componentId) }
    : undefined), [onBack, componentId])

  const refreshList = useCallback((isRefresh = false) => {
    if (global.lx.isEnableLog) console.log('[SonglistDetail] refreshList', { source: info.source, id: info.id, isRefresh })
    musicListRef.current?.loadList(info.source, info.id, isRefresh).then(setDetailInfo)
  }, [info.source, info.id])

  useEffect(() => {
    const handleJumpPosition = () => {
      let listId = playerState.playMusicInfo.listId
      if (listId === LIST_IDS.TEMP) listId = listState.tempListMeta.id
      if (listId !== `${info.source}__${info.id}`) return
      const musicInfo = playerState.playMusicInfo.musicInfo
      if (musicInfo) {
        musicListRef.current?.scrollToInfo(musicInfo as LX.Music.MusicInfoOnline)
      }
    }
    global.app_event.on('jumpListPosition', handleJumpPosition as () => Promise<void>)
    return () => {
      global.app_event.off('jumpListPosition', handleJumpPosition as () => Promise<void>)
    }
  }, [info.id, info.source])

  useEffect(() => {
    refreshList(true)
  }, [refreshList])

  useEffect(() => {
    // Normalize ID for event matching: strip all known prefixes so different ID formats match
    const normalizeId = (id: string) =>
      id.toString().replace('kg__', '').replace('collection_', '').replace('id_', '')

    const handlePlaylistUpdate = ({ source, listId, addedSong }: { source: string, listId: string, addedSong?: any }) => {
      if (info.source === source && normalizeId(info.id) === normalizeId(listId)) {
        if (addedSong) {
          musicListRef.current?.addSongToList(addedSong)
        } else {
          setTimeout(() => {
            refreshList(true)
          }, 100)
        }
      }
    }
    global.app_event.on('playlist_updated', handlePlaylistUpdate)
    return () => {
      global.app_event.off('playlist_updated', handlePlaylistUpdate)
    }
  }, [info.id, info.source, refreshList])

  useEffect(() => {
    const onBackPress = () => {
      const lastScreen = commonState.componentIds[commonState.componentIds.length - 1]

      if (lastScreen && lastScreen.name !== COMPONENT_IDS.home) {
        return false
      }

      handleBack?.()
      return true
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress)
    return () => { subscription.remove() }
  }, [handleBack])

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    const updatedPlaylist = playlists.find(p => String(p.id) === String(info.id))
    if (!updatedPlaylist) {
      return
    }
    if (updatedPlaylist.name !== detailInfo.name || (updatedPlaylist.description !== detailInfo.desc && updatedPlaylist.description != null)) {
      setDetailInfo(prev => ({
        ...prev,
        name: updatedPlaylist.name,
        desc: updatedPlaylist.description || '',
      }))
    }
  }, [playlists, handleBack, info.id, detailInfo.name, detailInfo.desc])

  useEffect(() => {
    if (initialScrollToInfo && (detailInfo.total ?? 0) > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true
      setTimeout(() => {
        musicListRef.current?.scrollToInfo(initialScrollToInfo)
      }, 300)
    }
  }, [detailInfo.total, initialScrollToInfo])

  const handleToggleSearch = useCallback(() => {
    setShowSearchBar(prev => {
      if (prev) {
        setSearchText('')
        setIsFuzzySearch(true)
      }
      return !prev
    })
  }, [])

  const handleSearchTextChanged = useCallback((text: string) => {
    setSearchText(text)
  }, [])

  const handleToggleSearchMode = useCallback(() => {
    setIsFuzzySearch(prev => {
      toast(prev ? '精确搜索' : '模糊搜索')
      return !prev
    })
  }, [])

  const ListHeaderComponent = useMemo(() => (
    <ListHeader detailInfo={detailInfo} info={info} onBack={handleBack as () => void} showSearchBar={showSearchBar} searchText={searchText} isFuzzySearch={isFuzzySearch} onToggleSearch={handleToggleSearch} onSearchTextChanged={handleSearchTextChanged} onToggleSearchMode={handleToggleSearchMode} />
  ), [detailInfo, info, handleBack, showSearchBar, searchText, isFuzzySearch, handleToggleSearch, handleSearchTextChanged, handleToggleSearchMode])

  const handleListUpdate = useCallback((newList: LX.Music.MusicInfoOnline[]) => {
    setDetailInfo(prev => ({
      ...prev,
      total: newList.length,
    }))
  }, [])

  // 歌单信息 context 必须包住【页头 + 歌曲列表】：
  // 页头里的操作栏（播放全部 / 收藏歌单）是用 useListInfo() 取歌单 id/source 的，
  // 之前 Provider 只包了 body（MusicList），页头落在 Provider 之外，拿到的是
  // createContext 的默认值（id=''、source='kw'），于是：
  //   「播放全部」→ 用空 id 写临时列表（只有页面已加载的那部分歌）+ 用空 id 去拉完整歌单
  //   （必然失败，且失败被静默吞掉）→ 临时播放列表永远缺歌；
  //   「收藏歌单」→ 同理用空 id，会收藏出一个空歌单。
  const detailContent = (
    <ListInfoContext.Provider value={info}>
      <LandscapeDetailLayout
        header={ListHeaderComponent}
        // 歌单详情内嵌在 Home 右栏（左侧已让出导航栏/标签栏宽度），
        // 横屏若再左右分栏，列表会被挤到 ~400pt 还要拆两列，歌曲名/来源显示不全。
        // 改为上下堆叠：header（封面/简介/收藏歌单·播放全部·返回）全宽在上，
        // 歌曲列表占满下方整行宽度并延伸到最右侧，两列各自获得充足宽度。
        stackOnLandscape
        body={
          <MusicList ref={musicListRef} playingId={playerMusicInfo.id} componentId={commonState.componentIds[commonState.componentIds.length - 1]?.id} isCreator={true} searchText={searchText} isFuzzySearch={isFuzzySearch} onListUpdate={handleListUpdate} />
        }
        footer={handleBack ? <SwipeBackArea onBack={handleBack} /> : undefined}
      />
    </ListInfoContext.Provider>
  )

  // 作为独立页面 push 时（无 onBack）需要 PageContent 提供全局背景与窗口尺寸测量；
  // 内嵌在 SongList/Search/TxPlaylist 等 Home 子页面时，外部已由 Home 的 PageContent 兜底，
  // 若再包一层 PageContent，其 SizeView 会按右侧面板尺寸覆写 windowSizeTools，
  // 导致 useHorizontalMode 误判为竖屏，iPad 横屏下详情页布局异常/跳动。
  return onBack ? detailContent : <PageContent>{detailContent}</PageContent>
}

const styles = createStyle({
  listHeaderContainer: {
    flexDirection: 'column',
    flexWrap: 'nowrap',
  },
  headerContent: {
    flexDirection: 'row',
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: designSpacing.md,
    paddingTop: designSpacing.md,
  },
  listItemImg: {
    flexGrow: 0,
    flexShrink: 0,
    overflow: 'hidden',
  },
  cover: {
    flex: 1,
    borderRadius: designRadius.md,
  },
  titleContent: {
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 1,
    paddingLeft: designSpacing.md,
  },
  name: {
    fontWeight: '800',
  },
  playCount: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '600',
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.55)',
    color: '#fff',
  },
  descContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    flexShrink: 1,
  },
  searchIcon: {
    width: 40,
    height: 40,
    borderRadius: 999,
    marginLeft: designSpacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 5,
    paddingLeft: 10,
  },
  searchInput: {
    flex: 1,
    height: 32,
    borderWidth: 0,
    borderRadius: 4,
    paddingHorizontal: 10,
    fontSize: 14,
    justifyContent: 'center',
  },
  searchModeButton: {
    width: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subscribeButton: {
    paddingLeft: 10,
    paddingRight: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  favoritesPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 4,
  },
})
