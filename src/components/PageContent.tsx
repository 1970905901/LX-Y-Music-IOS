// import { useEffect, useState } from 'react'
import { View, Dimensions } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import ImageBackground from '@/components/common/ImageBackground'
import { useWindowSize, useHorizontalMode } from '@/utils/hooks'
import { useMemo } from 'react'
import { scaleSizeAbsHR } from '@/utils/pixelRatio'
import { defaultHeaders } from './common/Image'
import SizeView from './SizeView'
import { useBgPic } from '@/store/common/hook'

import { useSettingValue } from '@/store/setting/hook'
interface Props {
  children: React.ReactNode
}

// const BLUR_RADIUS = Math.max(scaleSizeAbsHR(18), 10)

export default ({ children }: Props) => {
  const theme = useTheme();
  const windowSize = useWindowSize();
  const isHorizontal = useHorizontalMode();
  // 平板/大屏竖屏（宽 ≥ 700pt）限制内容宽度并居中，避免列表与文字行被拉得过长；
  // 手机竖屏（宽 < 700）与所有横屏（已由各自布局处理）不受影响。
  const isWidePortrait = !isHorizontal && windowSize.width >= 700;
  const dynamicPic = useBgPic();
  const customBgPicPath = useSettingValue('theme.customBgPicPath');
  const pic = customBgPicPath || dynamicPic;
  const picOpacity = useSettingValue('theme.picOpacity');
  const blur = useSettingValue('theme.blur');
  // const BLUR_RADIUS = Math.max(scaleSizeAbsHR(blur), 10)
  const BLUR_RADIUS = blur

  const contentComponent = useMemo(() => {
    // Use screen dimensions for background to cover cutout/notch area in edge-to-edge mode
    const screenSize = Dimensions.get('screen');
    const windowDims = Dimensions.get('window');
    const bgWidth = Math.max(screenSize.width, windowSize.width);
    const bgHeight = Math.max(screenSize.height, windowSize.height);

    return (
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <ImageBackground
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: bgHeight,
            width: bgWidth,
            backgroundColor: theme['c-content-background'],
          }}
          source={pic ? { uri: pic, headers: defaultHeaders } : theme['bg-image']}
          resizeMode="cover"
          blurRadius={pic ? BLUR_RADIUS : undefined}
        >
          {pic ? (
            <View
              style={{
                flex: 1,
                flexDirection: 'column',
                backgroundColor: theme['c-content-background'],
                opacity: picOpacity / 100,
              }}
            ></View>
          ) : null}
        </ImageBackground>
        <View
          style={{
            flex: 1,
            flexDirection: 'column',
            // 全局左右内收：所有屏幕内容稍离屏幕边缘（背景图仍全屏不受影响）
            paddingHorizontal: 6,
            backgroundColor: pic ? undefined : theme['c-main-background'],
            // 平板/大屏竖屏下限制内容宽度并居中，避免列表与文字行被拉得过长；
            // 手机竖屏（宽 < 700）与所有横屏（已由各自布局处理）不受影响。
            maxWidth: isWidePortrait ? 700 : undefined,
            alignSelf: isWidePortrait ? 'center' : undefined,
          }}
        >
          {children}
        </View>
      </View>
    );
  }, [children, pic, theme, windowSize.height, windowSize.width, BLUR_RADIUS, picOpacity, isWidePortrait]);

  return (
    <>
      <SizeView />
      {contentComponent}
    </>
  );
}
