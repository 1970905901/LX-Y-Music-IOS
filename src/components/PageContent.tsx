// import { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import ImageBackground from '@/components/common/ImageBackground'
import { useMemo } from 'react'
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
  const dynamicPic = useBgPic();
  const customBgPicPath = useSettingValue('theme.customBgPicPath');
  const pic = customBgPicPath || dynamicPic;
  const picOpacity = useSettingValue('theme.picOpacity');
  const blur = useSettingValue('theme.blur');
  // const BLUR_RADIUS = Math.max(scaleSizeAbsHR(blur), 10)
  const BLUR_RADIUS = blur

  const contentComponent = useMemo(() => {
    return (
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <ImageBackground
          // 背景用 absoluteFill 撑满本容器（页面区域），而不是写死窗口尺寸：
          // 1) 不能取 Dimensions.get('screen')：iPad 分屏 / Slide Over / Stage Manager 下
          //    screen 是整块物理屏（如 1194pt），窗口可能只有 320~500pt，会导致背景
          //    被铺到整屏宽并裁切（观感：背景突然变大变糊、不随窗口居中）。
          // 2) 也不能写死 windowSize.width/height：首帧 windowSize 尚未测量时为 {0,0}，
          //    背景会被渲染成 0 尺寸而看不见（开启动态背景后表现为背景不显示/闪烁），
          //    且容器与窗口不等时（页面被抽屉等容器包裹）会错位或底部被裁。
          // 用 absoluteFill 由布局系统保证精确铺满，自动适配手机/iPad/横竖屏/分屏。
          style={{
            ...StyleSheet.absoluteFillObject,
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
            backgroundColor: pic ? undefined : theme['c-main-background'],
          }}
        >
          {children}
        </View>
      </View>
    );
  }, [children, pic, theme, BLUR_RADIUS, picOpacity]);

  return (
    <>
      <SizeView />
      {contentComponent}
    </>
  );
}
