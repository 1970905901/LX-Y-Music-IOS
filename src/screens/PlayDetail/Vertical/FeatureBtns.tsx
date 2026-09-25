import { memo, useRef, useCallback } from 'react'
import { View, TouchableOpacity } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { scaleSizeW } from '@/utils/pixelRatio'
import { navigations } from '@/navigation'
import playerState from '@/store/player/state'
import PlayDetailMenu, { type PlayDetailMenuType, type SelectInfo } from '@/screens/PlayDetail/components/PlayDetailMenu'
import MusicAddModal, { type MusicAddModalType } from '@/components/MusicAddModal'
import SimilarSongsModal, { type SimilarSongsModalType } from '@/components/SimilarSongsModal'
import settingState from '@/store/setting/state'
import { handleDislikeMusic, handleClearMusicCache } from '@/screens/Home/Views/Mylist/MusicList/listAction'
import { downloadMusic } from '@/core/download'
import { handleLikeMusic, handleTxLikeMusic, handleKgLikeMusic, handleShowAlbumDetail, handleShowArtistDetail } from '@/components/OnlineList/listAction'
import { type Position } from '@/screens/Home/Views/Mylist/MusicList/ListMenu'
import { useWindowSize } from '@/utils/hooks'

const BTN_SIZE = scaleSizeW(42)

export default memo(({ componentId }: { componentId: string }) => {
  const theme = useTheme()
  const iconOpacity = 0.7
  const { height: winHeight } = useWindowSize()
  const isSmallWindow = winHeight < 700
  const menuRef = useRef<PlayDetailMenuType>(null)
  const musicAddModalRef = useRef<MusicAddModalType>(null)

  const similarSongsModalRef = useRef<SimilarSongsModalType>(null)
  const moreBtnRef = useRef<TouchableOpacity>(null)

  const handleDownloadPress = useCallback(() => {
    const info = playerState.playMusicInfo.musicInfo
    if (!info) return
    const musicInfo = 'progress' in info ? info.metadata.musicInfo : info
    if (settingState.setting['download.enable']) {
      downloadMusic(musicInfo)
    }
  }, [])

  const handleCommentPress = useCallback(() => {
    navigations.pushCommentScreen(componentId)
  }, [componentId])

  const handleShowMenu = useCallback(() => {
    const musicInfo = playerState.playMusicInfo.musicInfo
    if (!musicInfo) return
    moreBtnRef.current?.measure((fx, fy, width, height, px, py) => {
      const position: Position = {
        x: Math.ceil(px),
        y: Math.ceil(py),
        w: Math.ceil(width),
        h: Math.ceil(height),
      }
      menuRef.current?.show({ musicInfo: 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo }, position)
    })
  }, [])

  const handleAddPress = useCallback(() => {
    const musicInfo = playerState.playMusicInfo.musicInfo
    if (!musicInfo) return
    musicAddModalRef.current?.show({
      musicInfo: 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo,
      isMove: false,
      listId: playerState.playMusicInfo.listId!,
    })
  }, [])

  const onAdd = useCallback((info: SelectInfo) => {
    musicAddModalRef.current?.show({
      musicInfo: info.musicInfo,
      isMove: false,
      listId: playerState.playMusicInfo.listId!,
    })
  }, [])

  const onLike = useCallback((info: SelectInfo) => {
    if (info.musicInfo.source === 'wy') {
      handleLikeMusic(info.musicInfo as LX.Music.MusicInfoOnline)
    } else if (info.musicInfo.source === 'tx') {
      handleTxLikeMusic(info.musicInfo as LX.Music.MusicInfoOnline)
    } else if (info.musicInfo.source === 'kg') {
      handleKgLikeMusic(info.musicInfo as LX.Music.MusicInfoOnline)
    }
  }, [])

  const onDownload = useCallback((info: SelectInfo) => {
    if (settingState.setting['download.enable']) {
      downloadMusic(info.musicInfo)
    }
  }, [])

  const onArtistDetail = useCallback((info: SelectInfo) => {
    if (info.musicInfo.source !== 'local') {
      handleShowArtistDetail(componentId, info.musicInfo)
    }
  }, [componentId])

  const onAlbumDetail = useCallback((info: SelectInfo) => {
    if (info.musicInfo.source !== 'local') {
      handleShowAlbumDetail(componentId, info.musicInfo)
    }
  }, [componentId])

  const onSimilarSongs = useCallback((info: SelectInfo) => {
    similarSongsModalRef.current?.show(info.musicInfo)
  }, [])

  const onDislikeMusic = useCallback((info: SelectInfo) => {
    void handleDislikeMusic(info.musicInfo)
  }, [])


  const onClearCache = useCallback((info: SelectInfo) => {
    void handleClearMusicCache(info.musicInfo)
  }, [])

  return (
    <View style={[styles.container, isSmallWindow && { paddingVertical: 6 }]}>
      <TouchableOpacity style={styles.btnItem} onPress={handleAddPress} activeOpacity={0.6}>
        <View style={{ opacity: iconOpacity }}><Icon name="add-music" color={theme['c-font']} rawSize={BTN_SIZE * 0.6} /></View>
      </TouchableOpacity>
      <TouchableOpacity style={styles.btnItem} onPress={handleDownloadPress} activeOpacity={0.6}>
        <View style={{ opacity: iconOpacity }}><Icon name="download-2" color={theme['c-font']} rawSize={BTN_SIZE * 0.55} /></View>
      </TouchableOpacity>
      <TouchableOpacity style={styles.btnItem} onPress={handleCommentPress} activeOpacity={0.6}>
        <View style={{ opacity: iconOpacity }}><Icon name="comment" color={theme['c-font']} rawSize={BTN_SIZE * 0.6} /></View>
      </TouchableOpacity>
      <TouchableOpacity ref={moreBtnRef} style={styles.btnItem} onPress={handleShowMenu} activeOpacity={0.6}>
        <View style={{ opacity: iconOpacity }}><Icon name="dots-vertical" color={theme['c-font']} rawSize={BTN_SIZE * 0.6} /></View>
      </TouchableOpacity>
      <PlayDetailMenu
        ref={menuRef}
        onAdd={onAdd}
        onLike={onLike}
        onDownload={onDownload}
        onArtistDetail={onArtistDetail}
        onAlbumDetail={onAlbumDetail}
        onSimilarSongs={onSimilarSongs}
        onDislikeMusic={onDislikeMusic}
        onClearCache={onClearCache}
      />
      <MusicAddModal ref={musicAddModalRef} />
      <SimilarSongsModal ref={similarSongsModalRef} />
    </View>
  )
})

const styles = createStyle({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    paddingVertical: 16,
  },
  btnItem: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
