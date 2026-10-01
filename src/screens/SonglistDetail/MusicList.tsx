import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import OnlineList, { type OnlineListType, type OnlineListProps } from '@/components/OnlineList'
import { clearListDetail, getListDetail, getListDetailAll, setListDetail, setListDetailInfo } from '@/core/songlist'
import { LIST_LOAD_LIMIT } from '@/store/songlist/action'
import { getSonglistDetailCache, saveSonglistDetailCache, type SonglistDetailCacheInfo } from '@/utils/data/songlistDetail'
import { shouldRefreshByTtl, markRefreshed } from '@/core/refreshThrottle'
import songlistState from '@/store/songlist/state'
import { handlePlay } from './listAction'
import { useListInfo } from './state'
import { type DetailInfo } from '@/screens/SonglistDetail/Header.tsx'
import playerState from '@/store/player/state'
import { LIST_IDS } from '@/config/constant'
import listState from '@/store/list/state'
import { getListMusics } from '@/core/list'
import txUserApi from '@/utils/musicSdk/tx/user'
import { log } from '@/utils/log'
import { decodeName } from '@/utils/index'

export interface MusicListProps {
  componentId: string
  isCreator: boolean
  onListUpdate: OnlineListProps['onListUpdate']
  playingId: string | null
  searchText: string
  isFuzzySearch: boolean
}

export interface MusicListType {
  loadList: (source: LX.OnlineSource, listId: string, isRefresh?: boolean) => Promise<DetailInfo>
  scrollToInfo: (info: LX.Music.MusicInfoOnline) => void
  addSongToList: (rawSong: any) => void
}

export default forwardRef<MusicListType, MusicListProps>(({ componentId, isCreator, playingId, searchText, isFuzzySearch }, ref) => {
  const listRef = useRef<OnlineListType>(null)
  const isUnmountedRef = useRef(false)
  const info = useListInfo()
  const [txIsUserCreated, setTxIsUserCreated] = useState(false)
  const [kgIsUserCreated, setKgIsUserCreated] = useState(false)
  const fullListRef = useRef<LX.Music.MusicInfoOnline[]>([])

  const filterList = useCallback((list: LX.Music.MusicInfoOnline[], keyword: string, fuzzy = false) => {
    if (!keyword.trim()) return list
    const textLower = keyword.trim().toLowerCase()
    if (!fuzzy) {
      // 严格模式：精确子串匹配
      return list.filter(song =>
        song.name?.toLowerCase().includes(textLower) ||
        song.singer?.toLowerCase().includes(textLower) ||
        (song as any).meta?.albumName?.toLowerCase().includes(textLower),
      )
    }
    // 模糊模式：允许字符间有间隔
    const chars = textLower.split('').map(c => c.replace(/[.*+?^${}()|[\]\\]/, '\\$&'))
    const regex = new RegExp(chars.join('.*'), 'i')
    return list.filter(song => {
      const str = `${song.name}${song.singer}${(song as any).meta?.albumName || ''}`
      return regex.test(str)
    })
  }, [])

  useEffect(() => {
    if (fullListRef.current.length > 0) {
      const filtered = searchText.trim() ? filterList(fullListRef.current, searchText, isFuzzySearch) : fullListRef.current
      listRef.current?.setList(filtered)
    }
  }, [searchText, isFuzzySearch, filterList])

  useEffect(() => {
    if (info.source === 'tx') {
      txUserApi.getUserPlaylists().then(playlists => {
        const targetPlaylist = playlists.find((p: any) => String(p.id) === String(info.id))
        if (targetPlaylist && !targetPlaylist.isCollected) {
          setTxIsUserCreated(true)
        } else {
          setTxIsUserCreated(false)
        }
      }).catch(() => {
        setTxIsUserCreated(false)
      })
    } else {
      setTxIsUserCreated(false)
    }
  }, [info.source, info.id])

  useEffect(() => {
    if (info.source === 'kg') {
      setKgIsUserCreated(true)
    } else {
      setKgIsUserCreated(false)
    }
  }, [info.source, info.id])

  const finalIsCreator = info.source === 'tx' ? txIsUserCreated : info.source === 'kg' ? kgIsUserCreated : isCreator

  // 把整张歌单逐页拉全并写入本地缓存（进歌单补全 / 主动更新同步共用）。
  // 每拉一页只刷新已显示的列表，不动滚动位置；拉完写缓存并置 end。
  const syncFullList = useCallback(async(
    source: LX.OnlineSource,
    id: string,
    detailInfo: SonglistDetailCacheInfo,
    isRefresh: boolean,
  ) => {
    let lastTotal = 0
    let finished = false
    // 最近一次累计到的歌曲：**不受组件是否已卸载影响**，供失败/退出时落盘
    let latestSongs: LX.Music.MusicInfoOnline[] = []
    // 缓存写入串行化：单条缓存可能上 MB（storage 走「先删后写」），并发写会互相覆盖
    let saveChain: Promise<void> = Promise.resolve()
    let lastSavedCount = 0
    let lastSaveAt = 0
    const saveCache = async(list: LX.Music.MusicInfoOnline[], complete: boolean) => {
      if (!list.length) return
      saveChain = saveChain
        .then(async() => saveSonglistDetailCache({
          source,
          id,
          name: detailInfo.name ?? '',
          total: lastTotal || list.length,
          complete,
          updatedAt: Date.now(),
          info: detailInfo,
          list,
        }))
        .catch(() => {})
      await saveChain
    }
    try {
      const list = await getListDetailAll(source, id, isRefresh, (songs, total, done) => {
        lastTotal = total || lastTotal
        if (done) finished = true
        latestSongs = songs
        // 进度落盘（每多 30 首或拉完时写一次）：用户常常没等拉全就退出页面，
        // 缓存必须与「组件是否还在屏幕上」解耦 —— 之前这里一旦 isUnmountedRef 为真
        // 就直接 return，连最终写缓存也被跳过，结果什么都没缓存，下次进入又从头拉，
        // 表现就是「歌单缓存没生效」。
        // 省电：进度落盘降到「每多 100 首且距上次落盘 ≥15s」——每条缓存可达 MB 级，
        // 频繁写盘会带来明显的 I/O 与耗电；拉全时无论如何都会写一次最终态。
        if (done || (songs.length - lastSavedCount >= 100 && Date.now() - lastSaveAt >= 15000)) {
          lastSavedCount = songs.length
          lastSaveAt = Date.now()
          void saveCache(songs, done)
        }
        if (isUnmountedRef.current) return
        fullListRef.current = songs
        const filtered = searchText.trim() ? filterList(songs, searchText, isFuzzySearch) : songs
        listRef.current?.setList(filtered)
      })
      // 先落盘，再决定要不要更新界面（组件已卸载时数据仍要缓存下来）
      await saveCache(list, finished)
      if (isUnmountedRef.current) return
      songlistState.listDetailInfo.list = list
      fullListRef.current = list
      const filtered = searchText.trim() ? filterList(list, searchText, isFuzzySearch) : list
      listRef.current?.setList(filtered)
      listRef.current?.setStatus('end')
    } catch (err) {
      log.info('[SonglistDetail] 全量拉取失败', { source, id, error: (err as Error)?.message })
      // 失败保留已加载部分：写一份未完成的缓存，下次进入继续补全而不是从头再来
      const partial = latestSongs.length ? latestSongs : fullListRef.current
      await saveCache(partial, false)
      if (isUnmountedRef.current) return
      listRef.current?.setStatus(partial.length ? 'idle' : 'error')
    }
  }, [filterList, searchText, isFuzzySearch])

  useImperativeHandle(
    ref,
    () => ({
      async loadList(source, id, isRefresh = false) {
        if (global.lx.isEnableLog) console.log('[SonglistDetail] loadList', { source, id, isRefresh })
        // 进入前先留一份内存快照：clearListDetail() 清空的是同一份 store 对象，
        // 原实现「先清空再判断内存命中」，条件恒为 false —— 表现就是每次进歌单都重新拉。
        const prevDetail = {
          id: songlistState.listDetailInfo.id,
          source: songlistState.listDetailInfo.source,
          info: songlistState.listDetailInfo.info,
          list: songlistState.listDetailInfo.list,
          total: songlistState.listDetailInfo.total,
        }
        clearListDetail()
        const listDetailInfo = songlistState.listDetailInfo
        const createDetailInfo = (detail: typeof listDetailInfo.info): DetailInfo => ({
          name: (info.name || detail.name) ?? '',
          desc: detail.desc || info.desc || '',
          playCount: info.play_count ?? detail.play_count ?? '',
          imgUrl: info.img ?? detail.img,
          userId: info.userId || detail.userId,
          total: listDetailInfo.total,
        })

        // 1) 本地整表缓存命中：把缓存的全部歌曲一次铺进列表，完全不请求网络。
        // 之前每次进歌单都从第一页重拉，上千首的歌单永远拉不完，未拉到的部分
        // 既看不到也搜不到（搜索只覆盖已加载数据）。
        if (!isRefresh) {
          const cached = await getSonglistDetailCache(source, id).catch(() => null)
          if (isUnmountedRef.current) return createDetailInfo(cached?.info ?? {})
          if (cached?.list.length) {
            if (global.lx.isEnableLog) log.info('[SonglistDetail] 命中本地缓存', { songCount: cached.list.length, complete: cached.complete })
            setListDetailInfo(source, id)
            setListDetail({
              list: cached.list,
              total: cached.total || cached.list.length,
              page: 1,
              limit: LIST_LOAD_LIMIT,
              maxPage: 1,
              key: null,
              source,
              info: cached.info,
              id,
            }, id, 1)
            const cachedFiltered = searchText.trim() ? filterList(cached.list, searchText, isFuzzySearch) : cached.list
            requestAnimationFrame(() => {
              fullListRef.current = cached.list
              listRef.current?.setList(cachedFiltered)
              // 未拉全的缓存继续在后台补全：状态保持 loading，避免用户滚动触发的
              // loadMore 与后台补全并发写列表（会重复/丢歌）
              listRef.current?.setStatus(cached.complete ? 'end' : 'loading')
            })
            if (!cached.complete) void syncFullList(source, id, cached.info, false)
            else if (shouldRefreshByTtl(`songs|${source}|${id}`)) {
              // 冷启动后首次点开必刷新；之后满 1 小时才再刷（core/refreshThrottle）
              void syncFullList(source, id, cached.info, true)
            }
            return createDetailInfo(cached.info)
          }
        }

        // 2) 同一歌单本次运行内已加载过的数据：直接复用，不闪加载态
        if (!isRefresh && prevDetail.id === id && prevDetail.source === source && prevDetail.list.length) {
          setListDetailInfo(source, id)
          setListDetail({
            list: prevDetail.list,
            total: prevDetail.total || prevDetail.list.length,
            page: 1,
            limit: LIST_LOAD_LIMIT,
            maxPage: 1,
            key: null,
            source,
            info: prevDetail.info,
            id,
          }, id, 1)
          const prevFiltered = searchText.trim() ? filterList(prevDetail.list, searchText, isFuzzySearch) : prevDetail.list
          requestAnimationFrame(() => {
            fullListRef.current = prevDetail.list
            listRef.current?.setList(prevFiltered)
            listRef.current?.setStatus('end')
          })
          return createDetailInfo(prevDetail.info)
        }

        if (
          listDetailInfo.id === id &&
          listDetailInfo.source === source &&
          listDetailInfo.list.length
        ) {
          if (global.lx.isEnableLog) log.info('[SonglistDetail] loadList cache hit', { listCount: listDetailInfo.list.length })
          requestAnimationFrame(() => {
            fullListRef.current = listDetailInfo.list
            listRef.current?.setList(listDetailInfo.list)
          })
          return Promise.resolve(createDetailInfo(listDetailInfo.info))
        }

        listRef.current?.setStatus('loading')
        const page = 1
        setListDetailInfo(info.source, info.id)
        if (global.lx.isEnableLog) log.info('[SonglistDetail] loadList start', { source, id, page, isRefresh })
        return getListDetail(id, source, page, isRefresh)
          .then((listDetail) => {
            if (global.lx.isEnableLog) log.info('[SonglistDetail] loadList got data', { songCount: listDetail.list.length, total: listDetail.total })
            const result = setListDetail(listDetail, id, page)
            if (isUnmountedRef.current) return createDetailInfo(result.info)
            const filtered = searchText.trim() ? filterList(result.list, searchText, isFuzzySearch) : result.list
            requestAnimationFrame(() => {
              fullListRef.current = result.list
              listRef.current?.setList(filtered)
              // 首屏已出：剩余页在后台补全并写入本地缓存，状态保持 loading，
              // 由 syncFullList 结束时统一置 end（下次进入直接读缓存整表铺开）
              listRef.current?.setStatus('loading')
            })
            void syncFullList(source, id, result.info as SonglistDetailCacheInfo, false)
            markRefreshed(`songs|${source}|${id}`)
            return createDetailInfo(result.info)
          })
          .catch((err) => {
            if (global.lx.isEnableLog) log.info('[SonglistDetail] loadList error', { error: err?.message })
            if (songlistState.listDetailInfo.list.length && page === 1) clearListDetail()
            listRef.current?.setStatus('error')
            throw err
          })
      },
      scrollToInfo(targetInfo) {
        const currentList = songlistState.listDetailInfo.list
        if (currentList.some(s => s.id === targetInfo.id)) {
          listRef.current?.scrollToInfo(targetInfo)
          return
        }

        const currentListId = `${songlistState.listDetailInfo.source}__${songlistState.listDetailInfo.id}`
        let playingListId = playerState.playMusicInfo.listId
        if (playingListId === LIST_IDS.TEMP) playingListId = listState.tempListMeta.id

        if (playingListId === currentListId) {
          void getListMusics(LIST_IDS.TEMP).then(fullList => {
            const castedList = fullList as LX.Music.MusicInfoOnline[]
            if (castedList.some(s => s.id === targetInfo.id)) {
              songlistState.listDetailInfo.list = castedList
              fullListRef.current = castedList
              const filtered = filterList(castedList, searchText)
              listRef.current?.setList(filtered)
              setTimeout(() => {
                listRef.current?.scrollToInfo(targetInfo)
              }, 200)
            }
          })
        }
      },
      addSongToList(rawSong: any) {
        const song: LX.Music.MusicInfoOnline = {
          id: `kg__${rawSong.hash || rawSong.audio_id}`,
          name: decodeName(rawSong.name || rawSong.songname || '').replace(/\.mp3$/i, ''),
          singer: decodeName(rawSong.singerinfo?.map((s: any) => s.name).join('、') || rawSong.singername || ''),
          albumName: decodeName(rawSong.album_name || ''),
          albumId: String(rawSong.album_id || ''),
          songmid: String(rawSong.audio_id || rawSong.hash || ''),
          source: 'kg',
          interval: rawSong.duration ? rawSong.duration + 's' : '',
          img: rawSong.cover ? rawSong.cover.replace('{size}', '400') : '',
          hash: rawSong.hash || '',
          mixsongid: rawSong.mixsongid || 0,
          fileId: rawSong.fileid || 0,
        } as any
        const currentList = [...songlistState.listDetailInfo.list]
        if (!currentList.some(s => s.id === song.id)) {
          currentList.push(song)
          songlistState.listDetailInfo.list = currentList
          songlistState.listDetailInfo.total = currentList.length
          fullListRef.current = currentList
          const filtered = filterList(currentList, searchText)
          listRef.current?.setList(filtered)
          log.info(`[乐观更新] 已添加歌曲到列表: ${song.name}, 当前共 ${currentList.length} 首`)
        }
      },
    }),
    [filterList, syncFullList, isFuzzySearch, info.desc, info.img, info.name, info.play_count, info.source, info.id, info.userId, searchText],
  )

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  const handlePlayList: OnlineListProps['onPlayList'] = (index) => {
    const listDetailInfo = songlistState.listDetailInfo
    void handlePlay(listDetailInfo.id, listDetailInfo.source, listDetailInfo.list, index)
  }

  const handleRefresh: OnlineListProps['onRefresh'] = () => {
    const { id, source, info: detailInfo } = songlistState.listDetailInfo
    if (!id) return
    listRef.current?.setStatus('refreshing')
    // 下拉刷新 = 只刷新当前这张歌单：清掉内存分页缓存后逐页重拉全量并覆盖本地缓存
    void syncFullList(source, id, detailInfo as SonglistDetailCacheInfo, true)
  }

  const handleLoadMore: OnlineListProps['onLoadMore'] = () => {
    listRef.current?.setStatus('loading')
    const page = songlistState.listDetailInfo.list.length
      ? songlistState.listDetailInfo.page + 1
      : 1
    getListDetail(songlistState.listDetailInfo.id, songlistState.listDetailInfo.source, page)
      .then((listDetail) => {
        const result = setListDetail(listDetail, songlistState.listDetailInfo.id, page)
        if (isUnmountedRef.current) return
        // 追加新数据并按 ID 去重
        const existingIds = new Set(fullListRef.current.map(m => m.id))
        const newSongs = result.list.filter(m => !existingIds.has(m.id))
        fullListRef.current = [...fullListRef.current, ...newSongs]
        // 同步更新列表显示
        const filtered = searchText.trim() ? filterList(fullListRef.current, searchText) : fullListRef.current
        listRef.current?.setList(filtered)
        listRef.current?.setStatus(songlistState.listDetailInfo.maxPage <= page ? 'end' : 'idle')
      })
      .catch(() => {
        if (songlistState.listDetailInfo.list.length && page == 1) clearListDetail()
        listRef.current?.setStatus('error')
      })
  }

  const handleListUpdate = useCallback((newList: LX.Music.MusicInfoOnline[]) => {
    if (isUnmountedRef.current) return
    songlistState.listDetailInfo.list = newList
  }, [])

  return (
    <OnlineList componentId={componentId}
                ref={listRef}
                onPlayList={handlePlayList}
                onRefresh={handleRefresh}
                onLoadMore={handleLoadMore}
                onListUpdate={handleListUpdate}
                forcePlayList={true}
                listId={`${info.source}__${info.id}`}
                isCreator={finalIsCreator}
                playingId={playingId}
    />
  )
})
