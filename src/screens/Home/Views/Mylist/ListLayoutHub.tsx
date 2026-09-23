import { memo, useEffect, useMemo, useState } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'

import { NAV_MENUS, type ListLayoutMode, type NAV_ID_Type } from '@/config/constant'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import Icon from '@/components/common/Icon'
import Text from '@/components/common/Text'
import Mylist from '.'
import SongList from '../SongList'
import Leaderboard from '../Leaderboard'
import LocalDownload from '../LocalDownload'
import MyPlaylist from '../MyPlaylist'
import TxPlaylist from '../TxPlaylist'
import KgPlaylist from '../KgPlaylist'

type HubPageId =
  | 'nav_love'
  | 'nav_songlist'
  | 'nav_top'
  | 'nav_local_download'
  | 'nav_my_playlist'
  | 'nav_tx_playlist'
  | 'nav_kg_playlist'

const getEntries = (mode: ListLayoutMode, t: (key: string) => string): Array<{
  id: HubPageId
  name: string
  desc: string
}> => {
  const commonEntries = [
    {
      id: 'nav_love' as const,
      name: t('nav_love'),
      desc: t('setting_list_layout_my_list_desc'),
    },
    {
      id: 'nav_songlist' as const,
      name: t('nav_songlist'),
      desc: t('setting_list_layout_song_list_desc'),
    },
    {
      id: 'nav_top' as const,
      name: t('nav_top'),
      desc: t('setting_list_layout_top_desc'),
    },
    {
      id: 'nav_local_download' as const,
      name: t('nav_local_download'),
      desc: t('setting_list_layout_download_desc'),
    },
  ]

  if (mode === 'card') return commonEntries

  return [
    {
      id: 'nav_my_playlist' as const,
      name: t('nav_my_playlist'),
      desc: t('setting_list_layout_song_list_desc'),
    },
    {
      id: 'nav_tx_playlist' as const,
      name: t('nav_tx_playlist'),
      desc: t('setting_list_layout_song_list_desc'),
    },
    {
      id: 'nav_kg_playlist' as const,
      name: t('nav_kg_playlist'),
      desc: t('setting_list_layout_song_list_desc'),
    },
    ...commonEntries,
  ]
}

export default memo(({ mode }: { mode: ListLayoutMode }) => {
  const t = useI18n()
  const theme = useTheme()
  const [selectedId, setSelectedId] = useState<HubPageId | null>(null)

  const entries = useMemo(() => getEntries(mode, t), [mode, t])
  useEffect(() => {
    setSelectedId(null)
  }, [mode])
  const title = mode === 'library'
    ? t('setting_list_layout_music_library')
    : t('nav_love')

  const pageComponents = useMemo<Partial<Record<HubPageId, React.ReactNode>>>(() => ({
    nav_love: <Mylist />,
    nav_songlist: <SongList />,
    nav_top: <Leaderboard />,
    nav_local_download: <LocalDownload />,
    nav_my_playlist: <MyPlaylist />,
    nav_tx_playlist: <TxPlaylist />,
    nav_kg_playlist: <KgPlaylist />,
  }), [])

  if (selectedId) {
    return (
      <View style={styles.container}>
        <View style={styles.selectedHeader}>
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.7}
            onPress={() => setSelectedId(null)}
          >
            <Icon name="chevron-left" size={20} color={theme['c-font']} />
          </TouchableOpacity>
          <Text size={17} numberOfLines={1}>
            {t(selectedId)}
          </Text>
        </View>
        <View style={styles.pageContent}>{pageComponents[selectedId]}</View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text size={20}>{title}</Text>
      </View>
      <ScrollView
        style={styles.cards}
        contentContainerStyle={styles.cardContent}
        showsVerticalScrollIndicator={false}
      >
        {entries.map(entry => {
          const menu = NAV_MENUS.find(item => item.id === entry.id)
          return (
            <TouchableOpacity
              key={entry.id}
              style={{ ...styles.card, backgroundColor: theme['c-content-background'] }}
              activeOpacity={0.75}
              onPress={() => setSelectedId(entry.id)}
            >
              <View style={{ ...styles.icon, backgroundColor: theme['c-primary-background-hover'] }}>
                <Icon name={menu?.icon ?? 'album'} size={20} color={theme['c-primary-font']} />
              </View>
              <View style={styles.cardInfo}>
                <Text size={16} numberOfLines={1}>{entry.name}</Text>
                <Text size={12} numberOfLines={1} color={theme['c-font-label']}>
                  {entry.desc}
                </Text>
              </View>
              <Icon name="chevron-right" size={16} color={theme['c-350']} />
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </View>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
  },
  cards: {
    flex: 1,
  },
  cardContent: {
    paddingHorizontal: 20,
    paddingBottom: 80,
    gap: 12,
  },
  card: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flexGrow: 1,
    flexShrink: 1,
    paddingLeft: 12,
    gap: 3,
  },
  selectedHeader: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageContent: {
    flex: 1,
  },
})
