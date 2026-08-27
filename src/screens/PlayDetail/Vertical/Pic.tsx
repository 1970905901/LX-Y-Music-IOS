import { memo, useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { View, Animated, Easing, TouchableWithoutFeedback, Platform } from 'react-native';
import { useIsPlay, usePlayMusicInfo, usePlayerMusicInfo } from '@/store/player/hook';
import { useWindowSize } from '@/utils/hooks';
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant';
import { HEADER_HEIGHT } from './components/Header';
import Image from '@/components/common/Image';
import { useStatusbarHeight } from '@/store/common/hook';
import { useSettingValue } from '@/store/setting/hook';
import { createStyle, toast, requestStoragePermission } from '@/utils/tools';
import Menu, { type MenuType, type Menus } from '@/components/common/Menu';
import SourceQualityBadge from '../components/SourceQualityBadge';
import { addTask } from '@/core/download';
import RNFetchBlob from '@/utils/rnFetchBlob';
import { getPicUrl } from '@/core/music/online';
import { getFileExtensionFromUrl } from '@/screens/Home/Views/Mylist/MusicList/download/utils';
import settingState from '@/store/setting/state';

export default memo(({ componentId, maxCoverHeight }: { componentId: string, maxCoverHeight?: number }) => {
  const musicInfo = usePlayMusicInfo();
  const playerMusicInfo = usePlayerMusicInfo();
  // 封面来源：与 PlayerBar、Horizontal Pic 保持一致，优先使用 playerMusicInfo.pic。
  // 该字段是应用实际在用的已解析封面（视频证实 PlayerBar 用它能正常显示），
  // 因此作为主源；仅当它为空白或加载失败时，才回退到原始 musicInfo.musicInfo 的
  // metadata/meta.picUrl，并启用异步 getPicUrl 兜底，兼容已下载歌曲等场景。
  const [resolvedPic, setResolvedPic] = useState('')
  const [picLoadError, setPicLoadError] = useState(false)
  const staticFallbackPic = useMemo(() => {
    const raw = musicInfo.musicInfo as any
    if (!raw) return ''
    return raw.metadata?.musicInfo?.meta?.picUrl || raw.meta?.picUrl || ''
  }, [musicInfo.musicInfo])
  const coverPic = useMemo(() => {
    if (playerMusicInfo.pic && !picLoadError) return playerMusicInfo.pic
    return staticFallbackPic || resolvedPic
  }, [playerMusicInfo.pic, picLoadError, staticFallbackPic, resolvedPic]);

  // 切歌重置错误状态与异步解析结果，避免旧封面/错误态残留。
  useEffect(() => {
    setPicLoadError(false)
    setResolvedPic('')
  }, [musicInfo.musicInfo?.id])

  // 异步兜底：playerMusicInfo.pic 与静态 fallback 都为空时，向音源解析封面
  // （与“下载封面”菜单同款 getPicUrl）。
  useEffect(() => {
    const raw = musicInfo.musicInfo as any
    if (!raw) return
    if (playerMusicInfo.pic || staticFallbackPic) return
    const online = ('progress' in raw ? raw.metadata?.musicInfo : raw) as LX.Music.MusicInfoOnline | undefined
    if (!online || !('meta' in online) || !(online as any).meta) return
    let cancelled = false
    void getPicUrl({ musicInfo: online, isRefresh: false })
      .then((url) => { if (!cancelled && url) setResolvedPic(url) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [musicInfo.musicInfo?.id, playerMusicInfo.pic, staticFallbackPic])
  const { width: winWidth, height: winHeight } = useWindowSize();
  const statusBarHeight = useStatusbarHeight();
  const isPlay = useIsPlay();
  const isCoverSpin = useSettingValue('playDetail.isCoverSpin');
  const coverSizeRaw = useSettingValue('playDetail.style.coverSize');
  const coverSize = typeof coverSizeRaw === 'number' && !isNaN(coverSizeRaw) ? coverSizeRaw : 100;
  const isNewUI = useSettingValue('list.isNewListUI');
  const spinValue = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const isAnimating = useRef(false);
  const menuRef = useRef<MenuType>(null);
  const coverRef = useRef<View>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const shouldForceLayerComposition = !!(Platform.OS === 'android' && global.lx.isCarMode && isCoverSpin);
  const isUnmounted = useRef(false);

  const createAnimation = useCallback((value: number) => {
    return Animated.timing(spinValue, {
      toValue: 1,
      duration: 25000 * (1 - value),
      easing: Easing.linear,
      useNativeDriver: false,
    });
  }, [spinValue]);

  const startAnimation = useCallback(() => {
    if (isAnimating.current || !isCoverSpin || isUnmounted.current) return;
    isAnimating.current = true;
    spinValue.stopAnimation(value => {
      if (isUnmounted.current) return;
      animationRef.current = createAnimation(value);
      animationRef.current.start(({ finished }) => {
        if (finished && isAnimating.current && !isUnmounted.current) {
          spinValue.setValue(0);
          isAnimating.current = false;
          startAnimation();
        }
      });
    });
  }, [spinValue, createAnimation, isCoverSpin]);

  const stopAnimation = useCallback(() => {
    if (!isAnimating.current) return;
    isAnimating.current = false;
    animationRef.current?.stop();
    animationRef.current = null;
    spinValue.stopAnimation();
  }, [spinValue]);

  useEffect(() => {
    if (isPlay && isCoverSpin) {
      startAnimation();
    } else {
      stopAnimation();
      if (!isCoverSpin) {
        spinValue.setValue(0);
      }
    }
  }, [isPlay, isCoverSpin, startAnimation, stopAnimation, spinValue]);

  useEffect(() => {
    stopAnimation();
    spinValue.setValue(0);
    if (isPlay && isCoverSpin) {
      startAnimation();
    }
  }, [playerMusicInfo.id, isCoverSpin, startAnimation, stopAnimation, spinValue]);

  useEffect(() => {
    return () => {
      isUnmounted.current = true;
      stopAnimation();
    };
  }, [stopAnimation]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const imageContainerStyle = useMemo(() => {
    const isSmallWindow = winHeight < 700
    const availableHeight = winHeight - statusBarHeight - HEADER_HEIGHT
    let heightLimit: number
    if (maxCoverHeight != null) {
      heightLimit = maxCoverHeight
    } else if (isNewUI) {
      heightLimit = availableHeight * (isSmallWindow ? 0.3 : 0.45)
    } else {
      heightLimit = availableHeight * 0.5
    }
    const widthLimit = isNewUI
      ? winWidth * (isSmallWindow ? 0.55 : 0.65)
      : winWidth * 0.85
    const baseWidth = Math.min(widthLimit, heightLimit)
    const imgWidth = baseWidth * (coverSize / 100);
    const radius = isCoverSpin ? imgWidth / 2 : 4;
    return {
      width: imgWidth,
      height: imgWidth,
      borderRadius: radius,
      elevation: 3,
      opacity: 1,
      backgroundColor: 'transparent',
      overflow: 'hidden',
    };
  }, [statusBarHeight, winHeight, winWidth, isCoverSpin, coverSize, isNewUI, maxCoverHeight]);

  const imageStyle = useMemo(() => ({
    width: '100%',
    height: '100%',
    borderRadius: imageContainerStyle.borderRadius,
  } as any), [imageContainerStyle.borderRadius]);

  const animatedCoverStyle = useMemo(() => ({
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    transform: [{ rotate: spin }],
    borderRadius: imageContainerStyle.borderRadius,
  } as any), [spin, imageContainerStyle.borderRadius]);

  const menus = useMemo((): Menus => [
    { action: 'download_song', label: '下载歌曲' },
    { action: 'download_pic', label: '下载封面' },
  ], []);

  const handleLongPress = () => {
    if (!coverRef.current) return;
    coverRef.current.measure((x, y, w, h, px, py) => {
      setMenuVisible(true);
      requestAnimationFrame(() => {
        menuRef.current?.show({ x: px, y: py, w, h });
      });
    });
  };

  const handleMenuPress = ({ action }: typeof menus[number]) => {
    switch (action) {
      case 'download_song':
        if (musicInfo.musicInfo) {
          const quality = settingState.setting['player.playQuality'];
          addTask(musicInfo.musicInfo as LX.Music.MusicInfo, quality);
        }
        break;
      case 'download_pic':
        if (musicInfo.musicInfo) {
          void (async () => {
            try {
              const isGranted = await requestStoragePermission();
              if (isGranted === false) {
                toast('没有存储权限，无法下载', 'short');
                return;
              }

              toast('正在下载封面...', 'short');
              const picUrl = await getPicUrl({ musicInfo: musicInfo.musicInfo as LX.Music.MusicInfoOnline, isRefresh: true });
              const extension = getFileExtensionFromUrl(picUrl);
              const picBaseDir = RNFetchBlob.fs.dirs.PictureDir || RNFetchBlob.fs.dirs.DownloadDir;
              const downloadDir = `${picBaseDir}/LX-N-Music`;
              const mInfo = musicInfo.musicInfo as LX.Music.MusicInfo;
              const fileName = `${mInfo.name}_${mInfo.singer}.${extension}`.replace(/[\\/:*?"<>|]/g, '_');
              const filePath = `${downloadDir}/${fileName}`;

              const exists = await RNFetchBlob.fs.exists(downloadDir);
              if (!exists) {
                try {
                  await RNFetchBlob.fs.mkdir(downloadDir);
                } catch (e) {
                  console.warn('mkdir failed');
                }
              }

              const targetPath = (await RNFetchBlob.fs.exists(downloadDir)) ? filePath : `${picBaseDir}/${fileName}`;

              await RNFetchBlob.config({ path: targetPath }).fetch('GET', picUrl);
              await RNFetchBlob.fs.scanFile([{ path: targetPath }]);
              toast(`封面已保存到: ${targetPath}`, 'long');
            } catch (err: any) {
              toast(`下载封面失败: ${err.message}`, 'long');
            }
          })();
        }
        break;
    }
  };

  const containerStyle = useMemo(() => {
    const baseStyle = isNewUI ? styles.containerNew : styles.container
    if (maxCoverHeight != null) {
      return { ...baseStyle, maxHeight: maxCoverHeight }
    }
    return baseStyle
  }, [isNewUI, maxCoverHeight])

  const clampedImageStyle = useMemo(() => {
    if (maxCoverHeight != null) {
      return {
        ...imageContainerStyle,
        maxWidth: maxCoverHeight,
        maxHeight: maxCoverHeight,
      }
    }
    return imageContainerStyle
  }, [imageContainerStyle, maxCoverHeight])

  return (
    <View style={containerStyle}>
      {!isNewUI && (
        <View style={styles.badgeContainer}>
          <SourceQualityBadge />
        </View>
      )}
      <TouchableWithoutFeedback onLongPress={handleLongPress}>
        <View
          ref={coverRef}
          collapsable={false}
          style={[styles.content, clampedImageStyle, { overflow: 'hidden' }]}
          renderToHardwareTextureAndroid={shouldForceLayerComposition}
          needsOffscreenAlphaCompositing={shouldForceLayerComposition}
        >
          <Animated.View
            style={animatedCoverStyle}
            renderToHardwareTextureAndroid={shouldForceLayerComposition}
            needsOffscreenAlphaCompositing={shouldForceLayerComposition}
          >
            <Image
              url={coverPic}
              nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_pic}
              style={imageStyle}
              onError={() => {
                // 主源 playerMusicInfo.pic 加载失败时，触发 fallback 链。
                if (playerMusicInfo.pic && !picLoadError) setPicLoadError(true)
              }}
            />
          </Animated.View>
        </View>
      </TouchableWithoutFeedback>
      {menuVisible && <Menu ref={menuRef} menus={menus} onPress={handleMenuPress} onHide={() => setMenuVisible(false)} />}
    </View>
  );
});

const styles = createStyle({
  container: {
    flexGrow: 1,
    flexShrink: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: '3%',
  },
  containerNew: {
    flexGrow: 0,
    flexShrink: 0,
    marginTop: 30,
    paddingBottom: 5,
  },
  badgeContainer: {
    alignSelf: 'stretch',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  content: {
    backgroundColor: 'rgba(0,0,0,0)',
  },
});