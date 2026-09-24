import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native'
import commonState from '@/store/common/state'
import { COMPONENT_IDS } from '@/config/constant'
import { navigations } from '@/navigation'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useStatusbarHeight } from '@/store/common/hook'
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
import SectionHeader from '@/components/common/SectionHeader'
import AnnouncementCard from '@/components/home/AnnouncementCard'
import PlatformChips from '@/components/home/PlatformChips'
import CategoryChips from '@/components/home/CategoryChips'
import DailyRecommendCard from '@/components/home/DailyRecommendCard'
import HorizontalShelf from '@/components/home/HorizontalShelf'
import HotSongList from '@/components/home/HotSongList'
import PlaylistCard from '@/components/home/PlaylistCard'

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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: designSpacing.lg,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: designSpacing.sm,
  },
})

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const statusBarHeight = useStatusbarHeight()
  const [selectedSource, setSelectedSource] = useState<Source>(supportedSources[0] ?? 'kw')
  const [selectedSortId, setSelectedSortId] = useState(
    songlistState.sortList[supportedSources[0] ?? 'kw']?.[0]?.id ?? '',
  )
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

  const sortOptions = songlistState.sortList[selectedSource] ?? []

  const loadPlaylists = useCallback(async(source: Source, sortId: string) => {
    const currentLoadId = ++loadIdRef.current
    setLoading(true)
    try {
      const result = await getList(source, '', sortId, 1)
      if (currentLoadId !== loadIdRef.current) return
      setPlaylists(result.list.map((item) => ({ ...item, source })))
    } catch (error: unknown) {
      if (currentLoadId !== loadIdRef.current) return
      setPlaylists([])
      toast(error instanceof Error && error.message ? error.message : t('load_failed'))
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
    if (!selectedSortId) return
    void loadPlaylists(selectedSource, selectedSortId)
  }, [loadPlaylists, selectedSortId, selectedSource])

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

  const handlePlayHotSong = useCallback((_song: LX.Music.MusicInfoOnline, index: number) => {
    if (!hotBoardId) return
    void playLeaderboard(hotBoardId, hotSongs, index)
  }, [hotBoardId, hotSongs])

  const handleSourceChange = useCallback((source: string) => {
    const typedSource = source as Source
    setSelectedSource(typedSource)
    setSelectedSortId(songlistState.sortList[typedSource]?.[0]?.id ?? '')
  }, [])

  const headerStyle = useMemo(
    () => StyleSheet.compose(styles.header, {
      paddingTop: statusBarHeight,
    }),
    [statusBarHeight],
  )

  const titleStyle = useMemo(
    () => StyleSheet.compose(styles.title, {
      color: theme['c-font'],
    }),
    [theme],
  )

  const historyButtonStyle = useMemo(
    () => StyleSheet.compose(styles.historyButton, {
      backgroundColor: theme['c-primary-background'],
    }),
    [theme],
  )

  const shelfData = playlists.slice(0, 6)
  const { width } = useWindowDimensions()
  const gridColumnCount = width > 900 ? 4 : width > 650 ? 3 : 2
  const gridData = playlists.slice(0, 12)
  const gridRows = Array.from(
    { length: Math.ceil(gridData.length / gridColumnCount) },
    (_, rowIndex) => gridData.slice(rowIndex * gridColumnCount, (rowIndex + 1) * gridColumnCount),
  )
  const gridItemWidth = (
    width - designSpacing.lg * 2 - (gridColumnCount - 1) * designSpacing.sm
  ) / gridColumnCount

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
            onChange={handleSourceChange}
          />
        </View>

        <View style={styles.chips}>
          <CategoryChips
            options={sortOptions.map((sort) => ({
              id: sort.id,
              label: t(`songlist_${sort.tid}`),
            }))}
            selectedId={selectedSortId}
            onChange={setSelectedSortId}
          />
        </View>

        <View style={styles.daily}>
          <DailyRecommendCard
            title={t('discovery_daily_title')}
            subtitle={t('discovery_daily_subtitle')}
            onPress={() => { setNavActiveId('nav_daily_rec') }}
          />
        </View>

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
              onSongPress={handlePlayHotSong}
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

        {gridRows.length ? (
          <View style={styles.sectionGap}>
            <SectionHeader title={t('nav_songlist')} />
            <View style={styles.grid}>
              {gridRows.map((row, rowIndex) => (
                <View key={`grid-row-${rowIndex}`} style={styles.gridRow}>
                  {row.map((item) => (
                    <PlaylistCard
                      key={`${item.source}-${item.id}`}
                      item={item}
                      width={gridItemWidth}
                      onPress={handleOpenDetail}
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
        ) : null}

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
