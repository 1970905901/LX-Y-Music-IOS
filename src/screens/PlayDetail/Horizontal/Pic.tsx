import { memo, useEffect, useMemo, useRef, useCallback } from 'react'
import { Animated, Easing, View } from 'react-native'
import { usePlayerMusicInfo, useIsPlay } from '@/store/player/hook'
import { useWindowSize } from '@/utils/hooks'
import { createStyle } from '@/utils/tools'
import { shadow } from '@/utils/shadow'
import { HEADER_HEIGHT } from './components/Header'
import { BTN_WIDTH } from './MoreBtn/Btn'
import { marginLeft } from './constant'
import Image from '@/components/common/Image'
import { useStatusbarHeight, useAppActive, usePlayDetailCovered } from '@/store/common/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useLandscapeLayout, getLeftWidth } from '@/utils/landscapeLayout'
import CoverLongPressMenu from '../components/CoverLongPressMenu'

export default memo(({ componentId: _componentId }: { componentId: string }) => {
  const musicInfo = usePlayerMusicInfo()
  const { width: winWidth, height: winHeight } = useWindowSize()
  const layout = useLandscapeLayout()
  const statusBarHeight = useStatusbarHeight()
  const isPlay = useIsPlay()
  const isCoverSpin = useSettingValue('playDetail.isCoverSpin')
  const coverShape = useSettingValue('playDetail.style.coverShape')
  // 方形封面强制不旋转（与竖屏 Pic.tsx 同一套语义，见 SettingCoverShape.tsx）。
  const isSquare = coverShape === 'square'
  const allowSpin = isCoverSpin && !isSquare
  const coverSizeRaw = useSettingValue('playDetail.style.coverSize')
  const coverSize = typeof coverSizeRaw === 'number' && !isNaN(coverSizeRaw) ? coverSizeRaw : 100
  const spinValue = useRef(new Animated.Value(0)).current
  const animationRef = useRef<Animated.CompositeAnimation | null>(null)
  const isAnimating = useRef(false)
  const isUnmounted = useRef(false)

  // 不可见即停（前台省电）：封面旋转是原生驱动动画，被压栈页覆盖 / App 退后台时
  // iOS 都不会自动暂停它，必须显式停掉；恢复时从当前角度继续旋转。
  const covered = usePlayDetailCovered()
  const appActive = useAppActive()
  const spinAllowed = allowSpin && !covered && appActive

  const createAnimation = useCallback((value: number) => {
    return Animated.timing(spinValue, {
      toValue: 1,
      duration: 25000 * (1 - value),
      easing: Easing.linear,
      useNativeDriver: true,
    })
  }, [spinValue])

  const startAnimation = useCallback(() => {
    if (isAnimating.current || !spinAllowed || isUnmounted.current) return
    isAnimating.current = true
    spinValue.stopAnimation(value => {
      if (isUnmounted.current) return
      animationRef.current = createAnimation(value)
      animationRef.current.start(({ finished }) => {
        if (finished && isAnimating.current && !isUnmounted.current) {
          spinValue.setValue(0)
          isAnimating.current = false
          startAnimation()
        }
      })
    })
  }, [spinValue, createAnimation, spinAllowed])

  const stopAnimation = useCallback(() => {
    if (!isAnimating.current) return
    isAnimating.current = false
    animationRef.current?.stop()
    animationRef.current = null
    spinValue.stopAnimation()
  }, [spinValue])

  useEffect(() => {
    if (isPlay && spinAllowed) {
      startAnimation()
    } else {
      stopAnimation()
    }
  }, [isPlay, spinAllowed, startAnimation, stopAnimation])

  useEffect(() => {
    stopAnimation()
    spinValue.setValue(0)
    if (isPlay && spinAllowed) {
      startAnimation()
    }
  }, [musicInfo.id, isPlay, spinAllowed, startAnimation, stopAnimation, spinValue])

  useEffect(() => {
    return () => {
      isUnmounted.current = true
      stopAnimation()
    }
  }, [stopAnimation])

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  })

  const imageContainerStyle = useMemo(() => {
    // 歌词区被限宽时，多出来的空间由左半区吸收，因此按左半区实际宽度推导封面尺寸，
    // 避免封面与信息区脱节。手机横屏（medium 档）下结果与历史计算完全一致。
    const leftWidth = getLeftWidth(winWidth, layout)
    let baseWidth = Math.min(
      (leftWidth - marginLeft - BTN_WIDTH) * layout.coverFillRatio,
      (winHeight - statusBarHeight - HEADER_HEIGHT) * layout.coverHeightRatio,
    )
    baseWidth -= baseWidth * (global.lx.fontSize - 1) * 0.3
    const imgWidth = baseWidth * (coverSize / 100)
    const radius = isSquare ? 4 : imgWidth / 2
    return {
      width: imgWidth,
      height: imgWidth,
      borderRadius: radius,
      // iOS 浮层阴影（仅 iPhone/iPad）
      ...shadow(3),
      opacity: 1,
      backgroundColor: 'transparent',
      overflow: 'hidden',
    }
  }, [winWidth, winHeight, statusBarHeight, isSquare, coverSize, layout])

  const imageStyle = useMemo(() => ({
    width: '100%',
    height: '100%',
    borderRadius: imageContainerStyle.borderRadius,
  } as any), [imageContainerStyle.borderRadius])

  let contentHeight = (winHeight - statusBarHeight - HEADER_HEIGHT) * 0.66
  contentHeight -= contentHeight * (global.lx.fontSize - 1) * 0.2

  return (
    <View style={{ ...styles.container, height: contentHeight }}>
      {/* 长按封面 → 下载歌曲 / 下载封面：与竖屏共用 CoverLongPressMenu（同尺寸热区，保证菜单定位对齐封面） */}
      <CoverLongPressMenu
        musicInfo={musicInfo as unknown as LX.Player.PlayMusicInfo['musicInfo']}
        coverUrl={musicInfo.pic ?? ''}
        style={{ width: imageContainerStyle.width, height: imageContainerStyle.height }}
      >
        <View style={[styles.content, imageContainerStyle, { overflow: 'hidden' }]}>
          <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: imageContainerStyle.borderRadius, transform: [{ rotate: spin }] }}>
            <Image
              url={musicInfo.pic}
              style={imageStyle}
            />
          </Animated.View>
        </View>
      </CoverLongPressMenu>
    </View>
  )
})

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
})
