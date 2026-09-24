import { forwardRef, useImperativeHandle, useRef, useState, type ReactElement } from 'react'
import type { InitState as SearchState } from '@/store/search/state'
import type { Source as MusicSource } from '@/store/search/music/state'
import type { Source as SongListSource } from '@/store/search/songlist/state'
import MusicList, { type MusicListType } from './MusicList'
import BlankView, { type BlankViewType } from './BlankView'
import SonglistList from './SonglistList'
import SearchResultList from "@/screens/Home/Views/Search/SearchResultList.tsx";

interface ListProps {
  header?: ReactElement
  onSearch: (keyword: string) => void
  onOpenDetail: (item: any) => void;
}
export interface ListType {
  loadList: (
    text: string,
    source: MusicSource | SongListSource,
    type: SearchState['searchType']
  ) => void
}

export default forwardRef<ListType, ListProps>(({ header, onSearch, onOpenDetail }, ref) => {
  const [listType, setListType] = useState<SearchState['searchType']>('music')
  const [showBlankView, setShowListView] = useState(true)
  const [currentSource, setCurrentSource] = useState<MusicSource | SongListSource>('wy')
  const listRef = useRef<MusicListType>(null)
  const blankViewRef = useRef<BlankViewType>(null)

  useImperativeHandle(
    ref,
    () => ({
      loadList(text, source, type) {
        setCurrentSource(source)
        if (text) {
          setShowListView(false)
          setListType(type)
          requestAnimationFrame(() => {
            listRef.current?.loadList(text, source)
          })
        } else {
          setShowListView(true)
          requestAnimationFrame(() => {
            blankViewRef.current?.show(source)
          })
        }
      },
    }),
    []
  )

  const renderList = () => {
    switch (listType) {
      case 'songlist':
        return <SonglistList ref={listRef} header={header} onOpenDetail={onOpenDetail} />
      case 'singer':
        return <SearchResultList ref={listRef} header={header} searchType="singer" source={currentSource} />
      case 'album':
        return <SearchResultList ref={listRef} header={header} searchType="album" source={currentSource} />
      case 'music':
      default:
        return <MusicList ref={listRef} header={header} />
    }
  }

  return showBlankView ? <BlankView ref={blankViewRef} header={header} onSearch={onSearch} /> : renderList()
})
