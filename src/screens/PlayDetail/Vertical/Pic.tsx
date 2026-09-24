import { memo, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Animated, Easing, TouchableWithoutFeedback } from 'react-native';
import FastImage from '@d11/react-native-fast-image';
import { useIsPlay, usePlayerMusicInfo, usePlayMusicInfo } from '@/store/player/hook';
import { useWindowSize } from '@/utils/hooks';
import { useSettingValue } from '@/store/setting/hook';
import Image, { defaultHeaders } from '@/components/common/Image';
import { useStatusbarHeight } from '@/store/common/hook';
import { HEADER_HEIGHT } from './components/Header';
import { createStyle, toast, requestStoragePermission } from '@/utils/tools';
import Menu, { type MenuType, type Menus } from '@/components/common/Menu';
import { addTask } from '@/core/download';
import RNFetchBlob from '@/utils/rnFetchBlob';
import { getPicUrl } from '@/core/music/online';
import { getFileExtensionFromUrl } from '@/screens/Home/Views/Mylist/MusicList/download/utils';
import settingState from '@/store/setting/state';

const AnimatedCover = Animated.createAnimatedComponent(FastImage);

/**
 * 竖屏播放页封面。
 * - 封面来源：playerMusicInfo.pic 已兼容在线 + 下载两种来源（playInfo.ts setPlayerMusicInfo）。
 *   同时兜底 playMusicInfo.musicInfo.meta.picUrl（下载歌曲取 metadata.musicInfo.meta.picUrl）。
 * - 旋转动画：采用与横屏/沉浸一致的 createAnimation/startAnimation/stopAnimation 手动循环模式
 *   （参考版封面即此写法）。经验证 Animated.loop 在首屏挂载时常不启动（表现为进页面不转、
 *   切歌才转），故这里改为 stopAnimation 取当前角度后重新 timing 的可靠循环：进页面（歌曲已
 *   播放）即开始旋转，暂停时停止，切歌时重置角度重新旋转。
 * - 渲染组件：使用 Animated.createAnimatedComponent(FastImage) 直接承载封面并做旋转。
 *   旧代码把 FastImage 包在 Animated.View 里做 rotate 动画时，在 iOS 上会白屏/不渲染；
 *   直接对 FastImage 做 rotate 既保留 FastImage 的缓存/加载能力，又避免白屏。
 * - 错误回退：FastImage 加载失败时显示通用 Image 占位图，避免 RN Image 失败后的完全空白。
 * - 圆形：封面自身 borderRadius = size/2（圆形旋转视觉不变），
 *   全链路不使用 overflow:'hidden' 裁切——iOS 上 clipsToBounds 祖先
 *   会把带 transform 的后代剔除出渲染树。
 * - 不使用 RNN sharedElementTransitions：iOS 上会被原生层劫持成错位大图；封面与导航转场解耦。
 * - 尺寸：min(屏宽 * 0.65, 可用高 * 0.5)，居中。
 */
export default memo(({ componentId }: { componentId: string }) => {
  const playerMusicInfo = usePlayerMusicInfo();
  const playMusicInfo = usePlayMusicInfo();
  const { width: winWidth, height: winHeight } = useWindowSize();
  const statusBarHeight = useStatusbarHeight();
  const isPlay = useIsPlay();
  const isCoverSpin = useSettingValue('playDetail.isCoverSpin');

  // 封面 URL：playerMusicInfo.pic 已兼容在线 + 下载两种来源（playInfo.ts setPlayerMusicInfo）。
  // 同时兜底 playMusicInfo.musicInfo.meta.picUrl，保证和参考版 e58d1ab1 的数据入口一致。
  const rawMusicInfo = playMusicInfo.musicInfo;
  const coverUrl = playerMusicInfo.pic
    || (rawMusicInfo && ('progress' in rawMusicInfo
      ? (rawMusicInfo as LX.Download.ListItem).metadata.musicInfo.meta.picUrl
      : (rawMusicInfo as LX.Music.MusicInfo).meta?.picUrl))
    || '';

  // FastImage 加载失败状态（RN Image 失败时完全空白，无占位；改用 FastImage 并自带错误回退）
  const [isLoadError, setLoadError] = useState(false);
  useEffect(() => {
    setLoadError(false);
  }, [coverUrl]);
  const handleCoverError = useCallback(() => {
    setLoadError(true);
  }, []);

  // 当前歌曲 id，用于切歌时重置旋转角度
  const musicId = playerMusicInfo.id;

  // 圆形封面尺寸
  const size = useMemo(() => {
    const availableHeight = winHeight - statusBarHeight - HEADER_HEIGHT;
    return Math.min(winWidth * 0.65, availableHeight * 0.5);
  }, [winWidth, winHeight, statusBarHeight]);

  // ---- 旋转动画：采用与横屏/沉浸一致的 createAnimation/start/stop 模式 ----
  // 原 Animated.loop 在首屏挂载时常不启动（进页面不转、切歌才转），
  // 这里改为 stopAnimation -> 取当前角度 -> 重新 timing 的可靠循环方式，
  // 进页面（歌曲已播放）即开始旋转，暂停时停止，切歌时重置角度重新旋转。
  const spinValue = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const isAnimating = useRef(false);
  const isUnmounted = useRef(false);

  const createAnimation = useCallback((value: number) => {
    return Animated.timing(spinValue, {
      toValue: 1,
      duration: 25000 * (1 - value),
      easing: Easing.linear,
      useNativeDriver: true,
    });
  }, [spinValue]);

  const startAnimation = useCallback(() => {
    if (isAnimating.current || !isCoverSpin || isUnmounted.current) return;
    isAnimating.current = true;
    spinValue.stopAnimation((value) => {
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
    }
  }, [isPlay, isCoverSpin, startAnimation, stopAnimation]);

  useEffect(() => {
    stopAnimation();
    spinValue.setValue(0);
    if (isPlay && isCoverSpin && musicId) {
      startAnimation();
    }
  }, [musicId, isCoverSpin, startAnimation, stopAnimation, spinValue]);

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

  // ---- 长按菜单：下载歌曲 / 下载封面（保留原功能）----
  const menuRef = useRef<MenuType>(null);
  const coverRef = useRef<View>(null);
  const [menuVisible, setMenuVisible] = useState(false);

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

  const menuMusicInfo = playMusicInfo.musicInfo;
  const handleMenuPress = ({ action }: typeof menus[number]) => {
    switch (action) {
      case 'download_song':
        if (menuMusicInfo) {
          const quality = settingState.setting['player.playQuality'];
          addTask(menuMusicInfo as LX.Music.MusicInfo, quality);
        }
        break;
      case 'download_pic':
        if (menuMusicInfo) {
          void (async () => {
            try {
              const isGranted = await requestStoragePermission();
              if (isGranted === false) {
                toast('没有存储权限，无法下载', 'short');
                return;
              }
              toast('正在下载封面...', 'short');
              const picUrl = await getPicUrl({ musicInfo: menuMusicInfo as LX.Music.MusicInfoOnline, isRefresh: true });
              const extension = getFileExtensionFromUrl(picUrl);
              const picBaseDir = RNFetchBlob.fs.dirs.PictureDir || RNFetchBlob.fs.dirs.DownloadDir;
              const downloadDir = `${picBaseDir}/LX-N-Music`;
              const mInfo = menuMusicInfo as LX.Music.MusicInfo;
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

  const radius = size / 2;
  // 外层圆形容器：只负责固定尺寸与定位，**不做 overflow 裁切**。
  // iOS 上 overflow:'hidden'(clipsToBounds) 的祖先 + 带 transform 的后代
  // 会被错误剔除出渲染树（封面白屏的根因）。圆形效果完全由封面自身的
  // borderRadius 实现——圆形旋转后仍是圆形，视觉与裁切完全一致。
  const coverContainerStyle = useMemo(() => ({
    width: size,
    height: size,
    backgroundColor: 'transparent' as const,
  }), [size]);

  // 封面图样式：固定尺寸 + 圆形（borderRadius 自带，无需容器裁切）+ 旋转动画
  const animatedCoverStyle = useMemo(() => ({
    width: size,
    height: size,
    borderRadius: radius,
    transform: [{ rotate: spin }],
  } as any), [size, radius, spin]);

  // 无封面 URL 时回退到通用 Image 组件（显示 EmptyPic 占位）
  const emptyImageStyle = useMemo(() => ({
    width: '100%',
    height: '100%',
    borderRadius: radius,
  } as any), [radius]);

  return (
    <View style={styles.container}>
      <TouchableWithoutFeedback onLongPress={handleLongPress}>
        <View
          ref={coverRef}
          collapsable={false}
          style={coverContainerStyle}
        >
          {coverUrl && !isLoadError ? (
            <AnimatedCover
              source={{
                uri: coverUrl,
                headers: defaultHeaders,
                priority: 'normal',
                cache: 'immutable',
              }}
              style={animatedCoverStyle}
              resizeMode={FastImage.resizeMode.cover}
              onError={handleCoverError}
            />
          ) : (
            <Image url={coverUrl} style={emptyImageStyle} />
          )}
        </View>
      </TouchableWithoutFeedback>
      {menuVisible && <Menu ref={menuRef} menus={menus} onPress={handleMenuPress} onHide={() => setMenuVisible(false)} />}
    </View>
  );
});

const styles = createStyle({
  container: {
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
