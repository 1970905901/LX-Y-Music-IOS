import { memo, useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { View, TouchableOpacity, FlatList, ActivityIndicator, RefreshControl, Animated, PanResponder, BackHandler, StyleSheet } from 'react-native'
import { useMyList, useActiveListId, useListFetching } from '@/store/list/hook'
import { useSettingValue } from '@/store/setting/hook'
import { setActiveList, updateUserListPosition } from '@/core/list'
import { fetchCoverUrl } from '@/core/music/coverUrl'
import { getListMusics } from '@/utils/data'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import Image from '@/components/common/Image'
import { Icon } from '@/components/common/Icon'
import { createStyle } from '@/utils/tools'
import commonState from '@/store/common/state'
import MusicList from './MusicList'
import { useHorizontalMode } from '@/utils/hooks'
import ListMenu, { type ListMenuType, type Position } from './MyList/ListMenu'
import ListNameEdit, { type ListNameEditType } from './MyList/ListNameEdit'
import ListMusicSort, { type ListMusicSortType } from './MyList/ListMusicSort'
import DuplicateMusic, { type DuplicateMusicType } from './MyList/DuplicateMusic'
import ListImportExport, { type ListImportExportType } from './MyList/ListImportExport'
import { handleRemove, handleSync } from './MyList/listAction'
import { LIST_IDS, COMPONENT_IDS } from '@/config/constant'
import { scaleSizeH } from '@/utils/pixelRatio'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
import { useBottomOverlayInset } from '@/store/common/hook'
import PageTopInset from '@/components/common/PageTopInset'
import Loading from '@/components/common/Loading'
import { Navigation } from 'react-native-navigation'
import OpenList from '../SongList/HeaderBar/OpenList'
import { navigations } from '@/navigation'
import FeatureGrid from '@/components/home/FeatureGrid'
import SwipeBackArea from '@/components/common/SwipeBackArea'

const CARD_HEIGHT = scaleSizeH(64)
const LONG_PRESS_MS = 350

interface ListItemInfo {
  id: string
  name: string
  cover: string
  total: number
  isFixed: boolean
}

// 模块级稳定引用：FlatList 的 keyExtractor 每次渲染新建会让 VirtualizedList 认为
// props 变了，多做一轮 props 比对。（renderItem 已是稳定 useCallback。）
const keyExtractor = (item: ListItemInfo) => item.id

interface DragAnim {
  translateY: Animated.Value
  scale: Animated.Value
  opacity: Animated.Value
}

const createAnim = (): DragAnim => ({
  translateY: new Animated.Value(0),
  scale: new Animated.Value(1),
  opacity: new Animated.Value(1),
})

interface MenuPosition { x: number, y: number, w: number, h: number }

const FixedPlaylistCard = memo(({
  item,
  onPress,
  onShowMenu,
}: {
  item: ListItemInfo
  onPress: () => void
  onShowMenu: (item: ListItemInfo, position: MenuPosition) => void
}) => {
  const theme = useTheme()
  const activeId = useActiveListId()
  const fetching = useListFetching(item.id)
  const moreButtonRef = useRef<TouchableOpacity>(null)

  const handleShowMenu = () => {
    if (moreButtonRef.current?.measure) {
      moreButtonRef.current.measure((fx, fy, width, height, px, py) => {
        onShowMenu(item, {
          x: Math.ceil(px),
          y: Math.ceil(py),
          w: Math.ceil(width),
          h: Math.ceil(height),
        })
      })
    }
  }

  return (
    <Animated.View
      style={[
        styles.cardContainer,
        {
          height: CARD_HEIGHT,
          backgroundColor: activeId == item.id
            ? theme['c-primary-background-hover']
            // 与其它列表行统一用「底边」令牌（跟随主题色 + 主题页「底边不透明度」）；
            // 原来这一处（以及下面的可拖拽卡片）用 -alpha-300，不跟滑杆变化。
            : theme['c-primary-light-900-alpha-200'],
        },
      ]}
    >
      <TouchableOpacity onPress={onPress} style={styles.cardContent}>
        <Image url={item.cover} style={styles.artwork} />
        <View style={styles.info}>
          <Text size={16} numberOfLines={2} style={styles.listName} color={theme['c-font']}>{item.name}</Text>
          {item.total > 0 ? (
            <Text size={12} color={theme['c-font-label']}>{item.total} 首</Text>
          ) : null}
        </View>
        {fetching ? (
          <Loading color={theme['c-font']} style={styles.loading} />
        ) : null}
      </TouchableOpacity>
      <TouchableOpacity onPress={handleShowMenu} ref={moreButtonRef} style={styles.moreBtn}>
        <Icon name="dots-vertical" color={theme['c-350']} size={17} />
      </TouchableOpacity>
    </Animated.View>
  )
})

const PlaylistCard = memo(({
  item,
  userListIndex,
  onPress,
  onShowMenu,
  isDragging: _isDragging,
  isDragSource,
  translateY,
  scale,
  opacity,
  zIndex,
  onLayoutHeight,
  onLongPressStart,
  onDragMove,
  onDragRelease,
  onDragCancel,
  onTouchStart,
  onTouchEnd,
}: {
  item: ListItemInfo
  userListIndex: number
  onPress: () => void
  onShowMenu: (item: ListItemInfo, index: number, position: MenuPosition) => void
  isDragging: boolean
  isDragSource: boolean
  translateY: Animated.Value
  scale: Animated.Value
  opacity: Animated.Value
  zIndex: number
  onLayoutHeight: (index: number, height: number) => void
  onLongPressStart: (index: number) => void
  onDragMove: (dy: number) => void
  onDragRelease: () => void
  onDragCancel: () => void
  onTouchStart: () => void
  onTouchEnd: () => void
}) => {
  const theme = useTheme()
  const activeId = useActiveListId()
  const fetching = useListFetching(item.id)
  const moreButtonRef = useRef<TouchableOpacity>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isActivatedRef = useRef(false)
  const currentDyRef = useRef(0)
  const activationDyRef = useRef(0)

  const clearLongPressTimer = () => {
    if (longPressTimer.current != null) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  useEffect(() => {
    return () => {
      clearLongPressTimer()
    }
  }, [])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        // 关键修复：长按时立即接管手势，避免父级 ScrollView 抢占导致整页随拖动滚动。
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          onTouchStart()
          clearLongPressTimer()
          isActivatedRef.current = false
          currentDyRef.current = 0
          longPressTimer.current = setTimeout(() => {
            longPressTimer.current = null
            isActivatedRef.current = true
            // 记录激活瞬间的位移作为基准，避免松开/激活时条目突跳。
            activationDyRef.current = currentDyRef.current
            onLongPressStart(userListIndex)
          }, LONG_PRESS_MS)
        },
        onPanResponderMove: (_e, gs) => {
          currentDyRef.current = gs.dy
          if (!isActivatedRef.current) {
            // 激活前仅消费手势（防止 ScrollView 滚动），不触发拖动。
            return
          }
          onDragMove(gs.dy - activationDyRef.current)
        },
        onPanResponderRelease: () => {
          onTouchEnd()
          clearLongPressTimer()
          if (isActivatedRef.current) {
            isActivatedRef.current = false
            onDragRelease()
          }
        },
        onPanResponderTerminate: () => {
          onTouchEnd()
          clearLongPressTimer()
          if (isActivatedRef.current) {
            isActivatedRef.current = false
            onDragCancel()
          }
        },
        // 一旦接管手势就不再释放给 ScrollView，避免整页被滚动。
        onPanResponderTerminationRequest: () => false,
      }),
    [userListIndex, onLongPressStart, onDragMove, onDragRelease, onDragCancel, onTouchStart, onTouchEnd],
  )

  const handleShowMenu = () => {
    if (moreButtonRef.current?.measure) {
      moreButtonRef.current.measure((fx, fy, width, height, px, py) => {
        onShowMenu(item, userListIndex, {
          x: Math.ceil(px),
          y: Math.ceil(py),
          w: Math.ceil(width),
          h: Math.ceil(height),
        })
      })
    }
  }

  const transform = isDragSource
    ? [{ translateY }, { scale }]
    : [{ translateY }]
  const shadowOpacity = isDragSource ? 0.25 : 0
  const backgroundColor = isDragSource
    ? theme['c-primary-background-active']
    : activeId == item.id
      ? theme['c-primary-background-hover']
      : theme['c-primary-light-900-alpha-200']

  return (
    <Animated.View
      onLayout={(e) => { onLayoutHeight(userListIndex, e.nativeEvent.layout.height) }}
      style={[
        styles.cardContainer,
        {
          height: CARD_HEIGHT,
          backgroundColor,
          opacity,
          transform,
          zIndex,
          shadowOpacity,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowRadius: 4,
        },
      ]}
    >
      <TouchableOpacity onPress={onPress} style={styles.cardContent}>
        <Image
          url={item.cover}
          style={styles.artwork}
        />
        <View style={styles.info}>
          <Text size={16} numberOfLines={2} style={styles.listName} color={theme['c-font']}>
            {item.name}
          </Text>
          {item.total > 0 ? (
            <Text size={12} color={theme['c-font-label']}>
              {item.total} 首
            </Text>
          ) : null}
        </View>
        {fetching ? (
          <Loading color={theme['c-font']} style={styles.loading} />
        ) : null}
      </TouchableOpacity>
      {!item.isFixed && (
        <View style={styles.dragHandle} {...panResponder.panHandlers}>
          <Icon name="menu" color={theme['c-font-label']} size={14} />
        </View>
      )}
      <TouchableOpacity onPress={handleShowMenu} ref={moreButtonRef} style={styles.moreBtn}>
        <Icon name="dots-vertical" color={theme['c-350']} size={17} />
      </TouchableOpacity>
    </Animated.View>
  )
})

export default memo(() => {
  const theme = useTheme()
  // 底部悬浮层（迷你播放器 + 底部 Tab + 安全区）统一避让高度
  const bottomInset = useBottomOverlayInset()
  const t = useI18n()
  const allList = useMyList()
  const activeListId = useActiveListId()
  const isHorizontal = useHorizontalMode()
  const listVisibility = useSettingValue('list.myListVisibility')

  const [listInfoMap, setListInfoMap] = useState<Map<string, { cover: string, total: number }>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [showMusicList, setShowMusicList] = useState(false)
  const [isTouchingDragHandle, setIsTouchingDragHandle] = useState(false)
  const isFirstLoadRef = useRef(true)

  const showMusicListRef = useRef(false)
  useEffect(() => {
    showMusicListRef.current = showMusicList
  }, [showMusicList])

  // 覆盖层「本次打开」的目标列表。打开详情时写入，返回时清空。
  // 用途：详情覆盖层与列表面板是互斥渲染的两棵子树，覆盖层里的 MusicList 挂载时
  // 是按 getListPrevSelectId()（持久化值）去载入歌曲的，而该值来自上一次进出时
  // setActiveList 写入的缓存。用户「点开我的收藏 → 返回 → 立刻再点开」时，
  // 若持久化值落后于本次点击（返回时写的是 default），覆盖层就会载入错误列表、
  // 观感是「点了但没进去（进去的是别的列表 / 一闪就退）」。
  // 这里在打开前用明确的 id 重新断言一次，覆盖层挂载时以它为准。
  const openListIdRef = useRef<string | null>(null)
  // 打开覆盖层的时间戳：用于挡住「刚打开就被同一个手势的余波 / 迟到的关闭请求关掉」。
  const openedAtRef = useRef(0)

  const handleBackToList = useCallback(() => {
    // 刚打开后的极短时间内不接受关闭：覆盖层是全新挂载的子树，挂载过程中
    // 任何迟到的关闭请求（旧手势的 release、上一轮的异步回调）都会让它
    // 「闪一下」又消失。超过该窗口的关闭请求一律照常处理。
    if (Date.now() - openedAtRef.current < 250) return
    openListIdRef.current = null
    setShowMusicList(false)
    setActiveList(LIST_IDS.DEFAULT)
  }, [])

  const handleOpenImportedDetail = useCallback((item: any) => {
    const homeComponentId = commonState.componentIds.find(({ name }) => name === COMPONENT_IDS.home)?.id
    if (homeComponentId) navigations.pushSonglistDetailScreen(homeComponentId, item)
  }, [])

  useEffect(() => {
    const onBackPress = () => {
      if (showMusicListRef.current) {
        if (commonState.componentIds.length > 1) {
          return false
        }
        handleBackToList()
        return true
      }
      return false
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress)
    return () => { subscription.remove() }
  }, [handleBackToList])

  const heightsRef = useRef<number[]>([])
  const animsRef = useRef<DragAnim[]>([])
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const draggingIndexRef = useRef<number | null>(null)
  const targetIndexRef = useRef<number | null>(null)
  const lastTargetRef = useRef<number | null>(null)

  const listMenuRef = useRef<ListMenuType>(null)
  const listNameEditRef = useRef<ListNameEditType>(null)
  const listMusicSortRef = useRef<ListMusicSortType>(null)
  const duplicateMusicRef = useRef<DuplicateMusicType>(null)
  const listImportExportRef = useRef<ListImportExportType>(null)

  const isListVisible = useCallback((listId: string) => {
    return listVisibility[listId] ?? true
  }, [listVisibility])

  const userLists = useMemo(() => allList.filter(l => l.id !== LIST_IDS.DEFAULT && l.id !== LIST_IDS.LOVE && isListVisible(l.id)), [allList, isListVisible])

  if (animsRef.current.length !== userLists.length) {
    if (animsRef.current.length < userLists.length) {
      for (let i = animsRef.current.length; i < userLists.length; i++) {
        animsRef.current.push(createAnim())
      }
    } else {
      animsRef.current.length = userLists.length
    }
    heightsRef.current.length = userLists.length
  }

  const fetchListInfo = useCallback(async(listId: string) => {
    try {
      const musics = await getListMusics(listId)
      const first = musics[0]
      let cover = first?.meta?.picUrl ?? ''
      // meta.picUrl 为空（WebDAV 同步 / 备份导入的歌单首曲常无封面）时按需动态补全，
      // 复用列表项同一套 getPicPath 分发（带缓存 + 并发限制），与「歌曲列表有封面」保持一致。
      // 在线获取偶发超时/失败会导致封面概率性空白，这里失败后短暂延迟再重试一次。
      if (!cover && first) {
        cover = await fetchCoverUrl(first)
        if (!cover) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 800)
          })
          cover = await fetchCoverUrl(first)
        }
      }
      return { cover, total: musics.length }
    } catch {
      // 获取失败返回 null：合并时跳过该行、保留上一次成功的信息。
      // 此前返回 { cover: '', total: 0 }，与「真的空列表」无法区分，合并用的
      // 空值合并（??）对空字符串/0 不回退，会把已加载的行信息洗成 LX 占位 +
      // 无歌曲数（用户反馈的「我的收藏行卡住置灰」）。
      return null
    }
  }, [])

  const refreshListInfo = useCallback(async(isBackgroundRefresh = false) => {
    // 首次加载显示 loading，后台刷新保留已有数据避免闪烁
    if (!isBackgroundRefresh) {
      setIsLoading(true)
    }
    setHasError(false)
    try {
      // fetchListInfo 失败时返回 null（见其 catch 分支），Map 的类型必须允许 null，
      // 否则与「失败返回 null」的实现不一致（下面取用时已用可选链 fresh?. 兜底）。
      const fetched = new Map<string, { cover: string, total: number } | null>()
      for (const list of allList) {
        fetched.set(list.id, await fetchListInfo(list.id))
      }
      // 合并旧值：封面获取失败/为空（网络抖动、WebDAV 歌单首曲无封面且动态补全
      // 失败）时 fresh.cover 是空字符串——`??` 只对 null/undefined 回退，空串会把
      // 上一次成功的封面洗掉（行呈 LX 占位 + 整行发灰的「卡住」观感），必须用 ||
      // 让空串也回退到旧值。total 来自 musics.length 是可靠值，无需回退。
      setListInfoMap((prev) => {
        const next = new Map<string, { cover: string, total: number }>()
        for (const list of allList) {
          const fresh = fetched.get(list.id)
          next.set(list.id, {
            cover: fresh?.cover || prev.get(list.id)?.cover || '',
            total: fresh?.total ?? 0,
          })
        }
        return next
      })
    } catch {
      setHasError(true)
    } finally {
      setIsLoading(false)
      isFirstLoadRef.current = false
    }
  }, [allList, fetchListInfo])

  useEffect(() => {
    void refreshListInfo()
  }, [refreshListInfo])


  useEffect(() => {
    const subscription = Navigation.events().registerComponentDidAppearListener(({ componentId: appearedId }) => {
      const homeId = commonState.componentIds.find(c => c.name === 'home')?.id
      if (appearedId === homeId && !isFirstLoadRef.current) {
        void refreshListInfo(true)
      }
    })
    return () => { subscription.remove() }
  }, [refreshListInfo])

  const resetAllAnims = useCallback(() => {
    for (const anim of animsRef.current) {
      anim.translateY.stopAnimation()
      anim.scale.stopAnimation()
      anim.opacity.stopAnimation()
      anim.translateY.setValue(0)
      anim.scale.setValue(1)
      anim.opacity.setValue(1)
    }
  }, [])

  useEffect(() => {
    resetAllAnims()
  }, [resetAllAnims])

  useEffect(() => {
    const userListCount = userLists.length
    while (animsRef.current.length < userListCount) {
      animsRef.current.push(createAnim())
    }
    while (animsRef.current.length > userListCount) {
      animsRef.current.pop()
    }
    resetAllAnims()
  }, [allList, userLists, resetAllAnims])

  useEffect(() => {
    if (activeListId && activeListId !== LIST_IDS.DEFAULT) {
      setShowMusicList(true)
    }
  }, [activeListId])

  useEffect(() => {
    // 只在「该列表被用户明确设为隐藏」时才关闭覆盖层。
    // 之前写成 !isListVisible(activeListId)：isListVisible 内部是 `?? true`，语义上
    // 只把「显式 false」判为隐藏，看起来等价；但它是「取反」写法，一旦 listVisibility
    // 在设置尚未加载 / 被重置的瞬间取到非对象值，取反结果会瞬间为真，把刚打开的
    // 覆盖层立刻关掉（用户看到的「闪一下进不去」）。
    // 这里改成只认「显式 false」这一种情况，其余任何值（含 undefined）都不关闭。
    const hiddenByUser = (listVisibility as Record<string, unknown>)[activeListId] === false
    if (!isHorizontal && showMusicList && activeListId && hiddenByUser) {
      handleBackToList()
    }
  }, [activeListId, handleBackToList, isHorizontal, listVisibility, showMusicList])

  const handleItemPress = useCallback((item: ListItemInfo) => {
    // 先记录打开时刻与目标列表，再写全局状态：
    // 若先 setShowMusicList(true) 再记录，覆盖层挂载后紧跟的 effect 里
    // openedAtRef 仍是旧值，250ms 窗口形同虚设。
    openedAtRef.current = Date.now()
    openListIdRef.current = item.id
    // 覆盖层挂载时按此值载入歌曲（以 listId 属性传给 MusicList）。
    setActiveList(item.id)
    setShowMusicList(true)
  }, [])

  const listItems = useMemo(() => {
    return allList.filter(list => isListVisible(list.id)).map(list => {
      const info = listInfoMap.get(list.id)
      return {
        id: list.id,
        name: list.name,
        cover: info?.cover ?? '',
        total: info?.total ?? 0,
        isFixed: list.id === LIST_IDS.DEFAULT || list.id === LIST_IDS.LOVE,
      }
    })
  }, [allList, isListVisible, listInfoMap])

  const handleLayoutHeight = useCallback((index: number, height: number) => {
    heightsRef.current[index] = height
  }, [])

  const handleLongPressStart = useCallback((index: number) => {
    draggingIndexRef.current = index
    targetIndexRef.current = index
    lastTargetRef.current = index
    setDraggingIndex(index)
    setIsTouchingDragHandle(true)
    const anim = animsRef.current[index]
    if (!anim) return
    Animated.parallel([
      Animated.spring(anim.scale, { toValue: 1.03, useNativeDriver: true, friction: 7 }),
      Animated.timing(anim.opacity, { toValue: 0.92, duration: 120, useNativeDriver: true }),
    ]).start()
  }, [])

  const computeTargetIndex = useCallback((from: number, dy: number) => {
    const heights = heightsRef.current
    const n = heights.length
    if (n === 0) return from

    const cumulative: number[] = []
    let acc = 0
    for (let i = 0; i < n; i++) {
      cumulative.push(acc)
      acc += heights[i] ?? 0
    }
    const draggedHeight = heights[from] ?? 0
    const originalTop = cumulative[from] ?? 0
    const newCenter = originalTop + dy + draggedHeight / 2

    let target = from
    let minDist = Infinity
    for (let i = 0; i < n; i++) {
      const itemCenter = (cumulative[i] ?? 0) + (heights[i] ?? 0) / 2
      const dist = Math.abs(itemCenter - newCenter)
      if (dist < minDist) {
        minDist = dist
        target = i
      }
    }
    return target
  }, [])

  const animateLayout = useCallback((from: number, to: number) => {
    const heights = heightsRef.current
    const draggedHeight = heights[from] ?? 0
    if (draggedHeight <= 0) return
    for (let i = 0; i < animsRef.current.length; i++) {
      if (i === from) continue
      const anim = animsRef.current[i]
      let target = 0
      if (from < to) {
        if (i > from && i <= to) target = -draggedHeight
      } else if (from > to) {
        if (i >= to && i < from) target = draggedHeight
      }
      Animated.spring(anim.translateY, {
        toValue: target,
        useNativeDriver: true,
        friction: 9,
        tension: 70,
      }).start()
    }
  }, [])

  const handleDragMove = useCallback(
    (dy: number) => {
      const from = draggingIndexRef.current
      if (from == null) return
      const anim = animsRef.current[from]
      if (anim) anim.translateY.setValue(dy)
      const target = computeTargetIndex(from, dy)
      targetIndexRef.current = target
      if (target !== lastTargetRef.current) {
        lastTargetRef.current = target
        animateLayout(from, target)
      }
    },
    [computeTargetIndex, animateLayout],
  )

  const persistReorder = useCallback((from: number, to: number) => {
    if (from === to) return
    const next = [...userLists]
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    void updateUserListPosition(to, [moved.id])
  }, [userLists])

  const handleDragRelease = useCallback(() => {
    const from = draggingIndexRef.current
    const to = targetIndexRef.current ?? from
    draggingIndexRef.current = null
    targetIndexRef.current = null
    lastTargetRef.current = null
    setDraggingIndex(null)
    setIsTouchingDragHandle(false)
    if (from == null) return
    resetAllAnims()
    if (to != null && to !== from) {
      persistReorder(from, to)
    }
  }, [persistReorder, resetAllAnims])

  const handleDragCancel = useCallback(() => {
    draggingIndexRef.current = null
    targetIndexRef.current = null
    lastTargetRef.current = null
    setDraggingIndex(null)
    setIsTouchingDragHandle(false)
    resetAllAnims()
  }, [resetAllAnims])

  const handleTouchStart = useCallback(() => {
    setIsTouchingDragHandle(true)
  }, [])

  const handleTouchEnd = useCallback(() => {
    setIsTouchingDragHandle(false)
  }, [])

  const showMenu = useCallback((item: ListItemInfo, index: number, position: Position) => {
    const listInfo = allList.find(l => l.id === item.id)
    if (listInfo) {
      listMenuRef.current?.show({ listInfo, index }, position)
    }
  }, [allList])

  // 稳定 renderItem：依赖项全是本文件内已 useCallback 的处理器，唯一会变的
  // 是 draggingIndex（拖拽期间必须变化，用于切换 isDragging / isDragSource）。
  const renderItem = useCallback(({ item }: { item: ListItemInfo }) => {
    const userListIndex = userLists.findIndex(l => l.id === item.id)

    if (item.isFixed) {
      return (
        <FixedPlaylistCard
          item={item}
          onPress={() => { handleItemPress(item) }}
          onShowMenu={(itemInfo, position) => { showMenu(itemInfo, -1, position) }}
        />
      )
    }

    const anim = animsRef.current[userListIndex] ?? createAnim()
    const isDragSource = draggingIndex === userListIndex

    return (
      <PlaylistCard
        item={item}
        userListIndex={userListIndex}
        onPress={() => { handleItemPress(item) }}
        onShowMenu={showMenu}
        isDragging={draggingIndex != null}
        isDragSource={isDragSource}
        translateY={anim.translateY}
        scale={anim.scale}
        opacity={anim.opacity}
        zIndex={isDragSource ? 10 : 1}
        onLayoutHeight={handleLayoutHeight}
        onLongPressStart={handleLongPressStart}
        onDragMove={handleDragMove}
        onDragRelease={handleDragRelease}
        onDragCancel={handleDragCancel}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      />
    )
  }, [
    userLists,
    draggingIndex,
    handleItemPress,
    showMenu,
    handleLayoutHeight,
    handleLongPressStart,
    handleDragMove,
    handleDragRelease,
    handleDragCancel,
    handleTouchStart,
    handleTouchEnd,
  ])

  const listHeader = (
    <>
      <PageTopInset />
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle} size={34} color={theme['c-font']}>
          {t('discovery_tab_playlists')}
        </Text>
        <OpenList onOpenDetail={handleOpenImportedDetail} />
      </View>
    </>
  )

  const listPanel = (
    <View style={styles.content}>
      {hasError ? (
        <View style={styles.errorContainer}>
          <Text size={16} color={theme['c-font']} style={styles.errorText}>加载失败</Text>
          <TouchableOpacity onPress={() => { void refreshListInfo() }} style={styles.retryButton}>
            <Text size={14} color={theme['c-primary-font']}>点击尝试重新加载</Text>
          </TouchableOpacity>
        </View>
      ) : isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={theme['c-primary-font']} size="large" />
        </View>
      ) : (
        <>
          <FlatList
            data={listItems}
            contentContainerStyle={{ paddingBottom: bottomInset }}
            renderItem={renderItem}
            ListHeaderComponent={listHeader}
            // 更多功能网格（网易/酷狗/QQ 歌单、关注歌手、收藏专辑、WebDAV、本地与下载）
            // 已从推荐页迁移至此：作为列表底部内容随页滚动，各平台入口按 Cookie 登录态显隐。
            ListFooterComponent={<FeatureGrid />}
            keyExtractor={keyExtractor}
            style={styles.listContainer}
            scrollEnabled={draggingIndex == null}
            refreshControl={
              <RefreshControl
                // sim-refresh-ok: 该 FlatList 只在 isLoading === false 时渲染（上面 isLoading 分支
                // 走 ActivityIndicator），因此 RefreshControl 挂载时 refreshing 恒为 false，
                // 不存在「首帧程序化刷新撑 inset」的问题。
                refreshing={isLoading}
                onRefresh={() => { void refreshListInfo(false) }}
                colors={[theme['c-primary-font']]}
                enabled={!isTouchingDragHandle}
              />
            }
          />
          <ListNameEdit ref={listNameEditRef} />
          <ListMusicSort ref={listMusicSortRef} />
          <DuplicateMusic ref={duplicateMusicRef} />
          <ListImportExport ref={listImportExportRef} />
          <ListMenu
            ref={listMenuRef}
            onNew={(index) => listNameEditRef.current?.showCreate(index)}
            onRename={(info) => listNameEditRef.current?.show(info)}
            onSort={(info) => listMusicSortRef.current?.show(info)}
            onDuplicateMusic={(info) => duplicateMusicRef.current?.show(info)}
            onImport={(info, position) => listImportExportRef.current?.import(info, position)}
            onExport={(info, position) => listImportExportRef.current?.export(info, position)}
            onRemove={(info) => { handleRemove(info) }}
            onSync={(info) => { handleSync(info) }}
          />
        </>
      )}
    </View>
  )

  // iPad 横屏：左栏列表名卡片 + 右栏歌曲列表（master-detail 分栏），竖屏走上面的整屏切换。
  if (isHorizontal) {
    const hasActiveList = showMusicList || (activeListId != null && activeListId !== LIST_IDS.DEFAULT)
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View
            style={{
              // 百分比宽度：iPad 分屏 / Slide Over 下窗口宽度不定，
              // 写死 360 且禁止收缩会把右栏挤到接近 0（Slide Over 时内容不可用）
              width: '38%',
              borderRightWidth: 1,
              borderRightColor: theme['c-border-background'],
            }}
          >
            {listPanel}
          </View>
          <View style={{ flex: 1, overflow: 'hidden' }}>
            {hasActiveList ? (
              <MusicList />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text size={13} color={theme['c-500']}>点击左侧列表查看歌曲</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    )
  }

  // 竖屏详情覆盖层（我的收藏等）可见时，列表面板整棵子树直接不渲染，而不是用
  // display:'none' 藏在覆盖层下面。此前的写法会带来两个副作用：
  // 1) 「歌单列表 FlatList」与「收藏歌曲列表 FlatList」同时挂载，同一个页面里
  //    存在两个 UIScrollView；
  // 2) 每次进出收藏页都要在这棵大子树（含 1 个 FlatList + 5 个浮层组件）上
  //    往返切换 display，反复触发原生视图层级重建。
  // 用户反馈「点我的收藏 → 返回 → 再点我的收藏」后整页只剩列表能滑、其余点击
  // 全部无响应，正是这类反复进出后的 JS 帧驱动停摆表现（原生滚动不依赖 JS，
  // 所以列表仍可滑动；点击、tab 栏、迷你播放器都要经 JS，故全部失效）。
  // 面板数据保存在本组件 state（listInfoMap）里，重新渲染不会丢数据，仅歌单列表
  // 的滚动位置会回到顶部。
  const isDetailOverlayVisible = !isHorizontal && showMusicList

  return (
    <View style={styles.overlayContainer}>
      {isDetailOverlayVisible ? null : listPanel}
      {isDetailOverlayVisible ? (
        <View style={StyleSheet.absoluteFill}>
          <MusicList onBack={handleBackToList} listId={openListIdRef.current ?? undefined} />
          <SwipeBackArea onBack={handleBackToList} />
        </View>
      ) : null}
    </View>
  )
})

const styles = createStyle({
  overlayContainer: {
    position: 'relative',
    flex: 1,
  },
  content: {
    flex: 1,
  },
  listContainer: {
    flex: 1,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: designSpacing.lg,
    marginBottom: designSpacing.xs,
  },
  pageTitle: {
    fontWeight: '800',
    lineHeight: 36,
  },
  cardContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designSpacing.md,
    marginHorizontal: designSpacing.md,
    marginBottom: designSpacing.sm,
    borderRadius: designRadius.md,
    overflow: 'hidden',
  },
  cardContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  artwork: {
    width: 40,
    height: 40,
    borderRadius: designRadius.sm,
  },
  info: {
    flex: 1,
    marginLeft: designSpacing.md,
  },
  listName: {
    fontWeight: '700',
  },
  loading: {
    marginLeft: 10,
  },
  dragHandle: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreBtn: {
    width: 40,
    height: 40,
    marginLeft: designSpacing.xs,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    marginTop: 16,
    marginBottom: 20,
  },
  retryButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: designRadius.pill,
  },
})
