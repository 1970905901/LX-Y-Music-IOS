// import { useEffect, useState } from 'react'
import { View, StyleSheet, Animated } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import ImageBackground from '@/components/common/ImageBackground'
import { useMemo, useEffect, useRef } from 'react'
import { defaultHeaders } from './common/Image'
import SizeView from './SizeView'
import { useBgPic } from '@/store/common/hook'

import { useSettingValue } from '@/store/setting/hook'
interface Props {
  children: React.ReactNode
  // 进入该页面时，动态背景从白色平滑淡入到彩色（用于从纯白迷你播放器进入详情页，
  // 避免“白块→动态背景”的生硬跳变）。仅在存在动态/自定义背景时生效。
  backgroundFadeIn?: boolean
}

// const BLUR_RADIUS = Math.max(scaleSizeAbsHR(18), 10)

export default ({ children, backgroundFadeIn = false }: Props) => {
  const theme = useTheme();
  const dynamicPic = useBgPic();
  const customBgPicPath = useSettingValue('theme.customBgPicPath');
  const pic = customBgPicPath || dynamicPic;
  const picOpacity = useSettingValue('theme.picOpacity');
  const blur = useSettingValue('theme.blur');
  // const BLUR_RADIUS = Math.max(scaleSizeAbsHR(blur), 10)
  const BLUR_RADIUS = blur

  // 仅当“开启背景淡入”且“当前确实有动态/自定义背景”时才淡入；否则直接显示。
  const shouldFade = backgroundFadeIn && !!pic
  // 背景透明度动画：0（白）→ 1（完整动态背景）。初始值取决于是否淡入。
  const bgOpacity = useRef(new Animated.Value(shouldFade ? 0 : 1)).current
  useEffect(() => {
    if (!shouldFade) {
      bgOpacity.setValue(1)
      return
    }
    bgOpacity.setValue(0)
    const anim = Animated.timing(bgOpacity, {
      toValue: 1,
      // 与 navigation 整页 alpha 转场（350ms）对齐，确保背景白→彩与整页淡入同步完成。
      duration: 350,
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [shouldFade, bgOpacity])

  const contentComponent = useMemo(() => {
    return (
      <View style={{ flex: 1, overflow: 'hidden' }}>
        {/* 淡入时的白色底：动画进行中背景半透明，透出此白色，形成“白→彩色”的平滑过渡；
            动画结束后动态背景完全不透明，白色底被完全覆盖、无残留影响。仅淡入时存在。 */}
        {shouldFade ? (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#ffffff' }]} />
        ) : null}
        <Animated.View
          style={[StyleSheet.absoluteFillObject, { opacity: bgOpacity }]}
          pointerEvents="none"
        >
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
        </Animated.View>
        <Animated.View
          style={[
            {
              flex: 1,
              flexDirection: 'column',
              backgroundColor: pic ? undefined : theme['c-main-background'],
            },
            // 内容层不再单独淡入：整页的淡入/淡出由 navigation 的 RNN content alpha 转场统一
            // 负责，这里若再叠一层 bgOpacity 会造成“双重淡入”让文字出现偏慢。背景白→彩的
            // 淡入由上方背景层独立负责，二者同步即可形成连贯观感。
          ]}
        >
          {children}
        </Animated.View>
      </View>
    );
  }, [children, pic, theme, BLUR_RADIUS, picOpacity, shouldFade, bgOpacity]);

  return (
    <>
      <SizeView />
      {contentComponent}
    </>
  );
}
