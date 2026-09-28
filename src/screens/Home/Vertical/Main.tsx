import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { Keyboard, View } from 'react-native'
import Search from '../Views/Search'
import Discovery from '../Views/Discovery'
import SongList from '../Views/SongList'
import Mylist from '../Views/Mylist'
import Leaderboard from '../Views/Leaderboard'
import Setting from '../Views/Setting'
import commonState, { type InitState as CommonState } from '@/store/common/state'
import { createStyle } from '@/utils/tools'
import PagerView, {
  type PageScrollStateChangedNativeEvent,
  type PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view'
import { setNavActiveId } from '@/core/common'
import DailyRec from '../Views/DailyRec'
import TXDailyRec from '../Views/DailyRec/TXDailyRec'
import MyPlaylist from '../Views/MyPlaylist'
import FollowedArtists from '../Views/FollowedArtists'
import SubscribedAlbums from '../Views/SubscribedAlbums'
import { NAV_MENUS, type NAV_ID_Type, getEffectiveFlatOrder } from '@/config/constant.ts'
import { useSettingValue } from '@/store/setting/hook.ts'
import { useHomeLazyPage } from '@/utils/hooks'
import PlayHistory from '../Views/PlayHistory'
import WebDAV from '../Views/WebDAV'

import LocalDownload from '../Views/LocalDownload'
import TXPlaylist from '../Views/TxPlaylist'
import KgPlaylist from '../Views/KgPlaylist'
import KgDailyRec from '../Views/KgDailyRec'

const hideKeys = ['list.isShowAlbumName', 'list.isShowInterval'] as Readonly<
Array<keyof LX.AppSetting>
>

const SearchPage = () => (
  useHomeLazyPage('nav_search', () => <Search />)
)
const SongListPage = () => (
  useHomeLazyPage('nav_songlist', () => <SongList />)
)
// 播放历史浮层：容器必须保持透明（只做定位与层级），不去铺不透明主题色底。
// 浮层出现时由 Main 把 PagerView 隐藏，于是浮层直接透出 Home PageContent 已绘制好的背景层，
// 进入瞬间不存在“新解码 + 新模糊一张整屏背景图”的过程，也就没有闪白（详见 PlayHistory 内注释）。
const PlayHistoryOverlay = ({ visible }: { visible: boolean }) => {
  const component = useMemo(() => <PlayHistory />, [])
  return visible ? <View style={styles.historyOverlay}>{component}</View> : null
}

const isMenuVisible = (id: NAV_ID_Type, navStatus: Partial<Record<NAV_ID_Type, boolean>>) => (
  id !== 'nav_play_history' && (id === 'nav_setting' || (navStatus[id] ?? true))
)
const LeaderboardPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_top')
  const component = useMemo(() => <Leaderboard />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_top') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      } else {
        // 离开排行榜页即卸载。此前只置 true 从不置 false，用户进过一次后本页会
        // 永久挂载在 PagerView 中（offscreenPageLimit=1，离屏相邻页仍在内存里），
        // 白白占着一份完整歌曲列表 + 一个左侧 12pt 全高的透明手势层（SwipeBackArea）。
        // 本页无需要跨切页保留的状态：当前榜单由 getLeaderboardSetting 持久化兜底，
        // 重新挂载后按最近一次选择恢复。
        setVisible(false)
      }
    }
    const handleHideByTheme = () => {
      if (currentId != 'nav_top') setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k)) && currentId != 'nav_top') setVisible(false)
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHideByTheme)
    global.state_event.on('languageChanged', handleHideByTheme)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHideByTheme)
      global.state_event.off('languageChanged', handleHideByTheme)
      global.state_event.off('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}

const DailyRecPage = () => (
  useHomeLazyPage('nav_daily_rec', () => <DailyRec />)
)

const TXDailyRecPage = () => (
  useHomeLazyPage('nav_tx_daily_rec', () => <TXDailyRec />)
)

const MylistPage = () => (
  useHomeLazyPage('nav_love', () => <Mylist />)
)

const MyPlaylistPage = () => (
  useHomeLazyPage('nav_my_playlist', () => <MyPlaylist />)
)

const FollowedArtistsPage = () => (
  useHomeLazyPage('nav_followed_artists', () => <FollowedArtists />)
)

const SubscribedAlbumsPage = () => (
  useHomeLazyPage('nav_subscribed_albums', () => <SubscribedAlbums />)
)


const WebDAVPage = () => (
  useHomeLazyPage('nav_webdav', () => <WebDAV />)
)

const LocalDownloadPage = () => (
  useHomeLazyPage('nav_local_download', () => <LocalDownload />)
)

const TXPlaylistPage = () => (
  useHomeLazyPage('nav_tx_playlist', () => <TXPlaylist />)
)

const KgPlaylistPage = () => (
  useHomeLazyPage('nav_kg_playlist', () => <KgPlaylist />)
)

const KgDailyRecPage = () => (
  useHomeLazyPage('nav_kg_daily_rec', () => <KgDailyRec />)
)

const SettingPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_setting')
  const component = useMemo(() => <Setting />, [])
  useEffect(() => {
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      if (id == 'nav_setting') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      } else {
        setVisible(false)
      }
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
    }
  }, [])
  return visible ? component : null
}

const Main = () => {
  const pagerViewRef = useRef<ComponentRef<typeof PagerView>>(null)
  const [, setActiveNavIdState] = useState(commonState.navActiveId)
  const navStatus = useSettingValue('common.navStatus')
  const navOrder = useSettingValue('common.navOrder')
  const navFlatOrder = useSettingValue('common.navFlatOrder')

  // 与功能网格保持同一套“有效顺序”，否则过滤状态不一致时会跳到未挂载页面。
  // 优先使用用户自定义的扁平顺序 navFlatOrder，否则回退 navOrder。
  const effectiveOrder = useMemo(() => getEffectiveFlatOrder(navFlatOrder, navOrder), [navFlatOrder, navOrder])

  const visibleNavs = useMemo(() => {
    return effectiveOrder.filter((id: NAV_ID_Type) => isMenuVisible(id, navStatus)).map((id: NAV_ID_Type) => {
      const menuInfo = NAV_MENUS.find(menu => menu.id === id)
      return menuInfo || { id, icon: 'unknown' }
    })
  }, [navStatus, effectiveOrder])

  const { viewMap, indexMap } = useMemo(() => {
    const viewMap: Partial<Record<NAV_ID_Type, number>> = {}
    const indexMap: NAV_ID_Type[] = []
    visibleNavs.forEach((nav: { id: NAV_ID_Type }, index: number) => {
      viewMap[nav.id] = index
      indexMap.push(nav.id)
    })
    return { viewMap, indexMap }
  }, [visibleNavs])

  const getInitialIndex = () => {
    let idx = viewMap[commonState.navActiveId]
    if (idx == null && visibleNavs.length > 0) {
      idx = 0
    }
    return idx ?? 0
  }
  const activeIndexRef = useRef(getInitialIndex())
  // 播放历史浮层可见性：浮层是覆盖在 PagerView 之上的（不是 PagerView 的一页），
  // 显示期间把 PagerView 隐藏，让浮层透出背景层而不是下面那一页的列表内容。
  // 与原 PlayHistoryOverlay 内部一致地用 requestAnimationFrame 延后一帧，保持既有挂载时机。
  const [isHistoryOverlayVisible, setHistoryOverlayVisible] = useState(commonState.navActiveId == 'nav_play_history')
  useEffect(() => {
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      if (id == 'nav_play_history') {
        requestAnimationFrame(() => { setHistoryOverlayVisible(true) })
      } else {
        setHistoryOverlayVisible(false)
      }
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
    }
  }, [])
  // PagerView 非 idle 状态的兜底恢复定时器（防止 homePagerIdle 卡死在 false）
  const pagerIdleFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (pagerIdleFallbackRef.current) {
        clearTimeout(pagerIdleFallbackRef.current)
        pagerIdleFallbackRef.current = null
      }
    }
  }, [])
  // 页面集（id + 顺序）签名：分组开关 / 侧边栏显隐变化时会改变页面集合。
  // iOS 上对运行中的 PagerView 原位重排子页面并立即 setPage，存在原生侧
  // “index out of bounds” 崩溃（release 下表现为整个 App 白屏）。用 key 让
  // 页面集变化时整体重建 PagerView 实例，initialPage 直接落到当前页，彻底避开该竞争。
  const pagerKey = useMemo(() => `flat|${visibleNavs.map(n => n.id).join('|')}`, [visibleNavs])
  // remount 时的初始页：以当前导航 id 在新顺序中的位置为准
  const initialPageIndex = useMemo(() => viewMap[commonState.navActiveId] ?? 0, [viewMap])

  // pager 的原生真实落点（仅 onPageSelected 更新）与切换重试定时器。
  // 原生偶发丢弃 setPageWithoutAnimation（busy 竞争，无 onPageSelected 回调）时，
  // activeIndexRef 已被乐观写入目标值，若再用它做「是否已切过去」的判断，重试
  // 会被永久跳过——表现为点按钮切页偶发无响应且再点也无效，手动滑动后才恢复。
  const observedIndexRef = useRef(initialPageIndex)
  const pageRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onPageSelected = useCallback(({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    activeIndexRef.current = nativeEvent.position
    // observedIndex 只在原生回调里更新，反映 pager 的真实落点——区别于
    // activeIndexRef 的乐观写入（setPage 前就写目标值）。原生偶发丢弃
    // setPageWithoutAnimation（busy 竞争，无 onPageSelected 回调）时，靠它
    // 识别「切换未生效」并重试，否则再次点击同一按钮会被守卫跳过、永久无响应。
    observedIndexRef.current = nativeEvent.position
    if (pageRetryTimerRef.current) {
      clearTimeout(pageRetryTimerRef.current)
      pageRetryTimerRef.current = null
    }
    const selectedId = indexMap[activeIndexRef.current]
    if (!selectedId) return
    if (selectedId) setActiveNavIdState(selectedId)
    // 播放历史是抽屉底部入口调起的全屏浮层，不属于 PagerView 页面；
    // 用户 swipe 切页时不应把它覆盖回我的列表。
    if (commonState.navActiveId !== 'nav_play_history' && activeIndexRef.current !== viewMap[commonState.navActiveId]) {
      setNavActiveId(selectedId)
    }
  }, [indexMap, viewMap])

  const onPageScrollStateChanged = useCallback(
    ({ nativeEvent }: PageScrollStateChangedNativeEvent) => {
      Keyboard.dismiss()
      if (nativeEvent.pageScrollState == 'idle') {
        if (pagerIdleFallbackRef.current) {
          clearTimeout(pagerIdleFallbackRef.current)
          pagerIdleFallbackRef.current = null
        }
        if (!global.lx.homePagerIdle) global.lx.homePagerIdle = true
      } else {
        // 兜底：setPageWithoutAnimation 切页期间可能丢失配对的 idle 事件，
        // homePagerIdle 会永久停留在 false，列表点击被静默吞掉（表现为点了没反应）。
        // 800ms 内未收到 idle 则强制恢复。
        if (pagerIdleFallbackRef.current) clearTimeout(pagerIdleFallbackRef.current)
        pagerIdleFallbackRef.current = setTimeout(() => {
          pagerIdleFallbackRef.current = null
          global.lx.homePagerIdle = true
        }, 800)
      }
    },
    [],
  )

  useEffect(() => {
    // 播放历史是浮层，不是 PagerView 的页面；visibleNavs 变化时不要把它重置到第一页
    if (commonState.navActiveId === 'nav_play_history') return
    let index = viewMap[commonState.navActiveId]
    if (index == null && visibleNavs.length > 0) {
      index = 0
      activeIndexRef.current = index
      if (visibleNavs[0]) {
        setNavActiveId(visibleNavs[0].id)
      }
    } else if (index != null) {
      // 防御：索引必须在当前页面集范围内，避免对原生 pager 下发越界页码
      if (index >= visibleNavs.length) return
      activeIndexRef.current = index
      pagerViewRef.current?.setPageWithoutAnimation(index)
    }
  }, [viewMap, visibleNavs])

  useEffect(() => {
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.includes('common.navStatus')) {
        // 播放历史是浮层，不在可见菜单列表里，但不应被导航状态变更重置
        if (commonState.navActiveId === 'nav_play_history') return
        const isActiveVisible = isMenuVisible(commonState.navActiveId, navStatus)
        if (!isActiveVisible && visibleNavs.length > 0) {
          setNavActiveId(visibleNavs[0].id)
        }
      }
    }
    global.state_event.on('configUpdated', handleConfigUpdated)
    return () => {
      global.state_event.off('configUpdated', handleConfigUpdated)
    }
  }, [navStatus, visibleNavs])

  useEffect(() => {
    const handleUpdate = (id: CommonState['navActiveId']) => {
      setActiveNavIdState(id)
      // 播放历史是浮层，切到它时不要同步 PagerView 页面，否则 setPageWithoutAnimation(0)
      // 会触发 onPageSelected，进而把 navActiveId 又覆盖成我的列表。
      if (id === 'nav_play_history') return
      let index = viewMap[id]
      if (index == null && visibleNavs.length > 0) {
        index = 0
      }
      // 防御：索引必须在当前页面集范围内，避免对原生 pager 下发越界页码
      if (index != null && index < visibleNavs.length) {
        activeIndexRef.current = index
        // 用原生真实落点（observedIndexRef）判断是否需要切换：原生偶发丢弃
        // setPageWithoutAnimation 时，靠下面的重试把页面真正切过去
        if (observedIndexRef.current === index) {
          if (pageRetryTimerRef.current) {
            clearTimeout(pageRetryTimerRef.current)
            pageRetryTimerRef.current = null
          }
          return
        }
        pagerViewRef.current?.setPageWithoutAnimation(index)
        // 重试链：400ms / 900ms 两次校验原生落点，未达目标则带动画重发 setPage。
        // onPageSelected 到达即清链（observedIndexRef === index）。
        if (pageRetryTimerRef.current) clearTimeout(pageRetryTimerRef.current)
        const armRetry = (delay: number, attempt: number) => {
          pageRetryTimerRef.current = setTimeout(() => {
            pageRetryTimerRef.current = null
            if (observedIndexRef.current === index) return
            pagerViewRef.current?.setPage(index)
            if (attempt < 2) armRetry(500, attempt + 1)
          }, delay)
        }
        armRetry(400, 1)
      }
    }

    global.state_event.on('navActiveIdUpdated', handleUpdate)
    return () => {
      global.state_event.off('navActiveIdUpdated', handleUpdate)
      if (pageRetryTimerRef.current) {
        clearTimeout(pageRetryTimerRef.current)
        pageRetryTimerRef.current = null
      }
    }
  }, [viewMap, visibleNavs])

  const pages = useMemo(() => {
    const pageComponents: Partial<Record<NAV_ID_Type, ReactNode>> = {
      nav_discovery: <Discovery />,
      nav_search: <SearchPage />,
      nav_songlist: <SongListPage />,
      nav_top: <LeaderboardPage />,
      nav_love: <MylistPage />,
      nav_daily_rec: <DailyRecPage />,
      nav_tx_daily_rec: <TXDailyRecPage />,
      nav_followed_artists: <FollowedArtistsPage />,
      nav_subscribed_albums: <SubscribedAlbumsPage />,
      nav_my_playlist: <MyPlaylistPage />,
      nav_webdav: <WebDAVPage />,
      nav_local_download: <LocalDownloadPage />,
      nav_tx_playlist: <TXPlaylistPage />,
      nav_kg_playlist: <KgPlaylistPage />,
      nav_kg_daily_rec: <KgDailyRecPage />,
      nav_setting: <SettingPage />,
    }

    return visibleNavs.map((nav: { id: NAV_ID_Type }) => (
      <View collapsable={false} key={nav.id} style={styles.pageStyle}>
        {pageComponents[nav.id] ?? null}
      </View>
    ))
  }, [visibleNavs])

  return (
    <View style={styles.container}>
      <PagerView
        key={pagerKey}
        ref={pagerViewRef}
        initialPage={initialPageIndex}
        offscreenPageLimit={1}
        onPageSelected={onPageSelected}
        onPageScrollStateChanged={onPageScrollStateChanged}
        // 首页横向滚动功能已移除：页面固定，仅通过底部 tab / 侧边栏切换
        scrollEnabled={false}
        // 播放历史浮层显示时整体隐藏（仅改透明度：页面仍挂载，返回后滚动位置/状态不丢），
        // 让浮层透出 Home 已经绘制好的背景层，既有背景不会被下面的列表内容干扰。
        style={isHistoryOverlayVisible ? styles.pagerViewHidden : styles.pagerView}
      >
        {pages}
      </PagerView>
      <PlayHistoryOverlay visible={isHistoryOverlayVisible} />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
    // 底部内边距：给悬浮的迷你播放器留出空间，避免列表最后一行被胶囊盖住。
    // 数值 = wrapper paddingTop 4 + 容器内边距 20 + 内容区约 46 + 进度条 3 ≈ 73，取 80 留余量。
    paddingBottom: 0,
  },
  pagerView: {
    flex: 1,
    overflow: 'hidden',
  },
  pagerViewHidden: {
    flex: 1,
    overflow: 'hidden',
    opacity: 0,
  },
  historyOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
    // iOS-only 项目，移除 Android 专属的 elevation，避免 iOS 侧样式/层级歧义
  },
  pageStyle: {
    // alignItems: 'center',
    // padding: 20,
  },
})

export default Main
