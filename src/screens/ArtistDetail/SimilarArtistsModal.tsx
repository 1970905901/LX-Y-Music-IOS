import { memo, useCallback, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import { FlatList, TouchableOpacity, View, type FlatListProps } from 'react-native'

import Image from '@/components/common/Image'
import Popup, { type PopupType } from '@/components/common/Popup'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { navigations } from '@/navigation'
import { useTheme } from '@/store/theme/hook'
import musicSdk from '@/utils/musicSdk'
import { createStyle, toast } from '@/utils/tools'

export interface SimilarArtistsModalType {
  show: (artist: { id: string | number; name?: string; source?: string }) => void
}

type ArtistInfo = {
  id: string | number
  name: string
  alias?: string[] | null
  briefDesc?: string
  avatar?: string
  cover?: string
  picUrl?: string
  img1v1Url?: string
}

type FlatListType = FlatListProps<ArtistInfo>

const getArtistPic = (artist: ArtistInfo) => artist.avatar || artist.picUrl || artist.img1v1Url || artist.cover

const ArtistItem = memo(({
  item,
  onOpen,
  source,
}: {
  item: ArtistInfo & { source?: string }
  onOpen: (artist: ArtistInfo & { mid?: string; source?: string; picUrl?: string }) => void
  source?: string
}) => {
  const theme = useTheme()
  const [expanded, setExpanded] = useState(false)
  const desc = item.briefDesc?.trim() || '暂无简介'
  const alias = item.alias?.length ? item.alias.join(' / ') : ''
  const showDesc = source !== 'tx'

  const handleOpen = useCallback(() => {
    onOpen(item)
  }, [item, onOpen])

  return (
    <View style={{ ...styles.item, borderBottomColor: theme['c-border-background'] }}>
      <TouchableOpacity activeOpacity={0.75} style={styles.itemMain} onPress={handleOpen}>
        <Image url={getArtistPic(item)} style={styles.avatar} />
        <View style={styles.info}>
          <Text color={theme['c-font']} size={15} numberOfLines={1} style={styles.name}>
            {item.name}
          </Text>
          {alias ? (
            <Text color={theme['c-font-label']} size={12} numberOfLines={1}>
              {alias}
            </Text>
          ) : null}
        </View>
        <Icon name="chevron-right" size={16} color={theme['c-font-label']} />
      </TouchableOpacity>
      {showDesc && (
        <TouchableOpacity activeOpacity={0.8} onPress={() => setExpanded(!expanded)}>
          <Text
            color={theme['c-font-label']}
            size={12}
            numberOfLines={expanded ? undefined : 3}
            style={styles.desc}
          >
            {desc}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  )
})

export default forwardRef<SimilarArtistsModalType, { componentId: string }>(({ componentId }, ref) => {
  const popupRef = useRef<PopupType>(null)
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState<ArtistInfo[]>([])
  const [title, setTitle] = useState('相似歌手')
  const [currentSource, setCurrentSource] = useState<string>('wy')
  const requestIdRef = useRef(0)
  const theme = useTheme()

  const loadData = useCallback((artist: { id: string | number; name?: string; source?: string }) => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setList([])

    const source = artist.source || 'wy'
    setCurrentSource(source)
    const api = musicSdk[source]?.artist

    if (!api?.getSimilar) {
      toast('暂不支持该音源获取相似歌手')
      setLoading(false)
      return
    }

    api.getSimilar(artist.id).then((artists: ArtistInfo[]) => {
      if (requestId !== requestIdRef.current) return
      setList(artists)
      if (!artists.length) toast('暂无相似歌手')
    }).catch((err: any) => {
      if (requestId !== requestIdRef.current) return
      toast(err?.message || '获取相似歌手失败')
    }).finally(() => {
      if (requestId === requestIdRef.current) setLoading(false)
    })
  }, [])

  useImperativeHandle(ref, () => ({
    show(artist) {
      if (!artist.id) return
      setTitle(artist.name ? `相似歌手 - ${artist.name}` : '相似歌手')

      const open = () => {
        popupRef.current?.setVisible(true)
        loadData(artist)
      }

      if (visible) open()
      else {
        setVisible(true)
        requestAnimationFrame(open)
      }
    },
  }))

  const handleOpenArtist = useCallback((artist: ArtistInfo & { mid?: string; source?: string; picUrl?: string }) => {
    popupRef.current?.setVisible(false)
    requestAnimationFrame(() => {
      navigations.pushArtistDetailScreen(componentId, {
        id: String(artist.mid || artist.id),
        mid: artist.mid,
        name: artist.name,
        picUrl: artist.picUrl,
        source: artist.source,
      })
    })
  }, [componentId])

  const renderItem = useCallback<NonNullable<FlatListType['renderItem']>>(({ item }) => {
    return <ArtistItem item={item} onOpen={handleOpenArtist} source={currentSource} />
  }, [handleOpenArtist, currentSource])

  const keyExtractor = useCallback<NonNullable<FlatListType['keyExtractor']>>((item) => String(item.id), [])

  const Empty = useCallback(() => (
    <View style={styles.empty}>
      <Text color={theme['c-font-label']}>{loading ? '加载中...' : '暂无相似歌手'}</Text>
    </View>
  ), [loading, theme])

  const handleHide = useCallback(() => {
    requestIdRef.current += 1
    setVisible(false)
    setList([])
  }, [])

  return visible ? (
    <Popup ref={popupRef} title={title} position="bottom" onHide={handleHide}>
      <View style={styles.content}>
        <FlatList
          data={list}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListEmptyComponent={Empty}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={8}
        />
      </View>
    </Popup>
  ) : null
})

const styles = createStyle({
  content: {
    width: '100%',
    height: 560,
    maxHeight: '100%',
  },
  item: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  itemMain: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  info: {
    flex: 1,
    paddingHorizontal: 12,
  },
  name: {
    fontWeight: '600',
    marginBottom: 4,
  },
  desc: {
    marginTop: 9,
    lineHeight: 18,
  },
  empty: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
