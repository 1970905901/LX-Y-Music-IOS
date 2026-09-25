import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native'
import commonState from '@/store/common/state'
import { COMPONENT_IDS, type NAV_ID_Type } from '@/config/constant'
import { navigations } from '@/navigation'
import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { setNavActiveId } from '@/core/common'
import { createStyle, toast } from '@/utils/tools'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import songlistState, { type ListInfoItem, type Source } from '@/store/songlist/state'
import settingState from '@/store/setting/state'
import boardState, { type BoardItem } from '@/store/leaderboard/state'
import { getList } from '@/core/songlist'
import { getBoardsList, getListDetail } from '@/core/leaderboard'
import { saveLeaderboardSetting } from '@/utils/data'
import { handlePlay as playLeaderboard } from '../Leaderboard/listAction'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import PlatformChips from '@/components/home/PlatformChips'
import DailyRecommendCard from '@/components/home/DailyRecommendCard'
import FeatureGrid from '@/components/home/FeatureGrid'
import HorizontalShelf from '@/components/home/HorizontalShelf'
import HotSongList from '@/components/home/HotSongList'

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
  boardContent: {
    paddingHorizontal: designSpacing.lg,
    gap: designSpacing.sm,
    marginTop: designSpacing.md,
  },
  boardCard: {
    width: 104,
    minHeight: 76,
    borderRadius: designRadius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: designSpacing.xs,
    paddingHorizontal: designSpacing.sm,
    paddingVertical: designSpacing.sm,
  },
  boardName: {
    textAlign: 'center',
    fontWeight: '600',
  },
})

export default memo(() => {
  const theme = useTheme()
  const statusBarHeight = useStatusbarHeight()
  const t = useI18n()
  const sourceNameType = useSettingValue('common.sourceNameType')
  // 平台文案走全局语言包别名（source_${sourceNameType}_${source}），与歌单页等处的显示一致
  const sourceLabel = useCallback(
    (source: Source) => t(`source_${sourceNameType}_${source}` as any),
    [sourceNameType, t],
  )
  const supportedSources = useMemo(
    () => songlistState.sources.filter(
      (source): source is Source => !!songlistState.sortList[source]?.length,
    ),
    [],
  )
  const [selectedSource, setSelectedSource] = useState<Source>(supportedSources[0] ?? 'kw')
  const platformOptions = useMemo(
    () => supportedSources.map((source) => ({ id: source, label: sourceLabel(source) })),
    [supportedSources, sourceLabel],
  )
  const [playlists, setPlaylists] = useState<ListInfoItem[]>([])
  const [loading, setLoading] = useState(true)
  const loadIdRef = useRef(0)
  const [hotSongs, setHotSongs] = useState<LX.Music.MusicInfoOnline[]>([])
  const [hotBoardId, setHotBoardId] = useState('')
  const [hotLoading, setHotLoading] = useState(true)
  const hotLoadIdRef = useRef(0)
  const [boards, setBoards] = useState<BoardItem[]>([])

  const loadPlaylists = useCallback(async(source: Source) => {
    const currentLoadId = ++loadIdRef.current
    setLoading(true)
    try {
      const result = await getList(source, '', getSortId(source), 1)
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

  const loadHotSongs = useCallback(async(source: Source) => {
    const currentLoadId = ++hotLoadIdRef.current
    setHotLoading(true)
    try {
      const boards = await getBoardsList(source)
      if (currentLoadId !== hotLoadIdRef.current) return
      // 榜单列表与热歌同源加载：排行榜区块的卡片也跟随平台切换
      setBoards(boards)
      const board = boards.find(({ name }) => name.includes('热歌')) ?? boards[0]
      if (!board) return
      const result = await getListDetail(board.id, 1)
      if (currentLoadId !== hotLoadIdRef.current) return
      setHotSongs(result.list.slice(0, 6))
      setHotBoardId(board.id)
    } catch {
      if (currentLoadId !== hotLoadIdRef.current) return
      setHotSongs([])
      setHotBoardId('')
    } finally {
      if (currentLoadId === hotLoadIdRef.current) setHotLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPlaylists(selectedSource)
  }, [loadPlaylists, selectedSource])

  const leaderboardSource = boardState.sources.includes(selectedSource)
    ? selectedSource
    : boardState.sources[0] ?? 'kw'

  useEffect(() => {
    void loadHotSongs(leaderboardSource)
  }, [leaderboardSource, loadHotSongs])

  const handleOpenDetail = useCallback((item: ListInfoItem) => {
    const homeComponentId = commonState.componentIds.find(({ name }) => name === COMPONENT_IDS.home)?.id
    if (homeComponentId) navigations.pushSonglistDetailScreen(homeComponentId, item)
  }, [])

  const handlePlayHotSong = useCallback((index: number) => {
    if (!hotBoardId) return
    void playLeaderboard(hotBoardId, hotSongs, index)
  }, [hotBoardId, hotSongs])

  // 点榜单卡片进入排行榜页对应榜单：先持久化 source + boardId，排行榜页挂载时
  // 会读取该设置定位到具体榜单（与页内切换榜单的持久化行为一致）。
  const handleOpenBoard = useCallback((board: BoardItem) => {
    void saveLeaderboardSetting({ source: leaderboardSource, boardId: board.id })
    setNavActiveId('nav_top')
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
  }, [selectedSource])

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

  const shelfData = playlists.slice(0, 12)

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        onScrollBeginDrag={Keyboard.dismiss}
        showsVerticalScrollIndicator={false}
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
          <Text
            style={styles.platformTitle}
            size={designTypography.caption}
            color={theme['c-font-label']}
          >
            {t('discovery_platform_title')}
          </Text>
          <PlatformChips
            options={platformOptions}
            selectedId={selectedSource}
            onChange={(id) => { setSelectedSource(id as Source) }}
          />
        </View>

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
              style={styles.platformTitle}
              size={designTypography.title}
              color={theme['c-font']}
            >
              {t('nav_top')}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.boardContent}
            >
              {boards.map((board) => (
                <TouchableOpacity
                  key={board.id}
                  style={{
                    ...styles.boardCard,
                    backgroundColor: theme['c-primary-light-900-alpha-200'],
                    borderColor: theme['c-border-background'],
                  }}
                  onPress={() => { handleOpenBoard(board) }}
                >
                  <Icon name="leaderboard" size={20} color={theme['c-primary']} />
                  <Text
                    style={styles.boardName}
                    numberOfLines={2}
                    size={designTypography.caption}
                    color={theme['c-font']}
                  >
                    {board.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <FeatureGrid />

        <View style={styles.sectionGap}>
          <HorizontalShelf
            title={t('discovery_playlists_title')}
            data={shelfData}
            cardWidth={150}
            onPressItem={handleOpenDetail}
          />
        </View>

        <View style={styles.sectionGap}>
          {hotSongs.length ? (
            <HotSongList
              title={`${sourceLabel(selectedSource)}${t('discovery_hot_title')}`}
              actionLabel={t('discovery_hot_more')}
              onPressAction={() => { setNavActiveId('nav_top') }}
              songs={hotSongs}
            onSongPress={(_song, index) => { handlePlayHotSong(index) }}
            />
          ) : null}
          {hotLoading ? (
            <Text style={styles.status} size={designTypography.caption} color={theme['c-font-label']}>
              {t('list_loading')}
            </Text>
          ) : null}
          {!hotLoading && !hotSongs.length ? (
            <Text style={styles.status} size={designTypography.caption} color={theme['c-font-label']}>
              {t('list_empty')}
            </Text>
          ) : null}
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
    </View>
  )
})
