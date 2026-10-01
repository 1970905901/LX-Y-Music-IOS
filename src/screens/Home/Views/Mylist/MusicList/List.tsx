import { playList } from '@/core/player/player'
import { useMemo, useRef, useState, useEffect, forwardRef, useImperativeHandle, useCallback, type ReactElement } from 'react'
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type FlatListProps, Keyboard,
} from 'react-native'

import OnlineListItem from '@/components/OnlineList/ListItem'
import listState from '@/store/list/state'
import playerState from '@/store/player/state'
import { getListPosition, getListPrevSelectId, saveListPosition } from '@/utils/data'
// import { useMusicList } from '@/store/list/hook'
import { getListMusics } from '@/core/list'
import ListItem, { ITEM_HEIGHT } from './ListItem'
import { createStyle, getRowInfo } from '@/utils/tools'
import { useHorizontalMode } from '@/utils/hooks'
import { usePlayInfo, usePlayMusicInfo } from '@/store/player/hook'
import type { Position } from './ListMenu'
import type { SelectMode } from './MultipleModeBar'
import { useActiveListId } from '@/store/list/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useBottomOverlayInset } from '@/store/common/hook'
import { usePhantomScrollGuard } from '@/utils/hooks/usePhantomScrollGuard'

type FlatListType = FlatListProps<LX.Music.MusicInfo>

export interface ListProps {
  header?: ReactElement
  /** 指定初始载入的列表 id。传入时优先于持久化的「上次选中列表」。 */
  listId?: string
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
  ({ header, listId, onShowMenu, onMuiltSelectMode, onSelectAll, showCover }, ref) => {
    // const t = useI18n()
    const flatListRef = useRef<FlatList>(null)
    // 首次进入的幽灵偏移修正（详见 usePhantomScrollGuard 注释）：
    // 试听列表 / 我的收藏的页头（PageTopInset + ActiveList）在列表内容里，
    // 页首次上屏时原生安全区插图的一次性变化会把 contentOffset 抬到 0 以上，
    // 整页上移、标题被顶到刘海后面（返回再进就正常）。
    const phantomGuard = usePhantomScrollGuard(flatListRef as any)
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
    // 列信息必须响应式：iPad 旋转/分屏跨过宽高比阈值时重新计算，
    // 否则 useRef 固化挂载时刻的值，numColumns 永不更新。
    // numColumns 变更时 FlatList 必须重挂载（见下方 key），否则 RN 会报错。
    const isHorizontal = useHorizontalMode()
    const rowInfo = useMemo(() => {
      void isHorizontal
      return getRowInfo()
    }, [isHorizontal])
    const numColumns = rowInfo.rowNum ?? 1
    // [] 依赖的 effect（首次载入定位到当前播放歌曲）内需要读到最新列数，用 ref 镜像
    const rowInfoRef = useRef(rowInfo)
    rowInfoRef.current = rowInfo
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
          // 程序化定位：先停用幽灵守卫，避免它把定位结果拉回顶部
          phantomGuard.stop()
          flatListRef.current?.scrollToIndex({
            index: Math.floor(index / numColumns),
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
      // 卸载护栏：本 effect 里的加载链是「异步取数据 → rAF → 再 rAF」，而用户完全
      // 可能在这条链跑完之前就按「返回」离开歌曲列表（反复进出「我的收藏」时尤其
      // 常见）。没有护栏的话，链尾会在已卸载的组件上 setState，并对已经销毁的
      // FlatList 调 scrollToIndex / scrollToOffset —— 每次进出都留一串迟到回调，
      // 是本页「反复进出后只剩列表能滑、其余点击全失效」的可疑来源之一。
      let cancelled = false
      const rafIds: number[] = []
      // 进页首屏的滚动事件（幽灵偏移纠正 / 程序化恢复位置）都不是用户滚动，
      // 不能写回「上次滚动位置」——否则一次幽灵偏移就把用户存的滚动位置冲成 0。
      // （原来只在恢复位置那一帧才置位，幽灵偏移更早到达时仍会误存。）
      listFirstScrollRef.current = true
      const scheduleRaf = (fn: () => void) => {
        rafIds.push(requestAnimationFrame(() => {
          if (cancelled) return
          fn()
        }))
      }
      const updateList = (id: string) => {
        if (cancelled || currentListIdRef.current == id) return
        setList([])
        listDataRef.current = []
        currentListIdRef.current = id
        void Promise.all([getListMusics(id), getListPosition(id)])
          .then(([list, position]) => {
            if (cancelled) return
            scheduleRaf(() => {
              if (currentListIdRef.current != id) return
              selectedListRef.current = []
              setSelectedList([])
              listDataRef.current = list
              setList(list)
              setListVersion((v) => v + 1)
              scheduleRaf(() => {
                listFirstScrollRef.current = true
                if (waitJumpListPositionRef.current) {
                  waitJumpListPositionRef.current = false
                  if (playerState.playMusicInfo.listId == id && playerState.playInfo.playIndex > -1) {
                    try {
                      // 程序化定位到当前播放：先停用幽灵守卫，避免定位结果被拉回顶部
                      phantomGuard.stop()
                      flatListRef.current?.scrollToIndex({
                        index: Math.floor(
                          playerState.playInfo.playIndex / (rowInfoRef.current.rowNum ?? 1),
                        ),
                        viewPosition: 0.3,
                        animated: false,
                      })
                      return
                    } catch {}
                  }
                }
                // 有「上次滚动位置」要恢复时同样先停用守卫（0 不必停：此时守卫正好负责归零）
                if (position > 0) phantomGuard.stop()
                flatListRef.current?.scrollToOffset({ offset: position, animated: false })
              })
            })
          })
          .catch(() => {
            // getListMusics / getListPosition 任一 reject 时，绝不能把列表永久停在 []，
            // 否则「重新打开歌单直接空白」。
          })
      }
      const handleChange = (ids: string[]) => {
        if (cancelled || !ids.includes(listState.activeListId)) return
        const id = listState.activeListId
        void getListMusics(id).then((list) => {
          if (cancelled || currentListIdRef.current != id) return
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

      // 初始载入哪条列表：
      // 1) 优先用父级显式传入的 listId（用户刚点的那一条）——「点开我的收藏 →
      //    返回 → 立刻再点开」时，持久化的「上次选中列表」可能还是返回时写入的
      //    default，只按持久化值载入会进错列表，观感就是「点了但没进去」。
      // 2) 没传时退回持久化值。
      const initialListId = listId
      if (initialListId) {
        waitJumpListPositionRef.current = playerState.playMusicInfo.listId === initialListId
        updateList(initialListId)
      } else void getListPrevSelectId().then(updateList)

      global.state_event.on('mylistToggled', updateList)
      global.app_event.on('myListMusicUpdate', handleChange)

      return () => {
        cancelled = true
        for (const id of rafIds) cancelAnimationFrame(id)
        rafIds.length = 0
        global.state_event.off('mylistToggled', updateList)
        global.app_event.off('myListMusicUpdate', handleChange)
      }
      // listId 刻意不进依赖：只在挂载时读一次即可（覆盖层每次打开都是全新挂载），
      // 进了依赖反而会在同一实例内因父级重渲染而重复跑整条加载链。
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // 同 OnlineList/List.tsx：去掉 rAF 延迟与 homePagerIdle 守卫（PagerView 已
      // scrollEnabled={false}，守卫已无意义，且历史上会把点击静默吞掉）。
      // 点击直接同步进入播放链路，避免 JS 帧驱动停摆时「列表能滑、点了没反应」。
      if (isMultiSelectModeRef.current) {
        handleSelect(item, index)
      } else {
        handlePlay(index)
      }
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
      activeIndex,
      selectedList,
      handlePress,
      handleLongPress,
      onShowMenu,
      rowInfo,
      isShowAlbumName,
      isShowInterval,
      isShowSource,
      showCover,
      playingId: playerState.playMusicInfo.musicInfo?.id ?? '',
    })
    renderDepsRef.current = {
      activeIndex,
      selectedList,
      handlePress,
      handleLongPress,
      onShowMenu,
      rowInfo,
      isShowAlbumName,
      isShowInterval,
      isShowSource,
      showCover,
      playingId: playerState.playMusicInfo.musicInfo?.id ?? '',
    }
    // 底部悬浮层（迷你播放器 + 底部 Tab + 安全区）统一避让高度
    const bottomInset = useBottomOverlayInset()
    const renderItem = useCallback<NonNullable<FlatListType['renderItem']>>(({ item, index }) => {
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
        )
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
        )
      }
    }, [])
    const getkey: FlatListType['keyExtractor'] = (item) => item.id
    const getItemLayout: FlatListType['getItemLayout'] = (data, index) => {
      return { length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index }
    }

    return (
      <FlatList
        ref={flatListRef}
        {...phantomGuard.props}
        onScroll={(e) => { phantomGuard.props.onScroll(e); handleScroll(e) }}
        style={styles.list}
        contentContainerStyle={{ paddingBottom: bottomInset }}
        data={currentList}
        ListHeaderComponent={header}
        maxToRenderPerBatch={20}
        updateCellsBatchingPeriod={50}
        // key：numColumns 变更（旋转/分屏）时强制重挂载 FlatList——
        // RN 不支持运行中变更 numColumns，直接改值会崩溃；重挂载时数据保存在本组件 state 中不丢失
        key={`cols-${numColumns}`}
        numColumns={numColumns}
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
  },
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
