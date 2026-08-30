import { forwardRef, useImperativeHandle, useState } from 'react'
import { View, ScrollView } from 'react-native'

import { createStyle } from '@/utils/tools'
import { type Position } from './ListMenu'
import ListItem, { type ListItemProps } from './ListItem'
import { type BoardItem } from '@/store/leaderboard/state'

export interface ListProps {
  // list/activeId 改为受控 props，由父组件（Vertical）统一管理。
  // 原内部 useState 在 DrawerLayoutAndroid 关闭→打开 navigationView 重新挂载时会被
  // 重置回空数组，导致排行榜左侧空白；提升后每次 mount 都有数据。
  list: BoardItem[]
  activeId: string
  onBoundChange: (listId: string) => void
  onShowMenu: (info: { listId: string, name: string, index: number }, position: Position) => void
}
export interface ListType {
  hideMenu: () => void
}

export default forwardRef<ListType, ListProps>(({ list, activeId, onBoundChange, onShowMenu }, ref) => {
  const [longPressIndex, setLongPressIndex] = useState(-1)

  useImperativeHandle(
    ref,
    () => ({
      hideMenu() {
        setLongPressIndex(-1)
      },
    }),
    [],
  )

  const handleBoundChange = (item: BoardItem) => {
    onBoundChange(item.id)
  }

  const handleShowMenu: ListItemProps['onShowMenu'] = (listId, name, index, position: Position) => {
    setLongPressIndex(index)
    onShowMenu({ listId, name, index }, position)
  }

  return (
    <ScrollView style={styles.scrollView} keyboardShouldPersistTaps={'always'}>
      <View>
        {list.map((item, index) => {
          return (
            <ListItem
              key={item.id}
              item={item}
              index={index}
              longPressIndex={longPressIndex}
              activeId={activeId}
              onShowMenu={handleShowMenu}
              onBoundChange={handleBoundChange}
            />
          )
        })}
      </View>
    </ScrollView>
  )
})

const styles = createStyle({
  scrollView: {
    flexShrink: 1,
  },
})
