import { useRef, forwardRef, useImperativeHandle, type ReactElement } from 'react'
import { type ListInfoItem } from '@/store/songlist/state'
import List, { type ListProps, type ListType, type Status } from './List'

export interface SonglistProps {
  header?: ReactElement
  onRefresh: ListProps['onRefresh']
  onLoadMore: ListProps['onLoadMore']
  onOpenDetail: (item: ListInfoItem, index: number) => void
}
export interface SonglistType {
  setList: (list: ListInfoItem[], showSource?: boolean) => void
  setStatus: (val: Status) => void
}

export default forwardRef<SonglistType, SonglistProps>(({ header, onRefresh, onLoadMore, onOpenDetail }, ref) => {
  const listRef = useRef<ListType>(null)

  useImperativeHandle(ref, () => ({
    setList(list, showSource) {
      listRef.current?.setList(list, showSource)
    },
    setStatus(val) {
      listRef.current?.setStatus(val)
    },
  }))

  return (
    <List
      ref={listRef}
      header={header}
      onRefresh={onRefresh}
      onLoadMore={onLoadMore}
      onOpenDetail={onOpenDetail}
    />
  )
})
