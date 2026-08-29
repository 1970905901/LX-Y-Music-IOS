import { memo, useEffect, useRef, useState, useCallback } from 'react';
import { View } from 'react-native';
import PageContent from '@/components/PageContent';
import Header from './Header';
import SongList from './SongList';
import wyApi from '@/utils/musicSdk/wy/artist';
import txApi from '@/utils/musicSdk/tx/artist';
import kgApi from '@/utils/musicSdk/kg/artist';
import { toast } from '@/utils/tools';
import {setComponentId, updateSetting} from '@/core/common';
import PlayerBar from '@/components/player/PlayerBar';
import LandscapeDetailLayout from '@/components/LandscapeDetailLayout';
import { getArtistCache, setArtistCache,
  clearArtistCache, getArtistDetailCache, setArtistDetailCache } from '@/core/cache';
import {useSettingValue} from "@/store/setting/hook.ts";
import playerState from '@/store/player/state'
import listState from '@/store/list/state'
import { LIST_IDS } from '@/config/constant'
import { type OnlineListType } from '@/components/OnlineList'
import {usePlayerMusicInfo} from "@/store/player/hook.ts";
import { log } from '@/utils/log'

const SONG_LIMIT = 100;
const ALBUM_LIMIT = 100;

const getApi = (source?: string) => {
  if (source === 'tx') return txApi
  if (source === 'kg') return kgApi
  return wyApi
}

const getArtistParam = (artistInfo: { id: string; mid?: string; source?: string }) => {
  if (artistInfo.source === 'tx') return artistInfo.mid || artistInfo.id
  if (artistInfo.source === 'kg') return artistInfo.id
  return artistInfo.id
}

export default memo(({ componentId, artistInfo }: { componentId: string, artistInfo: { id: string, mid?: string, name: string, source?: string } }) => {
  const [artistDetail, setArtistDetail] = useState<{ artist: any } | null>(null);
  const [songs, setSongs] = useState<{ list: LX.Music.MusicInfoOnline[]; hasMore: boolean; page: number; loading: boolean; sort: string }>({ list: [], hasMore: true, page: 1, loading: false, sort: 'hot' });
  const [albums, setAlbums] = useState({ list: [], hasMore: true, page: 1, loading: false });
  const [activeTab, setActiveTab] = useState<'songs' | 'albums'>('songs');
  const albumViewMode = useSettingValue('artistDetail.albumViewMode')
  const componentIdRef = useRef(componentId)
  const songListRef = useRef<any>(null)
  const songsLoadingRef = useRef(false)
  const songsRequestIdRef = useRef(0)
  const pendingScrollInfoRef = useRef<LX.Music.MusicInfoOnline | null>(null)
  const isFirstSortEffect = useRef(true)
  const playerMusicInfo = usePlayerMusicInfo()

  const handleSongListUpdate = useCallback((newList: LX.Music.MusicInfoOnline[]) => {
    setSongs(prev => ({
      ...prev,
      list: newList,
    }))
  }, [])



  useEffect(() => {
    const handleJumpPosition = () => {
      let listId = playerState.playMusicInfo.listId
      if (listId === LIST_IDS.TEMP) listId = listState.tempListMeta.id
      if (listId !== `artist_detail_${artistInfo.id}`) return

      const musicInfo = playerState.playMusicInfo.musicInfo as LX.Music.MusicInfoOnline
      if (musicInfo) {
        if (songs.list.length) {
          songListRef.current?.scrollToInfo(musicInfo)
        } else {
          pendingScrollInfoRef.current = musicInfo
        }
      }
    }

    global.app_event.on('jumpListPosition', handleJumpPosition as () => Promise<void>)
    return () => {
      global.app_event.off('jumpListPosition', handleJumpPosition as () => Promise<void>)
    }
  }, [artistInfo.id, songs.list])
  useEffect(() => {
    if (pendingScrollInfoRef.current && songs.list.length) {
      setTimeout(() => {
        if (songListRef.current) {
          songListRef.current.scrollToInfo(pendingScrollInfoRef.current);
          pendingScrollInfoRef.current = null;
        }
      }, 300);
    };
  }, [songs.list])

  useEffect(() => {
    setComponentId('ARTIST_DETAIL' as any, componentId);
    componentIdRef.current = componentId;
    const api = getApi(artistInfo.source)
    const artistParam = getArtistParam(artistInfo)

    log.info('[ArtistDetail] === 开始获取歌手详情 ===', {
      artistId: artistInfo.id,
      artistMid: artistInfo.mid,
      artistParam,
      artistName: artistInfo.name,
      artistSource: artistInfo.source,
      api: artistInfo.source,
    })

    const cachedDetail = getArtistDetailCache(artistParam);
    if (cachedDetail) {
      setArtistDetail(cachedDetail);
    } else {
      log.info('[ArtistDetail] === 从API获取歌手详情 ===', {
        artistId: artistInfo.id,
        artistParam,
        cached: false,
        api: artistInfo.source === 'tx' ? 'txApi' : 'wyApi',
      })
      api.getDetail(artistParam).then((data: any) => {
        setArtistDetailCache(artistInfo.id, data);
        setArtistDetail(data);
      }).catch((err: any) => {
        toast('获取歌手信息失败');
      });
    }
  }, [componentId, artistInfo.id, artistInfo.source]);

  const loadSongs = useCallback((sort: string, page: number, isRefresh = false) => {
    // FlatList 的 onEndReached 在 iOS 上可能连续触发多次。用 ref 做同步锁，
    // 不能只依赖 React state（同一帧内连续回调看到的 loading 仍可能是 false），
    // 否则多个分页请求会并发返回并互相覆盖歌曲列表。
    if (songsLoadingRef.current && !isRefresh) return
    const requestId = ++songsRequestIdRef.current
    songsLoadingRef.current = true

    const currentApi = getApi(artistInfo.source)
    const currentArtistParam = getArtistParam(artistInfo)
    // v2 绕过上一版错误分页逻辑留下的 hasMore=false 旧缓存，避免修复后仍只显示第一页。
    const cacheKey = `${currentArtistParam}_songs_v2_${sort}_${page}`
    const offset = (page - 1) * SONG_LIMIT

    setSongs(prev => ({
      ...prev,
      ...(isRefresh || page === 1 ? { list: [], hasMore: true, page: 1 } : {}),
      loading: true,
      sort,
    }))

    const applyResult = (data: any) => {
      // 排序/刷新触发新请求后，旧请求结果不得覆盖新列表。
      if (requestId !== songsRequestIdRef.current) return
      const nextList = Array.isArray(data?.list) ? data.list : []
      const hasMore = Boolean(data?.hasMore)
      setSongs(prev => ({
        ...prev,
        list: page === 1 || isRefresh ? nextList : [...prev.list, ...nextList],
        hasMore,
        page: page + 1,
        loading: false,
        sort,
      }))
      songsLoadingRef.current = false
    }

    const applyError = () => {
      if (requestId !== songsRequestIdRef.current) return
      toast('获取歌曲失败')
      setSongs(prev => ({ ...prev, loading: false }))
      songsLoadingRef.current = false
    }

    const cachedData = getArtistCache(cacheKey)
    if (!isRefresh && cachedData) {
      applyResult(cachedData)
      return
    }

    currentApi.getSongs(currentArtistParam, sort, SONG_LIMIT, offset)
      .then((data: any) => {
        if (requestId !== songsRequestIdRef.current) return
        setArtistCache(cacheKey, {
          list: Array.isArray(data?.list) ? data.list : [],
          hasMore: Boolean(data?.hasMore),
        })
        applyResult(data)
      })
      .catch(applyError)
  }, [artistInfo.id, artistInfo.source])

  const loadAlbums = useCallback((page: number, isRefresh = false) => {
    const currentApi = getApi(artistInfo.source)
    const currentArtistParam = getArtistParam(artistInfo)

    log.info('[ArtistDetail] === loadAlbums 被调用 ===', {
      artistId: artistInfo.id,
      artistMid: artistInfo.mid,
      artistParam: currentArtistParam,
      artistSource: artistInfo.source,
      page,
      isRefresh,
      timestamp: new Date().toISOString(),
    })
    const cacheKey = `${currentArtistParam}_albums_${page}`;

    const cachedData = getArtistCache(cacheKey);
    if (!isRefresh && cachedData) {
      log.info('[ArtistDetail] === 使用缓存的专辑列表 ===', {
        artistId: artistInfo.id,
        artistParam: currentArtistParam,
        cacheKey,
        albumCount: cachedData.hotAlbums.length,
        hasMore: cachedData.hasMore,
      })
      setAlbums(p => ({
        ...p,
        list: page === 1 ? cachedData.hotAlbums : [...p.list, ...cachedData.hotAlbums],
        hasMore: cachedData.hasMore,
        page: page + 1,
        loading: false,
      }));
      return;
    }

    setAlbums(prev => {
      if (!isRefresh && (prev.loading || !prev.hasMore)) {
        log.info('[ArtistDetail] === 跳过专辑加载 ===', {
          reason: prev.loading ? '正在加载' : '没有更多数据',
          loading: prev.loading,
          hasMore: prev.hasMore,
        })
        return prev;
      }
      const offset = (page - 1) * ALBUM_LIMIT;
      log.info('[ArtistDetail] === 请求歌手专辑列表 ===', {
        artistId: artistInfo.id,
        artistParam: currentArtistParam,
        artistSource: artistInfo.source,
        page,
        offset,
        limit: ALBUM_LIMIT,
      })
      currentApi.getAlbums(currentArtistParam, ALBUM_LIMIT, offset).then((data: any) => {
        log.info('[ArtistDetail] 歌手专辑加载成功', { artistId: artistInfo.id, albumCount: data.hotAlbums.length, hasMore: data.hasMore })
        setArtistCache(cacheKey, { hotAlbums: data.hotAlbums, hasMore: data.hasMore });

        setAlbums(p => ({
          ...p,
          list: page === 1 ? data.hotAlbums : [...p.list, ...data.hotAlbums],
          hasMore: data.hasMore,
          page: page + 1,
          loading: false,
        }));
      }).catch((err: any) => {
        log.error('[ArtistDetail] 歌手专辑加载失败', { artistId: artistInfo.id, error: err.message })
        toast('获取专辑失败');
        setAlbums(p => ({ ...p, loading: false }));
      });
      return { ...prev, loading: true };
    });
  }, [artistInfo.id, artistInfo.source]);


  useEffect(() => {
    if (activeTab === 'songs') {
      if (songs.list.length === 0) loadSongs(songs.sort, 1, false);
    } else {
      if (albums.list.length === 0) loadAlbums(1, false);
    }
  }, [activeTab, artistInfo.id]);

  useEffect(() => {
    if (isFirstSortEffect.current) {
      isFirstSortEffect.current = false;
      return;
    }
    setSongs(prev => ({ ...prev, page: 1, list: [], hasMore: true }));
    loadSongs(songs.sort, 1, true);
  }, [songs.sort]);

  const handleLoadMoreSongs = () => {
    loadSongs(songs.sort, songs.page);
  };

  const handleLoadMoreAlbums = () => {
    loadAlbums(albums.page);
  };

  const handleSortChange = (newSort: string) => {
    if (songs.sort === newSort) return;
    const cacheKeyParam = artistInfo.source === 'tx' ? (artistInfo.mid || artistInfo.id) : artistInfo.id
    clearArtistCache(cacheKeyParam);
    setSongs(prev => ({ ...prev, sort: newSort, list: [], page: 1, hasMore: true }));
  };

  const handleTabChange = (newTab: 'songs' | 'albums') => {
    if (activeTab === newTab) return;
    setActiveTab(newTab);
  };

  const handleRefresh = useCallback(() => {
    const refreshApi = getApi(artistInfo.source)
    const refreshParam = getArtistParam(artistInfo)

    clearArtistCache(refreshParam);

    refreshApi.getDetail(refreshParam).then((data: any) => {
      setArtistDetailCache(refreshParam, data);
      setArtistDetail(data);
    }).catch(() => toast('刷新歌手信息失败'));

    if (activeTab === 'songs') {
      setSongs(prev => ({ ...prev, page: 1, list: [], hasMore: true }));
      loadSongs(songs.sort, 1, true);
    } else {
      setAlbums(prev => ({ ...prev, page: 1, list: [], hasMore: true }));
      loadAlbums(1, true);
    }
  }, [artistInfo.id, songs.sort, loadSongs, activeTab, loadAlbums]);


  const handleAlbumViewModeChange = useCallback((mode: 'grid' | 'list') => {
    updateSetting({ 'artistDetail.albumViewMode': mode })
  }, [])

  const apiHasPic = artistDetail?.artist && (artistDetail.artist.avatar || artistDetail.artist.cover || artistDetail.artist.picUrl || artistDetail.artist.singerPic)
  const displayArtist = apiHasPic ? artistDetail.artist : artistInfo

  return (
    <PageContent>
      <LandscapeDetailLayout
        header={<Header artist={displayArtist} componentId={componentIdRef.current} />}
        body={
          <SongList
            componentId={componentId}
            songs={songs}
            albums={albums}
            activeTab={activeTab}
            ref={songListRef as any}
            artistId={artistInfo.id}
            albumViewMode={albumViewMode}
            onTabChange={handleTabChange}
            onLoadMoreSongs={handleLoadMoreSongs}
            onLoadMoreAlbums={handleLoadMoreAlbums}
            onSortChange={handleSortChange}
            onRefresh={handleRefresh}
            onAlbumViewModeChange={handleAlbumViewModeChange}
            onSongListUpdate={handleSongListUpdate}
            playingId={playerMusicInfo.id}
          />
        }
        footer={<PlayerBar />}
      />
    </PageContent>
  );
