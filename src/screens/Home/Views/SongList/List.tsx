import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Songlist, { type SonglistProps, type SonglistType } from './components/Songlist'
import { clearList, getList, setList, setListInfo } from '@/core/songlist'
import songlistState, {ListInfoItem} from '@/store/songlist/state'
import { type Source } from '@/store/songlist/state'

export interface ListType {
  loadList: (source: Source, sortId: string, tagId: string) => void
  onOpenDetail: (item: ListInfoItem) => void;
}

export default forwardRef<ListType, { onOpenDetail: (item: ListInfoItem) => void }>(({ onOpenDetail }, ref) => {
  const listRef = useRef<SonglistType>(null)
  const isUnmountedRef = useRef(false)
  const loadIdRef = useRef(0)

  const applyListResult = (result: typeof songlistState.listInfo, page: number, currentLoadId: number) => {
    if (currentLoadId !== loadIdRef.current || isUnmountedRef.current) return
    if (!result.list.length) {
      listRef.current?.setList([])
      listRef.current?.setStatus('empty')
      return
    }
    listRef.current?.setList(result.list)
    listRef.current?.setStatus(songlistState.listInfo.maxPage <= page ? 'end' : 'idle')
  }

  useImperativeHandle(
    ref,
    () => ({
      onOpenDetail,
      async loadList(source, sortId, tagId) {
        const currentLoadId = ++loadIdRef.current
        const listInfo = songlistState.listInfo
        if (
          listInfo.tagId == tagId &&
          listInfo.sortId == sortId &&
          listInfo.source == source &&
          listInfo.list.length
        ) {
          requestAnimationFrame(() => {
            if (currentLoadId !== loadIdRef.current || isUnmountedRef.current) return
            listRef.current?.setList(listInfo.list)
            listRef.current?.setStatus(songlistState.listInfo.maxPage <= 1 ? 'end' : 'idle')
          })
          return
        }

        listRef.current?.setList([])
        if (currentLoadId !== loadIdRef.current) return
        listRef.current?.setStatus('loading')
        setListInfo(source, tagId, sortId)
        const page = 1
        return getList(source, tagId, sortId, page)
          .then((info) => {
            if (currentLoadId !== loadIdRef.current || isUnmountedRef.current) return
            const result = setList(info, tagId, sortId, page)
            applyListResult(result, page, currentLoadId)
          })
          .catch(() => {
            if (currentLoadId !== loadIdRef.current || isUnmountedRef.current) return
            if (songlistState.listInfo.list.length && page == 1) clearList()
            listRef.current?.setStatus('error')
          })
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

  const handleRefresh: SonglistProps['onRefresh'] = () => {
    const currentLoadId = ++loadIdRef.current
    const page = 1
    listRef.current?.setStatus('refreshing')
    getList(
      songlistState.listInfo.source,
      songlistState.listInfo.tagId,
      songlistState.listInfo.sortId,
      page,
      true
    )
      .then((info) => {
        if (currentLoadId !== loadIdRef.current || isUnmountedRef.current) return
        const result = setList(
          info,
          songlistState.listInfo.tagId,
          songlistState.listInfo.sortId,
          page
        )
        applyListResult(result, page, currentLoadId)
      })
      .catch(() => {
        if (currentLoadId !== loadIdRef.current || isUnmountedRef.current) return
        if (songlistState.listInfo.list.length && page == 1) clearList()
        listRef.current?.setStatus('error')
      })
  }
  const handleLoadMore: SonglistProps['onLoadMore'] = () => {
    const currentLoadId = ++loadIdRef.current
    listRef.current?.setStatus('loading')
    const page = songlistState.listInfo.list.length ? songlistState.listInfo.page + 1 : 1
    getList(
      songlistState.listInfo.source,
      songlistState.listInfo.tagId,
      songlistState.listInfo.sortId,
      page
    )
      .then((info) => {
        if (currentLoadId !== loadIdRef.current || isUnmountedRef.current) return
        const result = setList(
          info,
          songlistState.listInfo.tagId,
          songlistState.listInfo.sortId,
          page
        )
        applyListResult(result, page, currentLoadId)
      })
      .catch(() => {
        if (currentLoadId !== loadIdRef.current || isUnmountedRef.current) return
        if (songlistState.listInfo.list.length && page == 1) clearList()
        listRef.current?.setStatus('error')
      })
  }

  return <Songlist ref={listRef} onRefresh={handleRefresh} onLoadMore={handleLoadMore} onOpenDetail={onOpenDetail} />
})
