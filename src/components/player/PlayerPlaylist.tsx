import {forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback, memo, useMemo} from 'react';
import AnimatedSlideUpPanel, { type AnimatedSlideUpPanelType } from '@/components/common/AnimatedSlideUpPanel';
import { useI18n } from '@/lang';
import { FlatList, View, TouchableOpacity } from 'react-native';
import Text from '@/components/common/Text';
import { useTheme } from '@/store/theme/hook';
import playerState from '@/store/player/state';
import { usePlayerMusicInfo, useTempPlayList } from '@/store/player/hook';
import { createStyle, toast, type RowInfo } from '@/utils/tools';
import { scaleSizeH } from '@/utils/pixelRatio';
import { LIST_ITEM_HEIGHT } from '@/config/constant';
import MusicAddModal, { type MusicAddModalType } from '@/components/MusicAddModal';
import { useSettingValue } from '@/store/setting/hook'
import { useSafeAreaBottom } from '@/store/common/hook';
import { downloadMusic } from '@/core/download';
import { useWindowSize } from '@/utils/hooks';
import { addTempPlayList, playTempListAt, playCurrentListAt, removeTempPlayList } from '@/core/player/tempPlayList';
import { getList } from '@/core/player/playInfo';
import { Icon } from "@/components/common/Icon.tsx";

import OnlineListItem from '@/components/OnlineList/ListItem';
import ListMenu, { type ListMenuType, type Position, type SelectInfo } from '@/components/OnlineList/ListMenu';
import {
  handleDislikeMusic,
  handleLikeMusic,
  handleTxLikeMusic,
  handleKgLikeMusic,
  handleShowAlbumDetail,
  handleShowArtistDetail,
} from "@/components/OnlineList/listAction";
import settingState from '@/store/setting/state';
import commonState from '@/store/common/state';
import SimilarSongsModal, { type SimilarSongsModalType } from '@/components/SimilarSongsModal'
import { getMvUrl as getWyMvUrl } from '@/utils/musicSdk/wy/mv.js'
import { getMvUrl as getTxMvUrl } from '@/utils/musicSdk/tx/mv.js'
import { getMvUrl as getKgMvUrl } from '@/utils/musicSdk/kg/mv.js'

export interface PlayerPlaylistType {
  show: () => void;
}

// AnimatedSlideUpPanel 的面板高度固定为窗口高度的 50%（见其 styles.panel）
const PANEL_HEIGHT_RATIO = 0.5
// 面板列表头部高度：标题上下各 15 的 padding + 14 号字行高约 20 + 1px 分隔线
const PANEL_HEADER_HEIGHT = 51

const getMusicId = (item: LX.Player.PlayMusic) => ('progress' in item ? item.metadata.musicInfo.id : item.id)

/**
 * 计算 FlatList 的 initialScrollIndex。
 * initialScrollIndex 会把目标行置于可视区顶部，这里回退「半个可视区行数」，
 * 让当前播放歌曲大致居中，与原先 scrollToIndex({ viewPosition: 0.5 }) 的观感一致。
 */
const getInitialScrollIndex = (list: LX.Player.PlayMusic[], playId: string, windowHeight: number) => {
  if (!list.length || !playId) return 0
  const activeIndex = list.findIndex(item => getMusicId(item) === playId)
  if (activeIndex <= 0) return 0
  const itemHeight = scaleSizeH(LIST_ITEM_HEIGHT)
  if (itemHeight <= 0) return 0
  const visibleHeight = windowHeight * PANEL_HEIGHT_RATIO - PANEL_HEADER_HEIGHT
  const halfVisibleCount = Math.floor(visibleHeight / itemHeight / 2)
  return Math.max(0, activeIndex - halfVisibleCount)
}

export default forwardRef<PlayerPlaylistType, {}>((props, ref) => {
  const panelRef = useRef<AnimatedSlideUpPanelType>(null);
  const t = useI18n();
  const theme = useTheme();
  const playerMusicInfo = usePlayerMusicInfo();
  const tempPlayList = useTempPlayList();
  const { height: windowHeight } = useWindowSize();
  const [initialIndex, setInitialIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const listMenuRef = useRef<ListMenuType>(null);
  const musicAddModalRef = useRef<MusicAddModalType>(null);
  const similarSongsModalRef = useRef<SimilarSongsModalType>(null);
  const isShowAlbumName = useSettingValue('list.isShowAlbumName');
  const isShowInterval = useSettingValue('list.isShowInterval');
  const showCover = useSettingValue('list.isShowCover');
  // 底部安全区：列表最后一行补 paddingBottom，避免被 Home 指示器 / iPad 底部区域遮挡
  const safeAreaBottom = useSafeAreaBottom();
  const rowInfo = useRef({ rowNum: undefined, rowWidth: '100%' } as const).current;

  // 播放器面板展示当前播放队列：
  // 1. 当存在「稍后播放」队列时优先展示该队列；
  // 2. 否则展示当前播放列表，从当前歌曲位置开始。
  const playlist = useMemo<LX.Player.PlayMusic[]>(() => {
    const tempItems = (tempPlayList ?? []).map(item => item.musicInfo)
    if (tempItems.length) return tempItems
    const listId = playerState.playInfo.playerListId
    if (!listId) return []
    return (getList(listId) as LX.Player.PlayMusic[])
  }, [tempPlayList, playerMusicInfo.id]);

  // 依赖必须列出，否则 ref 暴露的 show() 会永久闭包首次渲染的旧值。
  useImperativeHandle(ref, () => ({
    show() {
      // 面板隐藏时 AnimatedSlideUpPanel 直接 return null，FlatList 每次打开都是全新挂载。
      // 因此必须在挂载前一次性备好数据与初始滚动位置：若数据/定位留到挂载后再 setState，
      // 首帧会先渲染上一次残留的列表并停在顶部，随后才被拉到当前播放项 —— 就是「跳一下」。
      setInitialIndex(getInitialScrollIndex(playlist, playerMusicInfo.id, windowHeight));
      setIsVisible(true);
    },
  }), [playlist, playerMusicInfo.id, windowHeight]);

  const { activeIndex, totalCount } = useMemo(() => {
    if (!playlist.length) return { activeIndex: -1, totalCount: 0 };

    const index = playlist.findIndex(item => getMusicId(item) === playerMusicInfo.id);
    return { activeIndex: index, totalCount: playlist.length };
  }, [playlist, playerMusicInfo.id]);

  useEffect(() => {
    if (!isVisible) return;
    panelRef.current?.setVisible(true);
  }, [isVisible]);

  const handlePlay = useCallback((index: number) => {
    if ((tempPlayList ?? []).length) {
      playTempListAt(index)
      return
    }
    const listId = playerState.playInfo.playerListId
    if (!listId) return
    playCurrentListAt(listId, index)
  }, [tempPlayList, playerMusicInfo.id]);

  const handleShowMenu = useCallback((musicInfo: LX.Music.MusicInfo, index: number, position: Position) => {
    const adaptedMusicInfo = {
      ...musicInfo,
      source: musicInfo.source as LX.OnlineSource,
      meta: {
        ...musicInfo.meta,
        qualitys: (musicInfo as LX.Music.MusicInfoOnline).meta.qualitys || [],
        _qualitys: (musicInfo as LX.Music.MusicInfoOnline).meta._qualitys || {},
      },
    } as LX.Music.MusicInfoOnline;

    listMenuRef.current?.show({
      musicInfo: adaptedMusicInfo,
      index,
      single: true,
      selectedList: [],
    }, position);
  }, []);


  const renderItem = ({ item, index }: { item: LX.Player.PlayMusic, index: number }) => {
    const originalMusicInfo = ('progress' in item ? item.metadata.musicInfo : item);

    const renderableMusicInfo: LX.Music.MusicInfoOnline = {
      ...originalMusicInfo,
      id: originalMusicInfo.id,
      name: originalMusicInfo.name,
      singer: originalMusicInfo.singer,
      source: originalMusicInfo.source as LX.OnlineSource,
      interval: originalMusicInfo.interval,
      alias: originalMusicInfo.alias || null,
      artists: originalMusicInfo.artists || [],
      meta: {
        ...originalMusicInfo.meta,
        songId: originalMusicInfo.meta.songId,
        picUrl: originalMusicInfo.meta.picUrl,
        albumName: originalMusicInfo.meta.albumName,
        qualitys: (originalMusicInfo as LX.Music.MusicInfoOnline).meta.qualitys || [],
        _qualitys: (originalMusicInfo as LX.Music.MusicInfoOnline).meta._qualitys || {},
        fee: (originalMusicInfo as LX.Music.MusicInfoOnline).meta.fee ?? 0,
        originCoverType: (originalMusicInfo as LX.Music.MusicInfoOnline).meta.originCoverType ?? 0,
      },
    } as LX.Music.MusicInfoOnline;

    const listIdForIcon = playerState.playMusicInfo.listId ?? undefined;

    return (
      <OnlineListItem
        item={renderableMusicInfo}
        index={index}
        onPress={() => handlePlay(index)}
        onLongPress={() => {}}
        onShowMenu={(musicInfo, index, position) => {
          handleShowMenu(originalMusicInfo, index, position);
        }}
        selectedList={[]}
        playingId={playerMusicInfo.id}
        rowInfo={rowInfo}
        isShowAlbumName={isShowAlbumName}
        isShowInterval={isShowInterval}
        listId={listIdForIcon ?? undefined}
        showCover={showCover}
        hideMenu={false}
      />
    );
  };

  const getItemLayout = useCallback((data: any, index: number) => ({
    length: scaleSizeH(LIST_ITEM_HEIGHT),
    offset: scaleSizeH(LIST_ITEM_HEIGHT) * index,
    index,
  }), []);

  // 缓存容器样式：直接写字面量会每次渲染生成新对象，触发 FlatList 重复布局
  const listContentStyle = useMemo(() => ({ paddingBottom: safeAreaBottom }), [safeAreaBottom]);

  const onAdd = (info: SelectInfo) => {
    musicAddModalRef.current?.show({
      musicInfo: info.musicInfo,
      isMove: false,
      listId: playerState.playMusicInfo.listId!,
    });
  };

  const onPlayLater = (info: SelectInfo) => {
    addTempPlayList([{
      listId: playerState.playMusicInfo.listId!,
      musicInfo: info.musicInfo,
      isTop: true,
    }]);
    toast('已添加到下一首播放');
  };

  const onDownload = (info: SelectInfo) => {
    downloadMusic(info.musicInfo);
  };

  const onArtistDetail = (info: SelectInfo) => {
    requestAnimationFrame(() => {
      handleShowArtistDetail(commonState.componentIds[commonState.componentIds.length - 1]?.id!, info.musicInfo);
      panelRef.current?.setVisible(false);
    });
  };

  const onAlbumDetail = (info: SelectInfo) => {
    requestAnimationFrame(() => {
      handleShowAlbumDetail(commonState.componentIds[commonState.componentIds.length - 1]?.id!, info.musicInfo);
      panelRef.current?.setVisible(false);
    });
  };

  const onSimilarSongs = (info: SelectInfo) => {
    panelRef.current?.setVisible(false);
    similarSongsModalRef.current?.show(info.musicInfo);
  };

  const onLike = (info: SelectInfo) => {
    if (info.musicInfo.source === 'wy') {
      handleLikeMusic(info.musicInfo as LX.Music.MusicInfoOnline);
    } else if (info.musicInfo.source === 'tx') {
      handleTxLikeMusic(info.musicInfo as LX.Music.MusicInfoOnline);
    } else if (info.musicInfo.source === 'kg') {
      handleKgLikeMusic(info.musicInfo as LX.Music.MusicInfoOnline);
    }
  };

  const onPlayMv = (info: SelectInfo) => {
    const musicInfo = info.musicInfo as LX.Music.MusicInfoOnline
    console.log('[MV] 点击播放MV, source:', musicInfo.source, 'musicInfo:', musicInfo)
    
    if (musicInfo.source === 'wy') {
      const mvId = musicInfo.meta.mv
      if (!mvId) {
        console.log('[MV] 网易云: 无MV ID')
        return
      }

      console.log('[MV] 网易云: 获取MV URL, mvId:', mvId)
      panelRef.current?.setVisible(false)
      getWyMvUrl(mvId).then(data => {
        console.log('[MV] 网易云: 获取MV URL成功:', data)
        global.app_event.showVideoPlayer(data.url)
      }).catch(err => {
        console.error('[MV] 网易云: 获取MV失败:', err)
        toast(err.message || '获取MV失败')
      })
    } else if (musicInfo.source === 'tx') {
      const vid = musicInfo.meta.vid
      if (!vid) {
        console.log('[MV] QQ: 无VID')
        return
      }

      console.log('[MV] QQ: 获取MV URL, vid:', vid)
      panelRef.current?.setVisible(false)
      getTxMvUrl(vid).then(data => {
        console.log('[MV] QQ: 获取MV URL成功:', data)
        global.app_event.showVideoPlayer(data.url)
      }).catch(err => {
        console.error('[MV] QQ: 获取MV失败:', err)
        toast(err.message || '获取MV失败')
      })
    } else if (musicInfo.source === 'kg') {
      const mixSongId = (musicInfo.meta as { mixSongId?: string | number }).mixSongId || (musicInfo as { mixSongId?: string | number }).mixSongId
      const songName = musicInfo.name
      const singerName = musicInfo.singer
      if (!mixSongId) {
        console.log('[MV] 酷狗: 无mixSongId')
        toast('无法获取歌曲ID')
        return
      }

      console.log('[MV] 酷狗: 开始获取MV, mixSongId:', mixSongId, 'songName:', songName, 'singerName:', singerName)
      panelRef.current?.setVisible(false)
      getKgMvUrl(String(mixSongId), songName, singerName).then((data: { url?: string }) => {
        console.log('[MV] 酷狗: 获取MV URL成功:', data)
        if (data && data.url) {
          global.app_event.showVideoPlayer(data.url)
        } else {
          console.log('[MV] 酷狗: 返回数据无URL:', data)
          toast('获取MV链接失败')
        }
      }).catch(err => {
        console.error('[MV] 酷狗: 获取MV失败:', err)
        toast(err.message || '该歌曲暂无MV')
      })
    }
  }

  const onRemove = useCallback(async (info: SelectInfo) => {
    removeTempPlayList(info.index)
  }, [])

  const handlePanelHide = () => {
    setIsVisible(false);
  };

  return (
    <>
      <AnimatedSlideUpPanel ref={panelRef} onHide={handlePanelHide}>
        <View style={{ ...styles.panelContent, backgroundColor: theme['c-content-background'] }}>
          <View style={{ ...styles.header, borderBottomColor: theme['c-border-background'] }}>
            <View style={styles.headerTitleContainer}>
              <Text style={styles.panelTitle}>{t('list_name_temp')}</Text>
              {activeIndex > -1 && (
                <Text style={styles.countText} size={12} color={theme['c-font-label']}>
                  {activeIndex + 1} / {totalCount}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={() => panelRef.current?.setVisible(false)} style={styles.closeButton}>
              <Icon name="close" size={14} color={theme['c-font-label']} />
            </TouchableOpacity>
          </View>
          <FlatList
            style={styles.list}
            data={playlist}
            renderItem={renderItem}
            keyExtractor={(item, index) => 'progress' in item ? item.id : item.id + index}
            initialNumToRender={10}
            getItemLayout={getItemLayout}
            // 挂载首帧就定位到当前播放歌曲，避免「先渲染在顶部、再跳到当前项」。
            // clamp 到最后一个下标，防止列表比上次打开更短时越界。
            initialScrollIndex={Math.min(initialIndex, Math.max(0, playlist.length - 1))}
            contentContainerStyle={listContentStyle}
          />
        </View>
      </AnimatedSlideUpPanel>

      <ListMenu
        ref={listMenuRef}
        listId={playerState.playMusicInfo.listId ?? undefined}
        onPlay={() => {}}
        onPlayLater={onPlayLater}
        onAdd={onAdd}
        onDownload={onDownload}
        onDislikeMusic={selectInfo => { void handleDislikeMusic(selectInfo.musicInfo) }}
        onArtistDetail={onArtistDetail}
        onAlbumDetail={onAlbumDetail}
        onSimilarSongs={onSimilarSongs}
        onLike={onLike}
        onPlayMv={onPlayMv}
        onRemove={onRemove}
      />
      <MusicAddModal ref={musicAddModalRef} />
      <SimilarSongsModal ref={similarSongsModalRef} />
    </>
  );
});

const styles = createStyle({
  panelContent: {
    flex: 1,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 15,
  },
  panelTitle: {
    paddingVertical: 15,
    // paddingLeft: 15,
    fontSize: 14,
  },
  countText: {
    marginLeft: 8,
    paddingBottom: 1,
  },
  closeButton: {
    padding: 15,
  },
  list: {
    flex: 1,
  },
});
