import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { View, Animated, Easing, TouchableWithoutFeedback } from 'react-native';
import { useIsPlay, usePlayerMusicInfo, usePlayMusicInfo } from '@/store/player/hook';
import { useWindowSize } from '@/utils/hooks';
import { useSettingValue } from '@/store/setting/hook';
import Image from '@/components/common/Image';
import { useStatusbarHeight } from '@/store/common/hook';
import { HEADER_HEIGHT } from './components/Header';
import { createStyle, toast, requestStoragePermission } from '@/utils/tools';
import Menu, { type MenuType, type Menus } from '@/components/common/Menu';
import { addTask } from '@/core/download';
import RNFetchBlob from '@/utils/rnFetchBlob';
import { getPicUrl } from '@/core/music/online';
import { getFileExtensionFromUrl } from '@/screens/Home/Views/Mylist/MusicList/download/utils';
import settingState from '@/store/setting/state';

/**
 * 竖屏播放页封面 —— 完全重写（用户要求"自己做一个"）。
 * - 封面来源：直接取当前播放歌曲 playerMusicInfo.pic（playInfo.ts 已兼容在线 + 下载两来源），
 *   切歌时随歌曲自动更新。
 * - 旋转动画：自己实现无限循环（Animated.loop + useNativeDriver:true），不依赖旧动画逻辑。
 * - 圆形：容器 borderRadius = size/2，overflow:hidden 裁剪旋转方图。
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

  // 封面 URL：当前播放歌曲（兼容在线 + 下载）
  const coverUrl = useMemo(
    () => playerMusicInfo.pic || (playMusicInfo.musicInfo as LX.Music.MusicInfo)?.meta?.picUrl || '',
    [playerMusicInfo.pic, playMusicInfo.musicInfo],
  );

  // 圆形封面尺寸
  const size = useMemo(() => {
    const availableHeight = winHeight - statusBarHeight - HEADER_HEIGHT;
    return Math.min(winWidth * 0.65, availableHeight * 0.5);
  }, [winWidth, winHeight, statusBarHeight]);

  // ---- 旋转动画：自己实现无限循环 ----
  const spinValue = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animRef.current?.stop();
    spinValue.setValue(0);
    if (isPlay && isCoverSpin) {
      const anim = Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 25000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      animRef.current = anim;
      anim.start();
    }
    return () => {
      animRef.current?.stop();
      animRef.current = null;
    };
  }, [isPlay, isCoverSpin, spinValue]);

  // 切歌时重置旋转
  useEffect(() => {
    spinValue.setValue(0);
  }, [playerMusicInfo.id, spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // ---- 长按菜单：下载歌曲 / 下载封面（保留原功能）----
  const musicInfo = playMusicInfo;
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

  const radius = size / 2;
  const imageStyle = useMemo(() => ({ width: '100%', height: '100%', borderRadius: radius } as any), [radius]);

  return (
    <View style={styles.container}>
      <TouchableWithoutFeedback onLongPress={handleLongPress}>
        <View
          ref={coverRef}
          collapsable={false}
          style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden' }}
        >
          <Animated.View style={{ width: '100%', height: '100%', borderRadius: radius, transform: [{ rotate: spin }] }}>
            <Image url={coverUrl} style={imageStyle} />
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
    justifyContent: 'center',
    alignItems: 'center',
  },
});
