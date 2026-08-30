import { forwardRef, useImperativeHandle, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import List, { type ListType, type ListProps } from './List'
import ListMenu, { type ListMenuType, type Position } from './ListMenu'
import { type BoardItem } from '@/store/leaderboard/state'

export interface BoardsListProps {
  // list/activeId 改为受控 props（见 List.tsx 说明）
  list: BoardItem[]
  activeId: string
  onBoundChange: (listId: string) => void
  onPlay: (listId: string) => void
  onCollect: (listId: string, name: string) => void
}
export interface BoardsListType {
  hideMenu: () => void
}

export default forwardRef<BoardsListType, BoardsListProps>(
  ({ list, activeId, onBoundChange, onPlay, onCollect }, ref) => {
    const listRef = useRef<ListType>(null)
    const listMenuRef = useRef<ListMenuType>(null)

    useImperativeHandle(
      ref,
      () => ({
        hideMenu() {
          listRef.current?.hideMenu()
        },
      }),
      [],
    )

    const handleShowMenu: ListProps['onShowMenu'] = (
      { listId, name, index },
      position: Position,
    ) => {
      listMenuRef.current?.show(
        {
          listId,
          index,
          name,
        },
        position,
      )
    }

    return (
      <View style={styles.container}>
        <List
          ref={listRef}
          list={list}
          activeId={activeId}
          onBoundChange={onBoundChange}
          onShowMenu={handleShowMenu}
        />
        <ListMenu
          ref={listMenuRef}
          onHideMenu={() => listRef.current?.hideMenu()}
          onPlay={({ listId }) => {
            onPlay(listId)
          }}
          onCollect={({ listId, name }) => {
            onCollect(listId, name)
          }}
        />
      </View>
    )
  },
)

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    flexShrink: 1,
  },
})
