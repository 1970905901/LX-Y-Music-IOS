import {useCallback, useMemo, useRef, useState, forwardRef, useImperativeHandle, useEffect} from 'react'
import {FlatList, type FlatListProps, Keyboard, RefreshControl, View} from 'react-native'
import ListItem, { ITEM_HEIGHT } from './ListItem'
import { createStyle, getRowInfo, type RowInfoType } from '@/utils/tools'
import { useHorizontalMode } from '@/utils/hooks'
import type { Position } from './ListMenu'
import type { SelectMode } from './MultipleModeBar'
import { useTheme } from '@/store/theme/hook'
import settingState from '@/store/setting/state'
import { MULTI_SELECT_BAR_HEIGHT } from './MultipleModeBar'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { handlePlay } from './listAction'
import { useSettingValue } from '@/store/setting/hook'

const wait = async (time = 50) => new Promise((resolve) => setTimeout(resolve, time))
type FlatListType = FlatListProps<LX.Music.MusicInfoOnline>
export type { RowInfoType }

export interface ListProps {
  onShowMenu: (musicInfo: LX.Music.MusicInfoOnline, index: number, position: Position) => void
  onMuiltSelectMode: () => void
  onSelectAll: (isAll: boolean) => void
  onRefresh: () => void
  onLoadMore: () => void
  onPlayList?: (index: number) => void
  progressViewOffset?: number
  ListHeaderComponent?: FlatListType['ListEmptyComponent']
  ListFooterComponent?: FlatListType['ListFooterComponent']
  checkHomePagerIdle: boolean
  rowType?: RowInfoType
  forcePlayList?: boolean
  playingId?: string | null
  listId?: string
  onListUpdate?: (list: LX.Music.MusicInfoOnline[]) => void
}

export interface ListType {
  setList: (list: LX.Music.MusicInfoOnline[], isAppend: boolean, showSource: boolean) => void
  setIsMultiSelectMode: (isMultiSelectMode: boolean) => void
  setSelectMode: (mode: SelectMode) => void
  selectAll: (isAll: boolean) => void
  getSelectedList: () => LX.Music.MusicInfoOnline[]
  getList: () => LX.Music.MusicInfoOnline[]
  setStatus: (val: Status) => void
  scrollToInfo: (info: LX.Music.MusicInfoOnline) => void
}

export type Status = 'loading' | 'refreshing' | 'end' | 'error' | 'idle'

const List = forwardRef<ListType, ListProps>(
  (
    {
      onShowMenu,
      onMuiltSelectMode,
      onSelectAll,
      onRefresh,
      listId,
      onLoadMore,
      onPlayList,
      progressViewOffset,
      ListHeaderComponent,
      ListFooterComponent,
      checkHomePagerIdle,
      rowType,
      forcePlayList,
      playingId,
      onListUpdate,
    },
    ref,
  ) => {
    const theme = useTheme()
    const flatListRef = useRef<FlatList>(null)
    const [currentList, setList] = useState<LX.Music.MusicInfoOnline[]>([])
    // 上次经命令式 setList 写入的数组引用。引用相同（数据已是该数组）时跳过整表替换，
    // 阻断 musicInfoUpdate → onListUpdate 回传父组件 → 父组件回传 setList 的回环，
    // 避免播放中 FlatList 渲染窗口被反复重置（列表“只显示 12 条下方空白”）。
    const lastSetListRef = useRef<LX.Music.MusicInfoOnline[] | null>(null)
    // 当前列表数据的镜像引用：musicInfoUpdate 时对其“原地”替换行对象并递增 version，
    // data 数组引用保持不变 → VirtualizedList 不会重算渲染窗口（根治播放中列表被重置回
    // initialNumToRender=12 而下方空白的顽疾），行级刷新由 extraData={listVersion} 驱动。
    const listDataRef = useRef<LX.Music.MusicInfoOnline[]>([])
    const [listVersion, setListVersion] = useState(0)
    const [showSource, setShowSource] = useState(false)
    const isMultiSelectModeRef = useRef(false)
    const selectModeRef = useRef<SelectMode>('single')
    const prevSelectIndexRef = useRef(-1)
    const [selectedList, setSelectedList] = useState<LX.Music.MusicInfoOnline[]>([])
    const selectedListRef = useRef<LX.Music.MusicInfoOnline[]>([])
    const [visibleMultiSelect, setVisibleMultiSelect] = useState(false)
    const [status, setStatus] = useState<Status>('idle')
    // 列信息必须响应式：iPad 旋转/分屏跨过宽高比阈值时重新计算，
    // 否则 useRef 固化挂载时刻的值，numColumns 永不更新（单列残留/双列不生效）。
    // numColumns 变更时 FlatList 必须重挂载（见下方 key），否则 RN 会报错。
    const isHorizontal = useHorizontalMode()
    const rowInfo = useMemo(() => getRowInfo(rowType), [isHorizontal, rowType])
    const numColumns = rowInfo.rowNum ?? 1
    const isShowAlbumName = useSettingValue('list.isShowAlbumName')
    const isShowInterval = useSettingValue('list.isShowInterval')

    useImperativeHandle(ref, () => ({
      setList(list, isAppend, showSource) {
        // 引用相同（数据已是该数组）时跳过整表替换，阻断
        // musicInfoUpdate → onListUpdate 回传父组件 → 父组件回传 setList 的回环，
        // 避免播放中 FlatList 渲染窗口被反复重置（列表“只显示 12 条下方空白”）。
        if (lastSetListRef.current === list) return
        lastSetListRef.current = list
        listDataRef.current = list
        setList(list)
        // 数据更新后主动踢一下 VirtualizedList 的渐进填充链
        // （onContentSizeChange → batcher），防止链路停滞导致窗口停留在初始行数。
        flatListRef.current?.recordInteraction?.()
        onListUpdate?.(list)
        setShowSource(showSource)
        if (!isAppend && selectedListRef.current.length)
          setSelectedList((selectedListRef.current = []))
      },
      setIsMultiSelectMode(isMultiSelectMode) {
        isMultiSelectModeRef.current = isMultiSelectMode
        if (!isMultiSelectMode) {
          prevSelectIndexRef.current = -1
          handleUpdateSelectedList([])
        }
        setVisibleMultiSelect(isMultiSelectMode)
      },
      setSelectMode(mode) {
        selectModeRef.current = mode
      },
      selectAll(isAll) {
        let list: LX.Music.MusicInfoOnline[]
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
      getList() {
        return listDataRef.current
      },
      setStatus(val) {
        setStatus(val)
      },
      scrollToInfo(info) {
        const index = listDataRef.current.findIndex(item => item.id === info.id)
        if (index > -1) {
          flatListRef.current?.scrollToIndex({
            index: Math.floor(index / numColumns),
            viewPosition: 0.3,
            animated: true,
          })
        }
      },
    }))

    useEffect(() => {
      const handleMusicInfoUpdate = (musicInfo: LX.Music.MusicInfo) => {
        // 关键：不整表替换 data 数组。播放中该事件到达时若替换数组引用，
        // VirtualizedList 会重算渲染窗口并重置回 initialNumToRender(12)，
        // 用户看到“列表只显示 12 条下方空白”且滚动加载停滞（各平台在线列表通病）。
        // 改为原地替换行对象 + 递增 version（extraData），data 引用不变 →
        // 渲染窗口完全不受影响，仅对应行重新渲染。
        const list = listDataRef.current
        const index = list.findIndex(item => item.id === musicInfo.id)
        if (index < 0) return
        list[index] = musicInfo as LX.Music.MusicInfoOnline
        setListVersion(version => version + 1)
        onListUpdate?.(list)
      }

      global.app_event.on('musicInfoUpdate', handleMusicInfoUpdate)
      return () => {
        global.app_event.off('musicInfoUpdate', handleMusicInfoUpdate)
      }
    }, [])

    const handleUpdateSelectedList = (newList: LX.Music.MusicInfoOnline[]) => {
      if (selectedListRef.current.length && newList.length == currentList.length) onSelectAll(true)
      else if (selectedListRef.current.length == currentList.length) onSelectAll(false)
      selectedListRef.current = newList
      setSelectedList(newList)
    }

    const handleSelect = (item: LX.Music.MusicInfoOnline, pressIndex: number) => {
      let newList: LX.Music.MusicInfoOnline[]
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

    const handlePress = (item: LX.Music.MusicInfoOnline, index: number) => {
      requestAnimationFrame(() => {
        if (checkHomePagerIdle && !global.lx.homePagerIdle) return
        if (isMultiSelectModeRef.current) {
          handleSelect(item, index)
        } else {
          if ((forcePlayList || settingState.setting['list.isClickPlayList']) && onPlayList != null) {
            onPlayList(index)
          } else {
            handlePlay(currentList[index])
          }
        }
      })
    }

    const handleLongPress = (item: LX.Music.MusicInfoOnline, index: number) => {
      if (isMultiSelectModeRef.current) return
      prevSelectIndexRef.current = index
      handleUpdateSelectedList([item])
      onMuiltSelectMode()
    }

    const handleLoadMore = () => {
      if (status != 'idle') return
      onLoadMore()
    }

    // renderItem 引用必须永远不变：每次 List 重新渲染时若 renderItem 是新函数，
    // VirtualizedList 会重置渲染窗口回 initialNumToRender(12)，表现为播放中
    // 列表只显示前 12 条下方空白（各平台在线列表通病）。
    // 通过 ref 镜像所有依赖，useCallback([]) 固定引用；行级刷新由 extraData 驱动。
    const renderDepsRef = useRef({
      showSource, isShowAlbumName, isShowInterval, listId, playingId,
      selectedList, handlePress, handleLongPress, onShowMenu, rowInfo,
    })
    renderDepsRef.current = {
      showSource, isShowAlbumName, isShowInterval, listId, playingId,
      selectedList, handlePress, handleLongPress, onShowMenu, rowInfo,
    }
    const renderItem = useCallback<NonNullable<FlatListType['renderItem']>>(({ item, index }) => {
      const d = renderDepsRef.current
      return (
        <ListItem
          item={item}
          index={index}
          listId={d.listId}
          showSource={d.showSource}
          onPress={d.handlePress}
          onLongPress={d.handleLongPress}
          onShowMenu={d.onShowMenu}
          selectedList={d.selectedList}
          playingId={d.playingId}
          rowInfo={d.rowInfo}
          isShowAlbumName={d.isShowAlbumName}
          isShowInterval={d.isShowInterval}
        />
      )
    }, [])
    const getkey: FlatListType['keyExtractor'] = (item) => (item as any).playHistoryId ?? item.id
    const getItemLayout: FlatListType['getItemLayout'] = (data, index) => {
      const rowIndex = Math.floor(index / numColumns)
      return { length: ITEM_HEIGHT, offset: ITEM_HEIGHT * rowIndex, index }
    }

    const refreshControl = useMemo(
      () => (
        <RefreshControl
          colors={[theme['c-primary']]}
          refreshing={status == 'refreshing'}
          onRefresh={onRefresh}
        />
      ),
      [status, onRefresh, theme],
    )

    const footerComponent = useMemo(() => {
      if (ListFooterComponent) return ListFooterComponent
      let label: FooterLabel
      switch (status) {
        case 'refreshing':
          return null
        case 'loading':
          label = 'list_loading'
          break
        case 'end':
          label = 'list_end'
          break
        case 'error':
          label = 'list_error'
          break
        case 'idle':
          label = null
          break
      }
      return (
        <View
          style={{ width: '100%', paddingBottom: visibleMultiSelect ? MULTI_SELECT_BAR_HEIGHT : 0 }}
        >
          <Footer label={label} onLoadMore={onLoadMore} />
        </View>
      )
    }, [onLoadMore, status, visibleMultiSelect, ListFooterComponent])

    const handleScrollBeginDrag = () => {
      if (listId !== 'search') Keyboard.dismiss()
    }

    return (
      <FlatList
        // key：numColumns 变更（旋转/分屏）时强制重挂载 FlatList——
        // RN 不支持运行中变更 numColumns，直接改值会崩溃；重挂载时数据保存在本组件 state 中不丢失
        key={`cols-${numColumns}`}
        ref={flatListRef}
        style={styles.list}
        // 底部内边距：让列表内容能滚到屏幕底部，最后一项停下时距离屏幕底部 80px，
        // 正好让位给绝对定位悬浮的迷你播放器（胶囊高度约 72，留 80 缓冲）。
        // 这里用 contentContainerStyle 而不是给外层容器加 paddingBottom，是因为
        // 后者会缩短列表的滚动范围（停在胶囊上方留空白），前者让列表占满整屏。
        contentContainerStyle={{ paddingBottom: 80 }}
        data={currentList}
        numColumns={numColumns}
        horizontal={false}
        maxToRenderPerBatch={20}
        updateCellsBatchingPeriod={50}
        windowSize={10}
        removeClippedSubviews={false}
        initialNumToRender={30}
        // iOS 上必须显式设置 scrollEventThrottle，否则滚动事件只在手势结束时
        // 触发一次，VirtualizedList 的渲染窗口无法跟随滚动推进，表现为
        // 列表滚动到下方一片空白。
        scrollEventThrottle={16}
        // 行数据原地更新（musicInfoUpdate）+ 播放状态变化时驱动对应行重渲染；
        // data 引用保持稳定、renderItem 引用固定，VirtualizedList 不重置渲染窗口。
        extraData={`${listVersion}|${playingId ?? ''}|${showSource ? '1' : '0'}|${selectedList.length}`}
        renderItem={renderItem}
        keyExtractor={getkey}
        getItemLayout={getItemLayout}
        onScrollBeginDrag={handleScrollBeginDrag}
        // onRefresh={onRefresh}
        // refreshing={refreshing}
        onEndReachedThreshold={0.5}
        onEndReached={handleLoadMore}
        progressViewOffset={progressViewOffset}
        ListHeaderComponent={ListHeaderComponent}
        refreshControl={refreshControl}
        ListFooterComponent={footerComponent}
      />
    )
  },
)

type FooterLabel = 'list_loading' | 'list_end' | 'list_error' | null
const Footer = ({ label, onLoadMore }: { label: FooterLabel, onLoadMore: () => void }) => {
  const theme = useTheme()
  const t = useI18n()
  const handlePress = () => {
    if (label != 'list_error') return
    onLoadMore()
  }
  return label ? (
    <View>
      <Text onPress={handlePress} style={styles.footer} color={theme['c-font-label']}>
        {t(label)}
      </Text>
    </View>
  ) : null
}
const styles = createStyle({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  footer: {
    textAlign: 'center',
    padding: 10,
  },
})

export default List
