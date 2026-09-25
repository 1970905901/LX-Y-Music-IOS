import { memo, useState, useEffect } from 'react';
import { View, TouchableOpacity } from 'react-native';
import Image from '@/components/common/Image';
import ImagePreviewModal from '@/components/common/ImagePreviewModal';
import Text from '@/components/common/Text';
import { useTheme } from '@/store/theme/hook';
import { createStyle, toast } from '@/utils/tools';
import { dateFormat } from '@/utils/common';
import { useStatusbarHeight } from '@/store/common/hook';
import { Icon } from '@/components/common/Icon';
import { navigations } from '@/navigation';
import { useIsWyAlbumSubscribed } from '@/store/user/hook';
import wyApi from '@/utils/musicSdk/wy/user';
import { addWySubscribedAlbum, removeWySubscribedAlbum } from '@/store/user/action';
import { type SubscribedAlbumInfo } from '@/store/user/state';
import { log } from '@/utils/log';
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens';

interface Props {
  albumInfo: any
  componentId: string
}

export default memo(({ albumInfo, componentId }: Props) => {
  const theme = useTheme();
  const statusBarHeight = useStatusbarHeight();
  const isSubscribed = useIsWyAlbumSubscribed(albumInfo.id);
  const [isPreviewVisible, setPreviewVisible] = useState(false);
  const albumPic = albumInfo.picUrl || albumInfo.img;

  useEffect(() => {
    log.info('[AlbumDetail/Header] albumInfo更新', {
      albumId: albumInfo.id,
      publishTime: albumInfo.publishTime,
      publishTimeType: typeof albumInfo.publishTime,
      size: albumInfo.size,
      total: albumInfo.total,
    })
  }, [albumInfo.id, albumInfo.publishTime, albumInfo.size, albumInfo.total])

  const handleArtistPress = (artist: any) => {
    if (!artist.id && !artist.mid) return;
    navigations.pushArtistDetailScreen(componentId, { id: String(artist.id || artist.mid), mid: artist.mid || artist.id, name: artist.name, picUrl: artist.picUrl, source: albumInfo.source });
  };

  const toggleSubscribe = () => {
    if (!albumInfo.id) {
      toast('正在加载专辑信息，请稍后...');
      return;
    }
    const newSubState = !isSubscribed;
    wyApi.subAlbum(String(albumInfo.id), newSubState).then(() => {
      toast(newSubState ? '收藏成功' : '取消收藏成功');
      if (newSubState) {
        const albumInfoForStore: SubscribedAlbumInfo = {
          id: albumInfo.id,
          name: albumInfo.name,
          picUrl: albumInfo.picUrl,
          artists: albumInfo.artists,
          publishTime: albumInfo.publishTime,
          size: albumInfo.size,
        };
        addWySubscribedAlbum(albumInfoForStore);
      } else {
        removeWySubscribedAlbum(albumInfo.id);
      }
    }).catch((err: any) => {
      toast(`操作失败: ${err.message}，可能是Cookie已失效，请重新登录`);
    });
  };


  const artists = albumInfo.artists?.map((artist: any, index: number) => (
      <TouchableOpacity key={artist.id || `${artist.name}_${index}`} onPress={() => handleArtistPress(artist)}>
      <Text style={styles.artistName} size={designTypography.body} color={theme['c-primary-font']}>
          {artist.name}{index < albumInfo.artists.length - 1 ? ' / ' : ''}
        </Text>
      </TouchableOpacity>
  ))

  return (
    <View style={{ paddingTop: statusBarHeight }}>
      <View style={styles.headerContainer}>
        <TouchableOpacity activeOpacity={0.85} disabled={!albumPic} onPress={() => setPreviewVisible(true)}>
          <Image
            url={albumPic}
            style={{ ...styles.albumArt, backgroundColor: theme['c-primary-light-900-alpha-200'] }}
          />
        </TouchableOpacity>
        <View style={styles.infoContainer}>
          <Text style={styles.albumName} size={20} color={theme['c-font']} numberOfLines={2}>{albumInfo.name}</Text>
          <View style={styles.artistContainer}>{artists}</View>
          <Text style={styles.metaInfo} size={designTypography.caption} color={theme['c-font-label']}>
            {albumInfo.publishTime ? `${dateFormat(albumInfo.publishTime, 'Y.M.D') || albumInfo.publishTime} • ` : ''}{albumInfo.size || albumInfo.total} 首
          </Text>
        </View>
        {albumInfo.source !== 'tx' && albumInfo.source !== 'kg' && (
          <TouchableOpacity
            style={{ ...styles.followButton, backgroundColor: theme['c-primary-background'] }}
            onPress={toggleSubscribe}
          >
              <Icon
                name={isSubscribed ? 'love-filled' : 'love'}
                color={isSubscribed ? theme['c-liked'] : theme['c-primary']}
                size={19}
              />
          </TouchableOpacity>
        )}
      </View>
      <ImagePreviewModal
        visible={isPreviewVisible}
        url={albumPic}
        name={albumInfo.name || 'album'}
        onClose={() => setPreviewVisible(false)}
      />
    </View>
  )
})

const styles = createStyle({
  backBtn: {
    position: 'absolute',
    top: 35,
    left: 10,
    zIndex: 10,
    padding: 5,
  },
  headerContainer: {
    paddingHorizontal: designSpacing.md,
    paddingTop: designSpacing.md,
    paddingBottom: designSpacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  albumArt: {
    width: 104,
    height: 104,
    borderRadius: designRadius.lg,
  },
  infoContainer: {
    flex: 1,
    marginLeft: 20,
    justifyContent: 'center',
  },
  albumName: {
    fontWeight: 'bold',
  },
  artistContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  artistName: {
    fontWeight: '600',
  },
  metaInfo: {
    marginTop: 8,
  },
  followButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: designSpacing.sm,
  },
});
