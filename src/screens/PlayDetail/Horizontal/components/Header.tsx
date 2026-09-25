import { memo, useRef, useMemo, useCallback } from 'react'
import { View, StyleSheet, TouchableOpacity } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { pop, navigations } from '@/navigation'
import { useTheme } from '@/store/theme/hook'
import { usePlayMusicInfo } from '@/store/player/hook'
import Text from '@/components/common/Text'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'
import { HEADER_HEIGHT as _HEADER_HEIGHT, NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import commonState from '@/store/common/state'
import CommentBtn from './CommentBtn'
import Btn from './Btn'
import SettingPopup, { type SettingPopupType } from '../../components/SettingPopup'
import { handleShowArtistDetail } from '@/components/OnlineList/listAction'

export const HEADER_HEIGHT = scaleSizeH(_HEADER_HEIGHT)
// 返回按钮在原有 42pt 宽的基础上再向外扩一圈触控范围，
// 避免 iPad 横屏下贴栏顶/左边缘点击落空（与竖屏保持一致的手感）。
const BACK_BTN_HIT_SLOP = {
  top: scaleSizeH(10),
  bottom: scaleSizeH(10),
  left: scaleSizeW(10),
  right: scaleSizeW(10),
}

const Title = ({ componentId }: { componentId: string }) => {
  const theme = useTheme()
  const playMusicInfo = usePlayMusicInfo()
  const musicInfo = playMusicInfo.musicInfo ? ('progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo : playMusicInfo.musicInfo) : null

  const handleArtistPress = useCallback((artist: { id: string | number, mid?: string, name: string }) => {
    if (!musicInfo || (musicInfo.source !== 'wy' && musicInfo.source !== 'tx' && musicInfo.source !== 'kg')) return
    // 部分音源（如 QQ）的歌手数据可能缺 id，mid 也可作为标识
    const artistId = artist.id || artist.mid
    if (!artistId) {
      // id/mid 都缺失时清空自带 artists，走歌手名搜索兜底定位
      void handleShowArtistDetail(componentId, { ...musicInfo, artists: [] } as LX.Music.MusicInfoOnline)
      return
    }
    navigations.pushArtistDetailScreen(componentId, { id: String(artistId), mid: artist.mid, name: artist.name, source: musicInfo.source })
  }, [componentId, musicInfo])

  const handleAlbumPress = useCallback(() => {
    if (!musicInfo) return
    if (musicInfo.source !== 'wy' && musicInfo.source !== 'tx' && musicInfo.source !== 'kg') return
    const albumId = (musicInfo.meta as any)?.albumId || musicInfo.albumId
    const albumName = musicInfo.meta?.albumName || musicInfo.albumName
    const albumMid = (musicInfo.meta as any)?.albumMid || musicInfo.albumMid || albumId
    if (!albumId || !albumName) return
    if (musicInfo.source === 'tx') {
      navigations.pushAlbumDetailScreen(componentId, { id: String(albumId), mid: albumMid, name: albumName, source: 'tx' })
    } else {
      navigations.pushAlbumDetailScreen(componentId, { id: String(albumId), name: albumName, source: musicInfo.source })
    }
  }, [componentId, musicInfo])


  const singerRender = useMemo(() => {
    if (!musicInfo) return null
    const albumName = musicInfo.meta?.albumName || musicInfo.albumName
    const albumId = (musicInfo.meta as any)?.albumId || musicInfo.albumId

    if (!musicInfo.artists?.length || musicInfo.source == 'local') {
      return (
        <View style={styles.singerContainer}>
          <TouchableOpacity onPress={() => { void handleShowArtistDetail(componentId, musicInfo as LX.Music.MusicInfoOnline) }}>
            <Text numberOfLines={1} size={12} color={theme['c-font-label']}>
              {musicInfo.singer}
            </Text>
          </TouchableOpacity>
          {albumName ? (
            <TouchableOpacity style={{ flexShrink: 1 }} onPress={handleAlbumPress} disabled={(musicInfo.source !== 'wy' && musicInfo.source !== 'tx' && musicInfo.source !== 'kg') || !albumId}>
              <Text numberOfLines={1} size={12} color={theme['c-font-label']}>
                {` · ${albumName}`}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )
    }

    return (
      <View style={styles.singerContainer}>
        {musicInfo.artists.map((artist, index) => (
          <TouchableOpacity key={artist.id || index} onPress={() => { handleArtistPress(artist) }}>
            <Text style={styles.singerText} size={12} color={theme['c-font-label']}>
              {artist.name}
              {(musicInfo.artists?.length ?? 0) > 0 && index < (musicInfo.artists?.length ?? 0) - 1 ? ' / ' : ''}
            </Text>
          </TouchableOpacity>
        ))}
        {albumName ? (
          <TouchableOpacity style={{ flexShrink: 1 }} onPress={handleAlbumPress} disabled={(musicInfo.source !== 'wy' && musicInfo.source !== 'tx' && musicInfo.source !== 'kg') || !albumId}>
            <Text numberOfLines={1} size={12} color={theme['c-font-label']}>
              {` · ${albumName}`}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    )
  }, [componentId, musicInfo, theme, handleArtistPress, handleAlbumPress])

  return (
    <View style={styles.titleContent}>
      {musicInfo ? (
        <>
          <Text numberOfLines={1} style={styles.title} size={14}>
            {musicInfo.name}
            {musicInfo.alias ? <Text color={theme['c-font-label']}> ({musicInfo.alias})</Text> : null}
          </Text>
          {singerRender}
        </>
      ) : null}
    </View>
  )
}

export default memo(({ componentId }: { componentId: string }) => {
  const popupRef = useRef<SettingPopupType>(null)
  const back = () => {
    void pop(commonState.componentIds[commonState.componentIds.length - 1]?.id)
  }
  const showSetting = () => {
    popupRef.current?.show()
  }
  return (
    <View style={{ height: HEADER_HEIGHT }} nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_header}>
      <View style={styles.container}>
        <TouchableOpacity
          onPress={back}
          style={{ ...styles.button, width: HEADER_HEIGHT }}
          hitSlop={BACK_BTN_HIT_SLOP}
        >
          <Icon name="chevron-left" size={18} />
        </TouchableOpacity>
        <Title componentId={componentId} />
        <CommentBtn />
        <Btn icon="slider" onPress={showSetting} />
      </View>
      <SettingPopup ref={popupRef} position="left" direction="horizontal" />
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    flex: 0,
    // backgroundColor: '#ccc',
    flexDirection: 'row',
    // justifyContent: 'center',
    height: '100%',
  },
  button: {
    justifyContent: 'center',
    alignItems: 'center',
    height: '100%',
    flex: 0,
  },
  titleContent: {
    flex: 1,
    // alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    // flex: 1,
    // textAlign: 'center',
  },
  icon: {
    paddingLeft: 4,
    paddingRight: 4,
  },
  singerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  singerText: {
    paddingTop: 2,
  },
})
