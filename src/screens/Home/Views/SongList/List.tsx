import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactElement } from 'react'
import Songlist, { type SonglistProps, type SonglistType } from './components/Songlist'
import { clearList, getList, setList, setListInfo } from '@/core/songlist'
import { shouldRefreshByTtl } from '@/core/refreshThrottle'
import songlistState, { type ListInfoItem, type Source } from '@/store/songlist/state'


export interface ListType {
  loadList: (source: Source, sortId: string, tagId: string) => void
  onOpenDetail: (item: ListInfoItem) => void
}

export default forwardRef<ListType, { header?: ReactElement, onOpenDetail: (item: ListInfoItem) => void }>(({ header, onOpenDetail }, ref) => {
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
        // 刷新时机：冷启动后首次进入/点击必刷，之后满 1 小时才再刷（core/refreshThrottle）
        const forceRefresh = shouldRefreshByTtl(`square|songlist|${source}|${sortId}|${tagId}`)
        // 歌单页列表不缓存：进入本页 / 点击顶部平台与分组按钮，都重新联网刷新第一页。
        // 已有内容时只替换列表、不切 loading；歌单里的歌曲由 SonglistDetail 负责。
        const refreshNow = () => {
          void getList(source, tagId, sortId, 1, true)
            .then((info) => {
              if (isUnmountedRef.current) return
              const result = setList(info, tagId, sortId, 1)
              applyListResult(result, 1, loadIdRef.current)
            })
            .catch(() => {})
        }
        const listInfo = songlistState.listInfo
        if (
          !forceRefresh &&
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
          refreshNow()
          return
        }

        listRef.current?.setList([])
        if (currentLoadId !== loadIdRef.current) return
        listRef.current?.setStatus('loading')
        setListInfo(source, tagId, sortId)
        const page = 1
        // 首屏取数直接强制联网（缓存为空时不缓存），避免「先取一次再补刷一次」的重复请求
        return getList(source, tagId, sortId, page, page === 1 && forceRefresh)
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
    [onOpenDetail],
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
      true,
    )
      .then((info) => {
        if (currentLoadId !== loadIdRef.current || isUnmountedRef.current) return
        const result = setList(
          info,
          songlistState.listInfo.tagId,
          songlistState.listInfo.sortId,
          page,
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
      page,
    )
      .then((info) => {
        if (currentLoadId !== loadIdRef.current || isUnmountedRef.current) return
        const result = setList(
          info,
          songlistState.listInfo.tagId,
          songlistState.listInfo.sortId,
          page,
        )
        applyListResult(result, page, currentLoadId)
      })
      .catch(() => {
        if (currentLoadId !== loadIdRef.current || isUnmountedRef.current) return
        if (songlistState.listInfo.list.length && page == 1) clearList()
        listRef.current?.setStatus('error')
      })
  }

  return <Songlist ref={listRef} header={header} onRefresh={handleRefresh} onLoadMore={handleLoadMore} onOpenDetail={onOpenDetail} />
})
