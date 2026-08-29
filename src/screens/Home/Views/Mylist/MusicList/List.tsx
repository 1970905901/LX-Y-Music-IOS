import { playList } from '@/core/player/player'
import { useMemo, useRef, useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react'
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type FlatListProps, Keyboard,
} from 'react-native'

import OnlineListItem from '@/components/OnlineList/ListItem';
import listState from '@/store/list/state'
import playerState from '@/store/player/state'
import { getListPosition, getListPrevSelectId, saveListPosition } from '@/utils/data'
// import { useMusicList } from '@/store/list/hook'
import { getListMusics, setActiveList } from '@/core/list'
import ListItem, { ITEM_HEIGHT } from './ListItem'
import { createStyle, getRowInfo } from '@/utils/tools'
import { usePlayInfo, usePlayMusicInfo } from '@/store/player/hook'
import type { Position } from './ListMenu'
import type { SelectMode } from './MultipleModeBar'
import { useActiveListId } from '@/store/list/hook'
import { useSettingValue } from '@/store/setting/hook'

type FlatListType = FlatListProps<LX.Music.MusicInfo>

export interface ListProps {
  onShowMenu: (musicInfo: LX.Music.MusicInfo, index: number, position: Position) => void
  onMuiltSelectMode: () => void
  onSelectAll: (isAll: boolean) => void
  showCover: boolean
}
export interface ListType {
  setIsMultiSelectMode: (isMultiSelectMode: boolean) => void
  setSelectMode: (mode: SelectMode) => void
  selectAll: (isAll: boolean) => void
  getSelectedList: () => LX.List.ListMusics
  scrollToInfo: (info: LX.Music.MusicInfo) => void
  scrollToTop: () => void
}

const usePlayIndex = () => {
  const activeListId = useActiveListId()
  const playMusicInfo = usePlayMusicInfo()
  const playInfo = usePlayInfo()

  const playIndex = useMemo(() => {
    return playMusicInfo.listId == activeListId ? playInfo.playIndex : -1
  }, [activeListId, playInfo.playIndex, playMusicInfo.listId])

  return playIndex
}

const List = forwardRef<ListType, ListProps>(
  ({ onShowMenu, onMuiltSelectMode, onSelectAll, showCover }, ref) => {
    // const t = useI18n()
    const flatListRef = useRef<FlatList>(null)
    const [currentList, setList] = useState<LX.List.ListMusics>([])
    // 当前列表数据的镜像引用 + 版本号：handleChange / musicInfoUpdate 时原地更新行对象，
    // 保持 data 数组引用不变 → FlatList(VirtualizedList) 不重算渲染窗口，
    // 避免播放中列表被重置回 initialNumToRender 而「加载不全 / 空白」。
    const listDataRef = useRef<LX.List.ListMusics>([])
    const [listVersion, setListVersion] = useState(0)
    const listFirstScrollRef = useRef(false)
    const isMultiSelectModeRef = useRef(false)
    const selectModeRef = useRef<SelectMode>('single')
    const prevSelectIndexRef = useRef(-1)
    const [selectedList, setSelectedList] = useState<LX.List.ListMusics>([])
    const selectedListRef = useRef<LX.List.ListMusics>([])
    const currentListIdRef = useRef('')
    const waitJumpListPositionRef = useRef(false)
    const rowInfo = useRef(getRowInfo())
    const isShowAlbumName = useSettingValue('list.isShowAlbumName')
    const isShowInterval = useSettingValue('list.isShowInterval')
    const isShowSource = useSettingValue('list.isShowSource')
    // console.log('render music list')

    useImperativeHandle(ref, () => ({
      setIsMultiSelectMode(isMultiSelectMode) {
        isMultiSelectModeRef.current = isMultiSelectMode
        if (!isMultiSelectMode) {
          prevSelectIndexRef.current = -1
          handleUpdateSelectedList([])
        }
      },
      setSelectMode(mode) {
        selectModeRef.current = mode
      },
      selectAll(isAll) {
        let list: LX.List.ListMusics
        if (isAll) {
          list = [...currentList]
        } else {
          list = []
        }
        selectedListRef.current = list
        setSelectedList(list)
      },
      getSelectedList() {
        return selectedListRef.current
      },
      scrollToInfo(info) {
        void getListMusics(listState.activeListId).then((list) => {
          const index = list.findIndex((m) => m.id == info.id)
          if (index < 0) return
          flatListRef.current?.scrollToIndex({
            index: Math.floor(index / (rowInfo.current.rowNum ?? 1)),
            viewPosition: 0.3,
            animated: true,
          })
        })
      },
      scrollToTop() {
        flatListRef.current?.scrollToOffset({
          offset: 0,
          animated: true,
        })
      },
    }))

    useEffect(() => {
      let isUpdateingList = true
      const updateList = (id: string) => {
        if (currentListIdRef.current == id) return
        isUpdateingList = true
        setList([])
        listDataRef.current = []
        currentListIdRef.current = id
        void Promise.all([getListMusics(id), getListPosition(id)])
          .then(([list, position]) => {
            requestAnimationFrame(() => {
              if (currentListIdRef.current != id) return
              selectedListRef.current = []
              setSelectedList([])
              listDataRef.current = list
              setList(list)
              setListVersion((v) => v + 1)
              requestAnimationFrame(() => {
                isUpdateingList = false
                listFirstScrollRef.current = true
                if (waitJumpListPositionRef.current) {
                  waitJumpListPositionRef.current = false
                  if (playerState.playMusicInfo.listId == id && playerState.playInfo.playIndex > -1) {
                    try {
                      flatListRef.current?.scrollToIndex({
                        index: Math.floor(
                          playerState.playInfo.playIndex / (rowInfo.current.rowNum ?? 1)
                        ),
                        viewPosition: 0.3,
                        animated: false,
                      })
                      return
                    } catch {}
                  }
                }
                flatListRef.current?.scrollToOffset({ offset: position, animated: false })
              })
            })
          })
          .catch(() => {
            // getListMusics / getListPosition 任一 reject 时，绝不能把列表永久停在 []，
            // 否则「重新打开歌单直接空白」。
            isUpdateingList = false
          })
      }
      const handleChange = (ids: string[]) => {
        if (!ids.includes(listState.activeListId)) return
        const id = listState.activeListId
        void getListMusics(id).then((list) => {
          if (currentListIdRef.current != id) return
          selectedListRef.current = []
          setSelectedList([])
          // 原地同步行对象，保持 data 引用不变，避免整表替换触发渲染窗口重置。
          const current = listDataRef.current
          if (current.length === list.length) {
            for (let i = 0; i < list.length; i++) current[i] = list[i]
            setListVersion((v) => v + 1)
          } else {
            listDataRef.current = list
            setList(list)
            setListVersion((v) => v + 1)
          }
        })
      }

      const handleJumpPosition = () => {
        requestAnimationFrame(() => {
          const listId = playerState.playMusicInfo.listId
          if (!listId) return
          if (listId != listState.activeListId) {
            setActiveList(listId)
            if (currentListIdRef.current != listId) waitJumpListPositionRef.current = true
          } else if (playerState.playInfo.playIndex > -1) {
            if (isUpdateingList) waitJumpListPositionRef.current = true
            else {
              try {
                flatListRef.current?.scrollToIndex({
                  index: Math.floor(playerState.playInfo.playIndex / (rowInfo.current.rowNum ?? 1)),
                  viewPosition: 0.3,
                  animated: true,
                })
              } catch {}
            }
          }
        })
      }
      if (global.lx.jumpMyListPosition) {
        global.lx.jumpMyListPosition = false
        if (playerState.playMusicInfo.listId) {
          waitJumpListPositionRef.current = true
          updateList(playerState.playMusicInfo.listId)
        } else void getListPrevSelectId().then(updateList)
      } else void getListPrevSelectId().then(updateList)

      global.state_event.on('mylistToggled', updateList)
      global.app_event.on('myListMusicUpdate', handleChange)
      global.app_event.on('jumpListPosition', handleJumpPosition as any)

      return () => {
        global.state_event.off('mylistToggled', updateList)
        global.app_event.off('myListMusicUpdate', handleChange)
        global.app_event.off('jumpListPosition', handleJumpPosition as any)
      }
    }, [])

    const activeIndex = usePlayIndex()
    const handlePlay = (index: number) => {
      void playList(listState.activeListId, index)
    }

    const handleUpdateSelectedList = (newList: LX.List.ListMusics) => {
      if (selectedListRef.current.length && newList.length == currentList.length) onSelectAll(true)
      else if (selectedListRef.current.length == currentList.length) onSelectAll(false)
      selectedListRef.current = newList
      setSelectedList(newList)
    }
    const handleSelect = (item: LX.Music.MusicInfo, pressIndex: number) => {
      let newList: LX.List.ListMusics
      if (selectModeRef.current == 'single') {
        prevSelectIndexRef.current = pressIndex
        const index = selectedListRef.current.indexOf(item)
        if (index < 0) {
          newList = [...selectedListRef.current, item]
        } else {
          newList = [...selectedListRef.current]
          newList.splice(index, 1)
        }
      } else {
        if (selectedListRef.current.length) {
          const prevIndex = prevSelectIndexRef.current
          const currentIndex = pressIndex
          if (prevIndex == currentIndex) {
            newList = []
          } else if (currentIndex > prevIndex) {
            newList = currentList.slice(prevIndex, currentIndex + 1)
          } else {
            newList = currentList.slice(currentIndex, prevIndex + 1)
            newList.reverse()
          }
        } else {
          newList = [item]
          prevSelectIndexRef.current = pressIndex
        }
      }

      handleUpdateSelectedList(newList)
    }

    const handlePress = (item: LX.Music.MusicInfo, index: number) => {
      // console.log(global.lx.homePagerIdle)
      requestAnimationFrame(() => {
        // console.log(global.lx.homePagerIdle)
        if (!global.lx.homePagerIdle) return
        if (isMultiSelectModeRef.current) {
          handleSelect(item, index)
        } else {
          handlePlay(index)
        }
      })
    }

    const handleLongPress = (item: LX.Music.MusicInfo, index: number) => {
      if (isMultiSelectModeRef.current) return
      prevSelectIndexRef.current = index
      handleUpdateSelectedList([item])
      onMuiltSelectMode()
    }

    const handleScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (listFirstScrollRef.current) {
        listFirstScrollRef.current = false
        return
      }
      void saveListPosition(listState.activeListId, nativeEvent.contentOffset.y)
    }

    // renderItem 引用必须永远不变：每次 List 重新渲染时若 renderItem 是新函数，
    // VirtualizedList 会重置渲染窗口回 initialNumToRender，表现为播放中列表
    // 「只显示前面部分、下方空白/加载不全」。通过 ref 镜像所有依赖，useCallback([])
    // 固定引用；行级刷新由 extraData={listVersion|activeIndex} 驱动。
    const renderDepsRef = useRef({
      activeIndex, selectedList, handlePress, handleLongPress, onShowMenu,
      rowInfo: rowInfo.current, isShowAlbumName, isShowInterval, isShowSource, showCover,
      playingId: playerState.playMusicInfo.musicInfo?.id ?? '',
    })
    renderDepsRef.current = {
      activeIndex, selectedList, handlePress, handleLongPress, onShowMenu,
      rowInfo: rowInfo.current, isShowAlbumName, isShowInterval, isShowSource, showCover,
      playingId: playerState.playMusicInfo.musicInfo?.id ?? '',
    }
    const renderItem = useCallback<FlatListType['renderItem']>(({ item, index }) => {
      const d = renderDepsRef.current
      if (item.source === 'wy') {
        return (
          <OnlineListItem
            item={item as LX.Music.MusicInfoOnline}
            index={index}
            onPress={d.handlePress}
            onLongPress={d.handleLongPress}
            onShowMenu={d.onShowMenu}
            selectedList={d.selectedList as LX.Music.MusicInfoOnline[]}
            playingId={d.playingId}
            rowInfo={d.rowInfo}
            isShowAlbumName={d.isShowAlbumName}
            isShowInterval={d.isShowInterval}
            listId='dailyrec_wy'
            showSource={d.isShowSource}
            showCover={d.showCover}
          />
        );
      } else {
        return (
          <ListItem
            item={item}
            index={index}
            activeIndex={d.activeIndex}
            onScrollBeginDrag={Keyboard.dismiss}
            onPress={d.handlePress}
            onLongPress={d.handleLongPress}
            onShowMenu={d.onShowMenu}
            selectedList={d.selectedList}
            rowInfo={d.rowInfo}
            isShowAlbumName={d.isShowAlbumName}
            isShowInterval={d.isShowInterval}
            showCover={d.showCover}
          />
        );
      }
    }, [])
    const getkey: FlatListType['keyExtractor'] = (item) => item.id
    const getItemLayout: FlatListType['getItemLayout'] = (data, index) => {
      return { length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index }
    }

    return (
      <FlatList
        ref={flatListRef}
        onScroll={handleScroll}
        style={styles.list}
        data={currentList}
        maxToRenderPerBatch={20}
        updateCellsBatchingPeriod={50}
        numColumns={rowInfo.current.rowNum}
        horizontal={false}
        windowSize={10}
        removeClippedSubviews={false}
        initialNumToRender={30}
        // iOS 上必须显式设置 scrollEventThrottle，否则滚动事件只在手势结束时
        // 触发一次，VirtualizedList 渲染窗口无法跟随滚动，列表下方一片空白。
        scrollEventThrottle={16}
        renderItem={renderItem}
        keyExtractor={getkey}
        // listVersion 驱动「原地更新行对象」后的行级刷新；activeIndex 驱动播放态高亮行刷新。
        extraData={`${listVersion}|${activeIndex}`}
        getItemLayout={getItemLayout}
      />
    )
  }
)

const styles = createStyle({
  container: {
    flex: 1,
  },
  list: {
    flexGrow: 1,
    flexShrink: 1,
  },
})

export default List
