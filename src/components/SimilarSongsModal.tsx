import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { View } from 'react-native'

import Popup, { type PopupType } from '@/components/common/Popup'
import OnlineList, { type OnlineListType } from '@/components/OnlineList'
import { playOnlineList } from '@/core/list'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { createStyle, toast } from '@/utils/tools'
import wyApi from '@/utils/musicSdk/wy'
import txApi from '@/utils/musicSdk/tx'
import musicDetailApi from '@/utils/musicSdk/wy/musicDetail'

const LIST_ID = 'similar_songs_list'
const PAGE_SIZE = 30

export interface SimilarSongsModalType {
  show: (musicInfo: LX.Music.MusicInfo) => void
}

export default forwardRef<SimilarSongsModalType, {}>((props, ref) => {
  const popupRef = useRef<PopupType>(null)
  const listRef = useRef<OnlineListType>(null)
  const currentMusicInfoRef = useRef<LX.Music.MusicInfoOnline | null>(null)
  const currentListRef = useRef<LX.Music.MusicInfoOnline[]>([])
  const offsetRef = useRef(0)
  const hasMoreRef = useRef(true)
  const loadingRef = useRef(false)
  const requestIdRef = useRef(0)
  const [visible, setVisible] = useState(false)
  const [title, setTitle] = useState('相似歌曲')
  const playerMusicInfo = usePlayerMusicInfo()

  const loadData = useCallback(async(isAppend = false) => {
    const musicInfo = currentMusicInfoRef.current
    if (!musicInfo || loadingRef.current) return
    if (isAppend && !hasMoreRef.current) return

    loadingRef.current = true
    const requestId = ++requestIdRef.current
    listRef.current?.setStatus(isAppend ? 'loading' : 'loading')

    try {
      let detailList: LX.Music.MusicInfoOnline[] = []

      if (musicInfo.source === 'wy') {
        const rawList = await wyApi.dailyRec.getSimilarSongs(
          musicInfo.meta.songId,
          PAGE_SIZE,
          isAppend ? offsetRef.current : 0
        )
        detailList = await musicDetailApi.filterList({ songs: rawList ?? [], privileges: [] })
      } else if (musicInfo.source === 'tx') {
        detailList = await txApi.dailyRec.getSimilarSongs(
          musicInfo.meta.id,
          PAGE_SIZE
        )
      }

      if (requestId !== requestIdRef.current) return

      const existsIds = new Set(
        (isAppend ? currentListRef.current : [musicInfo]).map(item => item.id)
      )
      const nextList = detailList.filter(item => {
        if (existsIds.has(item.id)) return false
        existsIds.add(item.id)
        return true
      })
      const list = isAppend ? [...currentListRef.current, ...nextList] : nextList

      currentListRef.current = list
      offsetRef.current = isAppend ? offsetRef.current + PAGE_SIZE : PAGE_SIZE
      hasMoreRef.current = (detailList?.length ?? 0) >= PAGE_SIZE && nextList.length > 0

      listRef.current?.setList(list, isAppend)
      listRef.current?.setStatus(hasMoreRef.current ? 'idle' : 'end')

      if (!isAppend && !list.length) toast('没有找到相似歌曲')
    } catch (err: any) {
      if (requestId !== requestIdRef.current) return
      listRef.current?.setStatus('error')
      toast(err?.message || '获取相似歌曲失败')
    } finally {
      if (requestId === requestIdRef.current) loadingRef.current = false
    }
  }, [])

  useImperativeHandle(ref, () => ({
    show(musicInfo) {
      if (musicInfo.source !== 'wy' && musicInfo.source !== 'tx') {
        toast('该源歌曲无法查看相似歌曲')
        return
      }

      currentMusicInfoRef.current = musicInfo as LX.Music.MusicInfoOnline
      currentListRef.current = []
      offsetRef.current = 0
      hasMoreRef.current = true
      loadingRef.current = false
      requestIdRef.current += 1
      setTitle(`相似歌曲 - ${musicInfo.name}`)

      const open = () => {
        popupRef.current?.setVisible(true)
        listRef.current?.setList([], false)
        void loadData(false)
      }

      if (visible) {
        open()
      } else {
        setVisible(true)
        requestAnimationFrame(open)
      }
    },
  }))

  const handleRefresh = useCallback(() => {
    offsetRef.current = 0
    hasMoreRef.current = true
    void loadData(false)
  }, [loadData])

  const handleLoadMore = useCallback(() => {
    void loadData(true)
  }, [loadData])

  const handlePlayList = useCallback((index: number) => {
    if (!currentListRef.current.length) return
    void playOnlineList(LIST_ID, currentListRef.current, index)
  }, [])

  const handleHide = useCallback(() => {
    requestIdRef.current += 1
    loadingRef.current = false
    setVisible(false)
  }, [])

  return visible ? (
    <Popup ref={popupRef} title={title} position="bottom" onHide={handleHide}>
      <View style={styles.content}>
        <OnlineList
          ref={listRef}
          listId={LIST_ID}
          forcePlayList
          playingId={playerMusicInfo.id}
          onPlayList={handlePlayList}
          onRefresh={handleRefresh}
          onLoadMore={handleLoadMore}
          rowType="single"
        />
      </View>
    </Popup>
  ) : null
})

const styles = createStyle({
  content: {
    width: '100%',
    height: 520,
    maxHeight: '100%',
  },
})
