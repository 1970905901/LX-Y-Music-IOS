import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native'
import commonState from '@/store/common/state'
import { COMPONENT_IDS } from '@/config/constant'
import { navigations } from '@/navigation'
import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { useI18n } from '@/lang'
import { setNavActiveId } from '@/core/common'
import { createStyle, toast } from '@/utils/tools'
import { designSpacing, designTypography } from '@/theme/DesignTokens'
import songlistState, { type ListInfoItem, type Source } from '@/store/songlist/state'
import boardState from '@/store/leaderboard/state'
import { getList } from '@/core/songlist'
import { getBoardsList, getListDetail } from '@/core/leaderboard'
import { handlePlay as playLeaderboard } from '../Leaderboard/listAction'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import AnnouncementCard from '@/components/home/AnnouncementCard'
import PlatformChips from '@/components/home/PlatformChips'
import DailyRecommendCard from '@/components/home/DailyRecommendCard'
import FeatureGrid from '@/components/home/FeatureGrid'
import HorizontalShelf from '@/components/home/HorizontalShelf'
import HotSongList from '@/components/home/HotSongList'

const SOURCE_LABELS: Partial<Record<Source, string>> = {
  kw: '酷我',
  kg: '酷狗',
  tx: 'QQ音乐',
  wy: '网易云',
  mg: '咪咕',
}

const supportedSources = songlistState.sources.filter(
  (source): source is Source => !!SOURCE_LABELS[source] && !!songlistState.sortList[source]?.length,
)

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
  status: {
    paddingHorizontal: designSpacing.lg,
    marginTop: designSpacing.lg,
  },
  platformTitle: {
    paddingHorizontal: designSpacing.lg,
  },
})

export default memo(() => {
  const theme = useTheme()
  const statusBarHeight = useStatusbarHeight()
  const t = useI18n()
  const [selectedSource, setSelectedSource] = useState<Source>(supportedSources[0] ?? 'kw')
  const [playlists, setPlaylists] = useState<ListInfoItem[]>([])
  const [loading, setLoading] = useState(true)
  const loadIdRef = useRef(0)
  const [hotSongs, setHotSongs] = useState<LX.Music.MusicInfoOnline[]>([])
  const [hotBoardId, setHotBoardId] = useState('')
  const [hotLoading, setHotLoading] = useState(true)
  const hotLoadIdRef = useRef(0)

  const platformOptions = useMemo(
    () => supportedSources.map((source) => ({
      id: source,
      label: SOURCE_LABELS[source] ?? source,
    })),
    [],
  )

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

        <View style={styles.status}>
          <AnnouncementCard
            title={t('discovery_notice_title')}
            message={t('discovery_notice_body')}
          />
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

        <View style={styles.daily}>
          <DailyRecommendCard
            title={t('discovery_daily_title')}
            subtitle={t('discovery_daily_subtitle')}
            onPress={() => { setNavActiveId('nav_daily_rec') }}
          />
        </View>

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
              title={`${SOURCE_LABELS[selectedSource] ?? selectedSource}${t('discovery_hot_title')}`}
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
