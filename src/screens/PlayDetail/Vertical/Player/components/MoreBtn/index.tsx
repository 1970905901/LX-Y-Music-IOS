import {createStyle, toast} from '@/utils/tools'
import { View, TouchableOpacity } from 'react-native'
import PlayModeBtn from './PlayModeBtn'
import CommentBtn from './CommentBtn'
import SoundEffectBtn from './SoundEffectBtn'
import {memo, useRef, useCallback, useEffect} from 'react'
import Btn from './Btn'
import { type Position } from '@/screens/Home/Views/Mylist/MusicList/ListMenu'
import PlayDetailMenu, { type PlayDetailMenuType, type SelectInfo } from '@/screens/PlayDetail/components/PlayDetailMenu'
import playerState from '@/store/player/state'
import { handleDislikeMusic, handleClearMusicCache } from '@/screens/Home/Views/Mylist/MusicList/listAction'
import { downloadMusic } from '@/core/download'
import {handleLikeMusic, handleTxLikeMusic, handleKgLikeMusic, handleShowAlbumDetail, handleShowArtistDetail} from '@/components/OnlineList/listAction'
import MusicAddModal, { type MusicAddModalType } from '@/components/MusicAddModal'
import settingState from '@/store/setting/state'
import SimilarSongsModal, { type SimilarSongsModalType } from '@/components/SimilarSongsModal'
import { usePlayMusicInfo } from '@/store/player/hook'


export default memo(({ componentId }: { componentId: string }) => {
  const menuRef = useRef<PlayDetailMenuType>(null);
  const moreBtnRef = useRef<TouchableOpacity>(null);
  const musicAddModalRef = useRef<MusicAddModalType>(null);
  const similarSongsModalRef = useRef<SimilarSongsModalType>(null);
  const playMusicInfo = usePlayMusicInfo();

  useEffect(() => {
    const handleMusicChange = () => {
    };
    global.state_event.on('playerMusicInfoChanged', handleMusicChange);
    global.state_event.on('wyLikedListChanged', handleMusicChange);

    return () => {
      global.state_event.off('playerMusicInfoChanged', handleMusicChange);
      global.state_event.off('wyLikedListChanged', handleMusicChange);
    };
  }, []);

  const handleShowMenu = useCallback(() => {
    const musicInfo = playerState.playMusicInfo.musicInfo;
    if (!musicInfo) return;

    moreBtnRef.current?.measure((fx, fy, width, height, px, py) => {
      const position: Position = {
        x: Math.ceil(px),
        y: Math.ceil(py),
        w: Math.ceil(width),
        h: Math.ceil(height),
      };
      menuRef.current?.show({ musicInfo: 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo }, position);
    });
  }, []);

  const onAdd = (info: SelectInfo) => {
    musicAddModalRef.current?.show({
      musicInfo: info.musicInfo,
      isMove: false,
      listId: playerState.playMusicInfo.listId!,
    });
  };

  const onDownload = (info: SelectInfo) => {
    if (settingState.setting['download.enable']) {
      downloadMusic(info.musicInfo);
    }
  };

  const onArtistDetail = (info: SelectInfo) => {
    if (info.musicInfo.source !== 'local') {
      handleShowArtistDetail(componentId, info.musicInfo);
    }
  };

  const onAlbumDetail = (info: SelectInfo) => {
    if (info.musicInfo.source !== 'local') {
      handleShowAlbumDetail(componentId, info.musicInfo);
    }
  };

  const onSimilarSongs = (info: SelectInfo) => {
    similarSongsModalRef.current?.show(info.musicInfo);
  };

  const onDislikeMusic = (info: SelectInfo) => {
    void handleDislikeMusic(info.musicInfo);
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

  const onClearCache = (info: SelectInfo) => {
    void handleClearMusicCache(info.musicInfo);
  };

  return (
    <>
      <View style={styles.container}>
        <MusicAddBtn />
        <PlayModeBtn />
        <CommentBtn />
        <SoundEffectBtn />
        <Btn icon="dots-vertical" onPress={handleShowMenu} ref={moreBtnRef} />
      </View>

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
    </>
  )
})

const styles = createStyle({
  container: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
})
