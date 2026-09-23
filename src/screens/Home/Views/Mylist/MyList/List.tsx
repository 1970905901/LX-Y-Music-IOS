import { memo, useEffect, useRef } from 'react'
import {
  View,
  TouchableOpacity,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type FlatListProps,
} from 'react-native'

import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { useActiveListId, useListFetching, useMyList } from '@/store/list/hook'
import { createStyle } from '@/utils/tools'
import { LIST_SCROLL_POSITION_KEY } from '@/config/constant'
import { getListPosition, saveListPosition } from '@/utils/data'
import { setActiveList } from '@/core/list'
import Text from '@/components/common/Text'
import { type Position } from './ListMenu'
import { scaleSizeH } from '@/utils/pixelRatio'
import Loading from '@/components/common/Loading'

type FlatListType = FlatListProps<LX.List.MyListInfo>

const ITEM_HEIGHT = scaleSizeH(40)

const ListItem = memo(
  ({
    item,
    index,
    activeId,
    onPress,
    onShowMenu,
  }: {
    onPress: (item: LX.List.MyListInfo) => void
    index: number
    activeId: string
    item: LX.List.MyListInfo
    onShowMenu: (
      item: LX.List.MyListInfo,
      index: number,
      position: Position
    ) => void
  }) => {
    const theme = useTheme()
    const fetching = useListFetching(item.id)
    const moreButtonRef = useRef<TouchableOpacity>(null)
    const active = activeId == item.id

    const handleShowMenu = () => {
      if (moreButtonRef.current?.measure) {
        moreButtonRef.current.measure((fx, fy, width, height, px, py) => {
          onShowMenu(item, index, {
            x: Math.ceil(px),
            y: Math.ceil(py),
            w: Math.ceil(width),
            h: Math.ceil(height),
          })
        })
      }
    }

    return (
      <View key={item.id} style={[styles.listItem, { height: ITEM_HEIGHT }]}>
        {active ? (
          <Icon
            style={styles.listActiveIcon}
            name="chevron-right"
            size={12}
            color={theme['c-primary-font']}
          />
        ) : null}
        {fetching ? (
          <Loading
            color={active ? theme['c-primary-font'] : theme['c-font']}
            style={styles.loading}
          />
        ) : null}
        <TouchableOpacity style={styles.listName} onPress={() => onPress(item)}>
          <Text
            numberOfLines={1}
            color={active ? theme['c-primary-font'] : theme['c-font']}
          >
            {item.name}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleShowMenu}
          ref={moreButtonRef}
          style={styles.listMoreBtn}
        >
          <Icon name="dots-vertical" color={theme['c-350']} size={12} />
        </TouchableOpacity>
      </View>
    )
  },
  (prevProps, nextProps) => {
    return !!(
      prevProps.item === nextProps.item &&
      prevProps.index === nextProps.index &&
      prevProps.item.name == nextProps.item.name &&
      prevProps.activeId != nextProps.item.id &&
      nextProps.activeId != nextProps.item.id
    )
  }
)

export default ({
  onShowMenu,
}: {
  onShowMenu: (
    info: { listInfo: LX.List.MyListInfo; index: number },
    position: Position
  ) => void
}) => {
  const flatListRef = useRef<FlatList<LX.List.MyListInfo>>(null)
  const activeListId = useActiveListId()
  const allList = useMyList()

  const handleScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    void saveListPosition(LIST_SCROLL_POSITION_KEY, nativeEvent.contentOffset.y)
  }

  const showMenu = (
    listInfo: LX.List.MyListInfo,
    index: number,
    position: Position
  ) => {
    onShowMenu({ listInfo, index }, position)
  }

  const handleToggleList = (item: LX.List.MyListInfo) => {
    global.app_event.changeLoveListVisible(false)
    requestAnimationFrame(() => {
      setActiveList(item.id)
    })
  }

  useEffect(() => {
    void getListPosition(LIST_SCROLL_POSITION_KEY).then((offset) => {
      flatListRef.current?.scrollToOffset({ offset, animated: false })
    })
  }, [])

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => (
    <ListItem
      key={item.id}
      item={item}
      index={index}
      activeId={activeListId}
      onPress={handleToggleList}
      onShowMenu={showMenu}
    />
  )
  const getkey: FlatListType['keyExtractor'] = (item) => item.id
  const getItemLayout: FlatListType['getItemLayout'] = (data, index) => {
    return { length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index }
  }

  return (
    <FlatList
      ref={flatListRef}
      onScroll={handleScroll}
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 80 }}
      data={allList}
      maxToRenderPerBatch={9}
      windowSize={9}
      removeClippedSubviews={true}
      initialNumToRender={18}
      renderItem={renderItem}
      keyExtractor={getkey}
      getItemLayout={getItemLayout}
    />
  )
}

const styles = createStyle({
  container: {
    flexShrink: 1,
    flexGrow: 0,
  },
  listItem: {
    height: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 5,
    paddingLeft: 5,
  },
  listActiveIcon: {
    marginLeft: 3,
    textAlign: 'center',
  },
  loading: {
    marginHorizontal: 3,
  },
  listName: {
    height: '100%',
    justifyContent: 'center',
    flexGrow: 1,
    flexShrink: 1,
    paddingLeft: 5,
  },
  listMoreBtn: {
    height: '100%',
    width: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
