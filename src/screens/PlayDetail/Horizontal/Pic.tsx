import { memo, useEffect, useMemo, useRef, useCallback } from 'react';
import { Animated, Easing, View } from 'react-native';
import { usePlayerMusicInfo, useIsPlay } from '@/store/player/hook';
import { useWindowSize } from '@/utils/hooks';
import { createStyle } from '@/utils/tools';
import { shadow } from '@/utils/shadow';
import { HEADER_HEIGHT } from './components/Header';
import { BTN_WIDTH } from './MoreBtn/Btn';
import { marginLeft } from './constant';
import Image from '@/components/common/Image';
import { useStatusbarHeight } from '@/store/common/hook';
import { useSettingValue } from '@/store/setting/hook';
import { useLandscapeLayout, getLeftWidth } from '@/utils/landscapeLayout';

export default memo(({ componentId }: { componentId: string }) => {
  const musicInfo = usePlayerMusicInfo();
  const { width: winWidth, height: winHeight } = useWindowSize();
  const layout = useLandscapeLayout();
  const statusBarHeight = useStatusbarHeight();
  const isPlay = useIsPlay();
  const isCoverSpin = useSettingValue('playDetail.isCoverSpin');
  const coverSizeRaw = useSettingValue('playDetail.style.coverSize');
  const coverSize = typeof coverSizeRaw === 'number' && !isNaN(coverSizeRaw) ? coverSizeRaw : 100;
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
    }
  }, [isPlay, isCoverSpin, startAnimation, stopAnimation]);

  useEffect(() => {
    stopAnimation();
    spinValue.setValue(0);
    if (isPlay && isCoverSpin) {
      startAnimation();
    }
  }, [musicInfo.id, isCoverSpin, startAnimation, stopAnimation, spinValue]);

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
    // 歌词区被限宽时，多出来的空间由左半区吸收，因此按左半区实际宽度推导封面尺寸，
    // 避免封面与信息区脱节。手机横屏（medium 档）下结果与历史计算完全一致。
    const leftWidth = getLeftWidth(winWidth, layout);
    let baseWidth = Math.min(
      (leftWidth - marginLeft - BTN_WIDTH) * layout.coverFillRatio,
      (winHeight - statusBarHeight - HEADER_HEIGHT) * layout.coverHeightRatio,
    );
    baseWidth -= baseWidth * (global.lx.fontSize - 1) * 0.3;
    const imgWidth = baseWidth * (coverSize / 100);
    const radius = isCoverSpin ? imgWidth / 2 : 4;
    return {
      width: imgWidth,
      height: imgWidth,
      borderRadius: radius,
      // 跨平台阴影：iOS 用 shadow 系列，Android 用 elevation
      ...shadow(3),
      opacity: 1,
      backgroundColor: 'transparent',
      overflow: 'hidden',
    };
  }, [winWidth, winHeight, statusBarHeight, isCoverSpin, coverSize, layout]);

  const imageStyle = useMemo(() => ({
    width: '100%',
    height: '100%',
    borderRadius: imageContainerStyle.borderRadius,
  } as any), [imageContainerStyle.borderRadius]);

  let contentHeight = (winHeight - statusBarHeight - HEADER_HEIGHT) * 0.66;
  contentHeight -= contentHeight * (global.lx.fontSize - 1) * 0.2;

  return (
    <View style={{ ...styles.container, height: contentHeight }}>
      <View style={[styles.content, imageContainerStyle, { overflow: 'hidden' }]}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: imageContainerStyle.borderRadius, transform: [{ rotate: spin }] }}>
          <Image
            url={musicInfo.pic}
            style={imageStyle}
          />
        </Animated.View>
      </View>
    </View>
  );
});

const styles = createStyle({
  container: {
    flexShrink: 1,
    flexGrow: 0,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  content: {
    backgroundColor: 'rgba(0,0,0,0)',
  },
});
