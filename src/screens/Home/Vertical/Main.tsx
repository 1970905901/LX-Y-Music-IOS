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
import { NAV_MENUS, NAV_COOKIE_GATED_IDS, type NAV_ID_Type, getEffectiveFlatOrder } from '@/config/constant.ts'
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

/**
 * PagerView 兜底重建的会话上限。
 * 背景：后台恢复后原生 pager 可能失效（setPage* 变空操作），而首页 disable 了横向滑动，
 * 页面只能靠 JS 切页 → 点了按钮没反应。重试链全失败时换 key 重建原生实例来修复。
 * 每次重建都会重挂载整棵页面树（各页丢失滚动位置与本地 state），故设上限 + 防抖：
 * 只当"确实坏了"才修，且修不好也不要被连点拖成反复重建。
 */
const MAX_PAGER_REBUILDS = 3
const PAGER_REBUILD_DEBOUNCE_MS = 3000

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

// 平台在线内容入口（我的歌单 / 平台歌单 / 关注歌手 / 收藏专辑）需对应 Cookie 登录后
// 才出现；规则与推荐页功能网格共用 NAV_COOKIE_GATED_IDS，避免两处不一致。
const isMenuVisible = (
  id: NAV_ID_Type,
  navStatus: Partial<Record<NAV_ID_Type, boolean>>,
  cookieOk: Partial<Record<NAV_ID_Type, boolean>>,
) => (
  id !== 'nav_play_history' &&
  (id === 'nav_setting' || ((navStatus[id] ?? true) && (cookieOk[id] ?? true)))
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
  const wyCookie = useSettingValue('common.wy_cookie')
  const kgCookie = useSettingValue('common.kg_cookie')
  const txCookie = useSettingValue('common.tx_cookie')
  const cookieOk = useMemo(() => {
    const cookies: Record<string, string> = {
      'common.wy_cookie': wyCookie,
      'common.kg_cookie': kgCookie,
      'common.tx_cookie': txCookie,
    }
    const result: Partial<Record<NAV_ID_Type, boolean>> = {}
    for (const [id, key] of Object.entries(NAV_COOKIE_GATED_IDS)) {
      if (key) result[id as NAV_ID_Type] = !!cookies[key]
    }
    return result
  }, [wyCookie, kgCookie, txCookie])

  // 与功能网格保持同一套“有效顺序”，否则过滤状态不一致时会跳到未挂载页面。
  // 优先使用用户自定义的扁平顺序 navFlatOrder，否则回退 navOrder。
  const effectiveOrder = useMemo(() => getEffectiveFlatOrder(navFlatOrder, navOrder), [navFlatOrder, navOrder])

  const visibleNavs = useMemo(() => {
    return effectiveOrder.filter((id: NAV_ID_Type) => isMenuVisible(id, navStatus, cookieOk)).map((id: NAV_ID_Type) => {
      const menuInfo = NAV_MENUS.find(menu => menu.id === id)
      return menuInfo || { id, icon: 'unknown' }
    })
  }, [navStatus, effectiveOrder, cookieOk])

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
      if (clearLastIssuedIndexRef.current) {
        clearTimeout(clearLastIssuedIndexRef.current)
        clearLastIssuedIndexRef.current = null
      }
    }
  }, [])
  // 页面集（id + 顺序）签名：分组开关 / 侧边栏显隐变化时会改变页面集合。
  // iOS 上对运行中的 PagerView 原位重排子页面并立即 setPage，存在原生侧
  // “index out of bounds” 崩溃（release 下表现为整个 App 白屏）。用 key 让
  // 页面集变化时整体重建 PagerView 实例，initialPage 直接落到当前页，彻底避开该竞争。
  const pagerKey = useMemo(() => `flat|${visibleNavs.map(n => n.id).join('|')}`, [visibleNavs])
  // ---- PagerView 实例兜底重建（2026-09-30）----
  // 场景：播放中把 App 放后台一段时间再回前台，iOS 会回收/重建 PagerView 的原生子视图，
  // 此后所有 setPage* 都变成空操作。而首页横向滑动是关闭的（scrollEnabled=false），
  // 页面**只能**靠 JS 切 → 表现为「点榜单卡片/平台按钮没反应，列表照样能上下滚」。
  // （core/common.ts 的 forceSyncNavActiveId 注释记录的正是这个场景，那次补的是
  //  「再下发一次 setPage」；原生实例真失效时 setPage 再发也是空操作，所以仍无效。）
  // 兜底：重试链全部失败（原生始终没回报到达目标页）时换 key 重建实例，
  // initialPage 直接落到目标页。只在"已经坏掉"的路径上触发，正常切页零影响。
  const [pagerRebuild, setPagerRebuild] = useState(0)
  const rebuildTargetRef = useRef<number | null>(null)

  // remount 时的初始页：优先用兜底重建请求记录的目标页（原生已失效时，navActiveId 与
  // 界面落点已经对不上，只有这个记录是可靠的），其次按当前导航 id 在新顺序中的位置。
  // 依赖 pagerRebuild：重建后必须重算，否则 initialPage 还是旧值、重建也落错页。
  const initialPageIndex = useMemo(() => {
    const target = rebuildTargetRef.current
    if (pagerRebuild > 0 && target != null && target >= 0 && target < visibleNavs.length) return target
    return viewMap[commonState.navActiveId] ?? 0
  }, [viewMap, visibleNavs.length, pagerRebuild])

  // pager 的原生真实落点（仅 onPageSelected 更新）与切换重试定时器。
  // 原生偶发丢弃 setPageWithoutAnimation（busy 竞争，无 onPageSelected 回调）时，
  // activeIndexRef 已被乐观写入目标值，若再用它做「是否已切过去」的判断，重试
  // 会被永久跳过——表现为点按钮切页偶发无响应且再点也无效，手动滑动后才恢复。
  const observedIndexRef = useRef(initialPageIndex)
  const pageRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 本 tick 内已经下发过 setPage 的目标 index。用于让「常规切页 + 紧随其后的强制
  // 同步」（点在榜单卡片上的调用序）只真正下发一次 setPage，避免重复驱动原生切换
  // 造成可见抖动。
  // 必须按 tick 失效：这两个调用的事件都是微任务、在同一批里连续到达；若标记跨批
  // 残留，会把后续本该执行的强制同步误判为重复而跳过（那样修复就失效了）。
  // 因此在下发 setPage 后用一个 0ms 宏任务把它清掉——微任务批先跑完，宏任务才清。
  const lastIssuedIndexRef = useRef<number | null>(null)
  const clearLastIssuedIndexRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const markIssuedIndex = (index: number) => {
    lastIssuedIndexRef.current = index
    if (clearLastIssuedIndexRef.current) clearTimeout(clearLastIssuedIndexRef.current)
    clearLastIssuedIndexRef.current = setTimeout(() => {
      clearLastIssuedIndexRef.current = null
      lastIssuedIndexRef.current = null
    }, 0)
  }

  // ---- 兜底重建的执行体（状态声明见上，须先于 initialPageIndex）----
  const rebuildCountRef = useRef(0)
  const lastRebuildAtRef = useRef(0)
  const repairPager = useCallback((index: number) => {
    const now = Date.now()
    // 防抖 + 上限：连点或走多个入口时不重复重建；一次会话最多 3 次，
    // 避免"重建也没修好"时被用户连点触发连续重建（每次都会重挂载整棵页面树）。
    if (now - lastRebuildAtRef.current < PAGER_REBUILD_DEBOUNCE_MS) return
    if (rebuildCountRef.current >= MAX_PAGER_REBUILDS) return
    rebuildCountRef.current += 1
    lastRebuildAtRef.current = now
    rebuildTargetRef.current = index
    // 新实例挂载前后的这段窗口里，原生落点未知：置 -1 让守卫的乐观短路全部失效
    observedIndexRef.current = -1
    activeIndexRef.current = index
    setPagerRebuild(v => v + 1)
  }, [])

  const onPageSelected = useCallback(({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    activeIndexRef.current = nativeEvent.position
    // observedIndex 只在原生回调里更新，反映 pager 的真实落点——区别于
    // activeIndexRef 的乐观写入（setPage 前就写目标值）。原生偶发丢弃
    // setPageWithoutAnimation（busy 竞争，无 onPageSelected 回调）时，靠它
    // 识别「切换未生效」并重试，否则再次点击同一按钮会被守卫跳过、永久无响应。
    observedIndexRef.current = nativeEvent.position
    // 原生已回报落点 ⇒ 兜底重建的"目标页"使命结束，后续 remount 回到常规口径
    rebuildTargetRef.current = null
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
        const isActiveVisible = isMenuVisible(commonState.navActiveId, navStatus, cookieOk)
        if (!isActiveVisible && visibleNavs.length > 0) {
          setNavActiveId(visibleNavs[0].id)
        }
      }
    }
    global.state_event.on('configUpdated', handleConfigUpdated)
    return () => {
      global.state_event.off('configUpdated', handleConfigUpdated)
    }
  }, [navStatus, visibleNavs, cookieOk])

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
        // 本页是否就是「强制同步」的目标页。forceSyncNavActiveId() 重新广播的是
        // **当前** navActiveId，所以只有 id 与 commonState.navActiveId 一致的那次
        // 回调才算「强制同步请求」，其余（例如调用方紧邻的 setNavActiveId 触发的那次）
        // 是常规切页，不应消费该标记。
        const isForceSync = global.lx.homePagerForceSync && id === commonState.navActiveId
        // 用原生真实落点（observedIndexRef）判断是否需要切换：原生偶发丢弃
        // setPageWithoutAnimation 时，靠下面的重试把页面真正切过去。
        //
        // 但 observedIndexRef 可能是**乐观值**（初始化为 initialPageIndex，由
        // navActiveId 推导，从未经原生确认），App 从后台恢复、PagerView 原生子视图
        // 被重建后它更可能整体失真。若只凭它 `=== index` 就提前 return，会把
        // 「界面其实停在别的页」当成「已经在目标页」，切页被永久跳过。
        // 因此对「强制同步」请求一律真正下发一次 setPage，并让 onPageSelected 的
        // 回执刷新 observedIndexRef；只有常规请求才沿用乐观短路。
        if (!isForceSync && observedIndexRef.current === index) {
          if (pageRetryTimerRef.current) {
            clearTimeout(pageRetryTimerRef.current)
            pageRetryTimerRef.current = null
          }
          return
        }
        // 同一批事件里已经为该 index 下发过 setPage 时不再重复（见
        // lastIssuedIndexRef 注释）：这一支只可能是紧随常规切页而来的强制同步。
        if (isForceSync && lastIssuedIndexRef.current === index) {
          global.lx.homePagerForceSync = false
          return
        }
        // 强制标记是一次性的：消费后立即复位，避免后续常规切页都绕开短路。
        if (isForceSync) {
          global.lx.homePagerForceSync = false
          // 强制同步必须真正驱动一次原生切换：把原生落点标记为「未知」，
          // 使下面重试链的首个校验不会因为乐观值恰好相等而提前判定成功。
          observedIndexRef.current = -1
        }
        markIssuedIndex(index)
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
            // 两次重试都换不来 onPageSelected 回执（原生落点既非目标、也不回执）：
            // 判定为「原生 pager 实例已失效」，setPage 再发也是空操作 —— 重建实例。
            // 时序：点击 → 0/400/900ms 三次 setPage → 约 1.4s 后重建并落到目标页。
            else repairPager(index)
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
  }, [viewMap, visibleNavs, repairPager])

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
        // pagerRebuild：兜底重建计数。原生实例在后台恢复后可能失效（见 repairPager 注释），
        // 换 key 让 RN 重建原生 PagerView，initialPage 落到目标页。
        key={`${pagerKey}#${pagerRebuild}`}
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
