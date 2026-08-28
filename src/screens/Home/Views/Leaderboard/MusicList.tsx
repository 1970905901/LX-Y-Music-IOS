import {forwardRef, useCallback, useEffect, useImperativeHandle, useRef} from 'react'
import OnlineList, { type OnlineListType, type OnlineListProps } from '@/components/OnlineList'
import {
  clearListDetail,
  getListDetail,
  setListDetail,
  setListDetailInfo,
} from '@/core/leaderboard'
import boardState from '@/store/leaderboard/state'
import { handlePlay } from './listAction'

// export type MusicListProps = Pick<OnlineListProps,
// 'onLoadMore'
// | 'onPlayList'
// | 'onRefresh'
// >

export interface MusicListType {
  loadList: (source: LX.OnlineSource, listId: string) => void
}

export default forwardRef<MusicListType, {}>((props, ref) => {
  const listRef = useRef<OnlineListType>(null)
  const isUnmountedRef = useRef(false)
  const handleListUpdate = useCallback((newList: LX.Music.MusicInfoOnline[]) => {
    if (isUnmountedRef.current) return;
    boardState.listDetailInfo.list = newList;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      async loadList(source, id) {
        const listDetailInfo = boardState.listDetailInfo
        // 切换榜单前先快照缓存列表：setList([]) 会经 onListUpdate 回写
        // boardState.listDetailInfo.list = []，不快照的话：
        // 1) 缓存命中分支永远失效（每次切回都重新请求整页）；
        // 2) 加载更多期间读到空列表会把页码错误地重置回 1，用第 1 页整表替换而非追加。
        const cachedList =
          listDetailInfo.id == id &&
          listDetailInfo.source == source &&
          listDetailInfo.list.length
            ? listDetailInfo.list
            : null
        listRef.current?.setList([])
        if (cachedList) {
          requestAnimationFrame(() => {
            listRef.current?.setList(cachedList)
          })
        } else {
          listRef.current?.setStatus('loading')
          const page = 1
          setListDetailInfo(id)
          return getListDetail(id, page)
            .then((listDetail) => {
              const result = setListDetail(listDetail, id, page)
              if (isUnmountedRef.current) return
              requestAnimationFrame(() => {
                listRef.current?.setList(result.list)
                listRef.current?.setStatus(
                  boardState.listDetailInfo.maxPage <= page ? 'end' : 'idle'
                )
              })
            })
            .catch(() => {
              if (boardState.listDetailInfo.list.length && page == 1) clearListDetail()
              listRef.current?.setStatus('error')
            })
        }
      },
    }),
    []
  )

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  const handlePlayList: OnlineListProps['onPlayList'] = (index) => {
    const listDetailInfo = boardState.listDetailInfo
    // console.log(boardState.listDetailInfo)
    void handlePlay(listDetailInfo.id, listDetailInfo.list, index)
  }
  const handleRefresh: OnlineListProps['onRefresh'] = () => {
    const page = 1
    listRef.current?.setStatus('refreshing')
    getListDetail(boardState.listDetailInfo.id, page, true)
      .then((listDetail) => {
        const result = setListDetail(listDetail, boardState.listDetailInfo.id, page)
        if (isUnmountedRef.current) return
        listRef.current?.setList(result.list)
        listRef.current?.setStatus(boardState.listDetailInfo.maxPage <= page ? 'end' : 'idle')
      })
      .catch(() => {
        if (boardState.listDetailInfo.list.length && page == 1) clearListDetail()
        listRef.current?.setStatus('error')
      })
  }
  const handleLoadMore: OnlineListProps['onLoadMore'] = () => {
    listRef.current?.setStatus('loading')
    const page = boardState.listDetailInfo.list.length ? boardState.listDetailInfo.page + 1 : 1
    getListDetail(boardState.listDetailInfo.id, page)
      .then((listDetail) => {
        const result = setListDetail(listDetail, boardState.listDetailInfo.id, page)
        if (isUnmountedRef.current) return
        listRef.current?.setList(result.list, true)
        listRef.current?.setStatus(boardState.listDetailInfo.maxPage <= page ? 'end' : 'idle')
      })
      .catch(() => {
        if (boardState.listDetailInfo.list.length && page == 1) clearListDetail()
        listRef.current?.setStatus('error')
      })
  }

  return (
    <OnlineList
      ref={listRef}
      onPlayList={handlePlayList}
      onRefresh={handleRefresh}
      onLoadMore={handleLoadMore}
      onListUpdate={handleListUpdate}
      checkHomePagerIdle
      rowType="medium"
    />
  )
})
