import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackHandler, Keyboard, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native'
import { getDiscoveryPlatformOrder, type NAV_ID_Type } from '@/config/constant'
import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight, useSafeAreaTop, useBottomOverlayInset } from '@/store/common/hook'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { forceSyncNavActiveId, setNavActiveId } from '@/core/common'
import { createStyle, toast } from '@/utils/tools'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import songlistState, { type ListInfoItem, type Source } from '@/store/songlist/state'
import settingState from '@/store/setting/state'
import boardState, { type BoardItem } from '@/store/leaderboard/state'
import { getList } from '@/core/songlist'
import { getBoardsList } from '@/core/leaderboard'
import { shouldRefreshByTtl } from '@/core/refreshThrottle'
import { saveLeaderboardSettingSync } from '@/utils/data'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import PlatformChips from '@/components/home/PlatformChips'
import DailyRecommendCard from '@/components/home/DailyRecommendCard'
import HorizontalShelf from '@/components/home/HorizontalShelf'
import SonglistDetail from '../../../SonglistDetail'
import { rememberHomeSubView, clearHomeSubView, takeRestorableSubView } from '@/core/homeSubView'

// 每日推荐入口与「首页推荐平台」联动：网易/酷狗/QQ 有每日推荐页，
// 进入前要求对应平台的 Cookie 已登录；酷我/咪咕无每日推荐页，隐藏入口。
const DAILY_REC_NAVS: Partial<Record<Source, NAV_ID_Type>> = {
  wy: 'nav_daily_rec',
  kg: 'nav_kg_daily_rec',
  tx: 'nav_tx_daily_rec',
}

const DAILY_REC_COOKIE_KEYS: Partial<Record<Source, 'common.wy_cookie' | 'common.kg_cookie' | 'common.tx_cookie'>> = {
  wy: 'common.wy_cookie',
  kg: 'common.kg_cookie',
  tx: 'common.tx_cookie',
}

const getSortId = (source: Source) => songlistState.sortList[source]?.[0]?.id ?? ''

const styles = createStyle({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 180,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: designSpacing.lg,
    marginBottom: designSpacing.md,
  },
  title: {
    fontWeight: '800',
  },
  historyButton: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionGap: {
    marginTop: designSpacing.lg,
  },
  chips: {
    marginTop: designSpacing.md,
  },
  daily: {
    marginTop: designSpacing.lg,
    paddingHorizontal: designSpacing.lg,
  },
  platformTitle: {
    paddingHorizontal: designSpacing.lg,
  },
  sectionTitle: {
    paddingHorizontal: designSpacing.lg,
    fontWeight: '800',
  },
  boardContent: {
    paddingHorizontal: designSpacing.lg,
    gap: designSpacing.sm,
    marginTop: designSpacing.md,
  },
  boardCard: {
    width: 92,
    minHeight: 64,
    borderRadius: designRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: designSpacing.xs,
    paddingHorizontal: designSpacing.sm,
    paddingVertical: designSpacing.xs,
  },
  // 宽屏两行网格里的榜单卡：一行 4 个（23%×4 + 3×gap12 ≈ 内容宽 92%+36，
  // 平台间窄差距 8pt 以内），高度略增保持图标+两行字的呼吸感
  boardCardWide: {
    width: '23%',
    minHeight: 72,
  },
  // 宽屏并排行：日推卡（左）+ 榜单区（右），各自垂直居中
  wideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designSpacing.sm,
  },
  wideDaily: {
    flex: 1,
    paddingLeft: designSpacing.lg,
    justifyContent: 'center',
  },
  wideBoards: {
    flex: 1.6,
  },
  boardGrid: {
    marginTop: designSpacing.md,
    paddingHorizontal: designSpacing.lg,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: designSpacing.sm,
  },
  boardName: {
    textAlign: 'center',
    fontWeight: '600',
  },
  status: {
    textAlign: 'center',
    marginTop: designSpacing.lg,
  },
})

export default memo(() => {
  const theme = useTheme()
  const statusBarHeight = useStatusbarHeight()
  // 列表被 RN 自动叠加的安全区顶部插图（固定页比较一屏是否放得下时要用）
  const safeAreaTop = useSafeAreaTop()
  // 底部悬浮层（迷你播放器 + 底部 Tab + 安全区）统一避让高度
  const bottomInset = useBottomOverlayInset()
  // 宽屏判定（iPad 竖屏 768+ / iPad 横屏右栏；iPhone 全系 < 700 不受影响）：
  // 宽屏下「每日推荐 + 榜单」并排一行、榜单改两行网格、歌单卡加大 —— 单列布局
  // 在大屏上内容高度只占屏幕一半上下，观感偏空（AGENTS.md 大屏规范：多列/分栏）。
  const { width: winWidth } = useWindowDimensions()
  const isWide = winWidth >= 700
  const t = useI18n()
  const sourceNameType = useSettingValue('common.sourceNameType')
  // 平台文案走全局语言包别名（source_${sourceNameType}_${source}），与歌单页等处的显示一致
  const sourceLabel = useCallback(
    (source: string) => t(`source_${sourceNameType}_${source}`),
    [sourceNameType, t],
  )
  const supportedSources = useMemo(
    () => songlistState.sources.filter(
      (source): source is Source => !!songlistState.sortList[source]?.length,
    ),
    [],
  )
  // 平台按钮顺序跟随「设置 → 列表设置」里的排序；排在第一位的平台为默认选中平台
  const platformOrder = useSettingValue('common.discoveryPlatformOrder')
  const orderedSources = useMemo(
    () => getDiscoveryPlatformOrder(supportedSources, platformOrder),
    [supportedSources, platformOrder],
  )
  const [selectedSource, setSelectedSource] = useState<Source>((orderedSources[0] as Source) ?? 'kw')
  // 排序变化时选中平台跟随新的第一位，避免改完设置仍停留在旧平台
  useEffect(() => {
    const first = orderedSources[0] as Source | undefined
    if (first) setSelectedSource(first)
  }, [orderedSources])
  const platformOptions = useMemo(
    () => orderedSources.map((source) => ({ id: source, label: sourceLabel(source) })),
    [orderedSources, sourceLabel],
  )
  const [playlists, setPlaylists] = useState<ListInfoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPlaylist, setSelectedPlaylist] = useState<ListInfoItem | null>(null)
  const selectedPlaylistRef = useRef(selectedPlaylist)
  selectedPlaylistRef.current = selectedPlaylist
  const loadIdRef = useRef(0)
  // 固定页（不可上下滑动）需要的两个实测尺寸：视口高度 + 内容高度。
  const [scrollViewportHeight, setScrollViewportHeight] = useState(0)
  const [scrollContentHeight, setScrollContentHeight] = useState(0)
  const [boards, setBoards] = useState<BoardItem[]>([])
  const boardsLoadIdRef = useRef(0)

  const loadPlaylists = useCallback(async(source: Source) => {
    const currentLoadId = ++loadIdRef.current
    setLoading(true)
    try {
      // 不落盘缓存；刷新时机 = 冷启动后首次进入/切换必刷，之后满 1 小时才再刷（core/refreshThrottle）
      const isRefresh = shouldRefreshByTtl(`square|discovery|${source}`)
      const result = await getList(source, '', getSortId(source), 1, isRefresh)
      if (currentLoadId !== loadIdRef.current) return
      setPlaylists(result.list.map((item) => ({ ...item, source })))
    } catch (error: any) {
      if (currentLoadId !== loadIdRef.current) return
      setPlaylists([])
      toast(String(error?.message || t('load_failed')))
    } finally {
      if (currentLoadId === loadIdRef.current) setLoading(false)
    }
  }, [t])

  const loadBoards = useCallback(async(source: Source) => {
    const currentLoadId = ++boardsLoadIdRef.current
    try {
      // 刷新时机由 core/leaderboard 内部按「冷启动首点必刷 + 1 小时 TTL」统一判定
      const boardList = await getBoardsList(source)
      if (currentLoadId !== boardsLoadIdRef.current) return
      setBoards(boardList)
    } catch {
      if (currentLoadId !== boardsLoadIdRef.current) return
      setBoards([])
    }
  }, [])

  useEffect(() => {
    void loadPlaylists(selectedSource)
  }, [loadPlaylists, selectedSource])

  const leaderboardSource = boardState.sources.includes(selectedSource)
    ? selectedSource
    : boardState.sources[0] ?? 'kw'

  useEffect(() => {
    void loadBoards(leaderboardSource)
  }, [leaderboardSource, loadBoards])


  const handleOpenDetail = useCallback((item: ListInfoItem) => {
    setSelectedPlaylist(item)
    rememberHomeSubView(item, 'nav_discovery')
  }, [])

  const handleCloseDetail = useCallback(() => {
    setSelectedPlaylist(null)
    clearHomeSubView()
  }, [])

  // 退出恢复：上次在推荐页打开了某张歌单详情，进入本页直接恢复
  useEffect(() => {
    void takeRestorableSubView('nav_discovery').then((info) => {
      if (info) setSelectedPlaylist(info)
    })
  }, [])

  useEffect(() => {
    const onBackPress = () => {
      if (selectedPlaylistRef.current) {
        setSelectedPlaylist(null)
        clearHomeSubView()
        return true
      }
      return false
    }
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress)
    return () => { subscription.remove() }
  }, [])

  // 点榜单卡片进入排行榜页对应榜单：
  // 1) 持久化 source + boardId —— 排行榜页首次挂载时读取该设置兜底；
  // 2) 发出 showBoardDetail 事件 —— 排行榜页已挂载（切页不卸载）时实时切换到目标榜单。
  const handleOpenBoard = useCallback((board: BoardItem) => {
    // 必须用【同步】写入内存缓存：此前是 `await saveLeaderboardSetting(...)` 再切页，
    // 而该函数首次调用要先 await 一次真实存储读取（AsyncStorage I/O），切页因此被
    // 推迟到 I/O 之后；这段时间没有任何 UI 反馈，用户表现为「点了排行榜按钮有时
    // 没反应」（等待期间再点一次还会叠加两次切页）。同步写入后立即切页，响应确定；
    // 磁盘落盘仍由内部 1000ms throttle 异步完成，挂载时读到的也是刚写入的值。
    saveLeaderboardSettingSync({ source: leaderboardSource, boardId: board.id })
    // 事件 + 切页都保留：
    // - 事件（emit 基于 queueMicrotask，必定早于切页后的 rAF 挂载）在「本页尚未挂载」
    //   时会被丢弃，故排行榜页挂载时会读 getLeaderboardSetting 兜底——写入已同步完成，
    //   兜底读到的一定是本次目标榜单；
    // - 事件在「本页已挂载」时（例如已进入排行榜页后又被唤起）负责实时切榜。
    global.app_event.showBoardDetail({ source: leaderboardSource, boardId: board.id })
    // 先走常规切页，再无条件请求 PagerView 同步到 nav_top。
    //
    // 顺序很关键：forceSyncNavActiveId 重新广播的是**当前** navActiveId，所以要先把
    // 目标 id 落定（setNavActiveId），否则它会先强制切到「点之前那一页」再切到
    // 排行榜，多一次可见的抖动。
    //
    // 为什么必须补一次强制同步：setNavActiveId 有同值短路（id 相同直接 return、
    // 不发事件），而 PagerView 的原生落点可能已与 navActiveId 失配 —— 最典型的是
    // App 从后台恢复后 iOS 重建了 PagerView 的原生子视图、原生落点回到第 0 页
    // （推荐页），但 navActiveId 仍是后台前的 'nav_top'。此时用户在推荐页点榜单卡片
    // → setNavActiveId('nav_top') 被短路 → PagerView 永不校正 → 「点了没反应」
    // （该行横向滚动是原生的，仍能滑）。forceSyncNavActiveId 不受同值短路影响，
    // 会让 Main 真正下发一次 setPage，并要求 onPageSelected 回执刷新「原生真实
    // 落点」，从而把界面校正到排行榜页。
    setNavActiveId('nav_top')
    forceSyncNavActiveId()
  }, [leaderboardSource])

  // 每日推荐入口跟随平台切换；进入前校验对应平台 Cookie 是否已登录
  const dailyRecNav = DAILY_REC_NAVS[selectedSource]
  const handleOpenDailyRec = useCallback(() => {
    const nav = DAILY_REC_NAVS[selectedSource]
    if (!nav) return
    const cookieKey = DAILY_REC_COOKIE_KEYS[selectedSource]
    const logged = cookieKey ? !!settingState.setting[cookieKey] : false
    if (!logged) {
      toast(`请先登录${sourceLabel(selectedSource)}账号（设置 → 平台设置）`)
      return
    }
    setNavActiveId(nav)
  }, [selectedSource, sourceLabel])

  const headerStyle = useMemo(
    () => StyleSheet.compose(styles.header, {
      paddingTop: Math.max(designSpacing.sm, statusBarHeight - designSpacing.md),
    }),
    [statusBarHeight],
  )

  const titleStyle = useMemo(
    () => StyleSheet.compose(styles.title, {
      color: theme['c-font'],
      // 不写死 lineHeight：fontSize 随 app 字号缩放（setSpText），行高小于字高时
      // 大标题顶部笔画会被裁掉；交给系统按字体度量计算行高，任何字号下都完整显示。
    }),
    [theme],
  )

  const historyButtonStyle = useMemo(
    () => StyleSheet.compose(styles.historyButton, {
      backgroundColor: theme['c-primary-background'],
    }),
    [theme],
  )

  // 歌单横架数据：12 → 24（getList 第 1 页本身 ~30 条，不产生额外请求）。
  // 大屏首屏可见卡数多（宽屏 168pt 卡 ≈ 每屏 5~6 张），12 张一滑到底显空。
  const shelfData = useMemo(() => playlists.slice(0, 24), [playlists])
  const shelfCardWidth = isWide ? 168 : 132

  // 推荐页固定（不可上下滑动）：内容一屏放得下时关掉纵向滚动与回弹，整页不动；
  // 只有小屏 / 超大字号真放不下时才留纵向滚动兜底，避免「推荐歌单」被裁掉看不到。
  // 比较口径：contentSize 含 contentContainerStyle 的 paddingBottom(=bottomInset，
  // 为底部悬浮层预留)，先减掉它还原「可见内容高度」；列表还会被 RN 自动叠加
  // 一份安全区顶部插图（contentInset.top = safeAreaTop），这部分也算进占用高度。
  const canScrollVertically = useMemo(
    () => scrollViewportHeight > 0 &&
      scrollContentHeight - bottomInset + safeAreaTop > scrollViewportHeight + 1,
    [scrollContentHeight, scrollViewportHeight, bottomInset, safeAreaTop],
  )
  const handleScrollLayout = useCallback((e: LayoutChangeEvent) => {
    setScrollViewportHeight(e.nativeEvent.layout.height)
  }, [])
  const handleContentSizeChange = useCallback((_contentWidth: number, contentHeight: number) => {
    setScrollContentHeight(contentHeight)
  }, [])

  const renderBoardCard = useCallback((board: BoardItem, wide: boolean) => (
    <TouchableOpacity
      key={board.id}
      style={{
        ...styles.boardCard,
        ...(wide ? styles.boardCardWide : null),
        backgroundColor: theme['c-primary-light-900-alpha-200'],
        borderColor: theme['c-border-background'],
      }}
      onPress={() => { handleOpenBoard(board) }}
    >
      <Icon name="leaderboard" size={18} color={theme['c-primary']} />
      <Text
        style={styles.boardName}
        numberOfLines={2}
        size={designTypography.caption}
        color={theme['c-font']}
      >
        {board.name}
      </Text>
    </TouchableOpacity>
  ), [theme, handleOpenBoard])

  return (
    <View style={styles.container}>
      <ScrollView
        style={selectedPlaylist ? { opacity: 0 } : null}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset }]}
        onScrollBeginDrag={Keyboard.dismiss}
        showsVerticalScrollIndicator={false}
        pointerEvents={selectedPlaylist ? 'none' : 'auto'}
        delaysContentTouches={false}
        // 固定页：内容放得下时禁止纵向滚动与回弹（整页固定不动），放不下才放开
        scrollEnabled={canScrollVertically}
        bounces={canScrollVertically}
        alwaysBounceVertical={false}
        onLayout={handleScrollLayout}
        onContentSizeChange={handleContentSizeChange}
      >
        <View style={headerStyle}>
          <Text style={titleStyle} size={34}>{t('nav_discovery')}</Text>
          <TouchableOpacity
            style={historyButtonStyle}
            onPress={() => { setNavActiveId('nav_play_history') }}
          >
            <Icon name="music_time" size={21} color={theme['c-primary']} />
          </TouchableOpacity>
        </View>

        <View style={styles.chips}>
          <PlatformChips
            options={platformOptions}
            selectedId={selectedSource}
            onChange={(id) => { setSelectedSource(id as Source) }}
          />
        </View>

        {isWide ? (
          // 宽屏（iPad 竖屏/横屏）：日推卡（左，垂直居中）与榜单两行网格（右）
          // 并排一行，填补单列布局在大屏上的宽度留白；榜单铺 8 个（2×4），
          // 全部榜单仍从底部 Tab「排行榜」进入
          <View style={[styles.sectionGap, styles.wideRow]}>
            {dailyRecNav ? (
              <View style={styles.wideDaily}>
                <DailyRecommendCard
                  title={t('discovery_daily_title')}
                  subtitle={t('discovery_daily_subtitle')}
                  onPress={handleOpenDailyRec}
                />
              </View>
            ) : null}
            {boards.length ? (
              <View style={styles.wideBoards}>
                <Text
                  style={styles.sectionTitle}
                  size={designTypography.title}
                  color={theme['c-font']}
                >
                  {t('nav_top')}
                </Text>
                <View style={styles.boardGrid}>
                  {boards.slice(0, 8).map((board) => renderBoardCard(board, true))}
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          <>
            {dailyRecNav ? (
              <View style={styles.daily}>
                <DailyRecommendCard
                  title={t('discovery_daily_title')}
                  subtitle={t('discovery_daily_subtitle')}
                  onPress={handleOpenDailyRec}
                />
              </View>
            ) : null}

            {boards.length ? (
              <View style={styles.sectionGap}>
                <Text
                  style={styles.sectionTitle}
                  size={designTypography.title}
                  color={theme['c-font']}
                >
                  {t('nav_top')}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  delaysContentTouches={false}
                  contentContainerStyle={styles.boardContent}
                >
                  {boards.map((board) => renderBoardCard(board, false))}
                </ScrollView>
              </View>
            ) : null}
          </>
        )}

        <View style={styles.sectionGap}>
          <HorizontalShelf
            title={t('discovery_playlists_title')}
            data={shelfData}
            cardWidth={shelfCardWidth}
            onPressItem={handleOpenDetail}
          />
        </View>

        {loading ? (
          <Text style={styles.status} size={designTypography.caption} color={theme['c-font-label']}>
            {t('list_loading')}
          </Text>
        ) : null}
        {!loading && !playlists.length ? (
          <Text style={styles.status} size={designTypography.caption} color={theme['c-font-label']}>
            {t('list_empty')}
          </Text>
        ) : null}
      </ScrollView>
      {selectedPlaylist ? (
        <View style={StyleSheet.absoluteFill}>
          <SonglistDetail info={selectedPlaylist} onBack={handleCloseDetail} initialScrollToInfo={null} />
        </View>
      ) : null}
    </View>
  )
})
