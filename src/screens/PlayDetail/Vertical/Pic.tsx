import { memo, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { View, Animated, Easing, TouchableWithoutFeedback } from 'react-native'
import FastImage from '@d11/react-native-fast-image'
import { useIsPlay, usePlayerMusicInfo, usePlayMusicInfo } from '@/store/player/hook'
import { useWindowSize } from '@/utils/hooks'
import { useSettingValue } from '@/store/setting/hook'
import Image, { defaultHeaders } from '@/components/common/Image'
import { useStatusbarHeight } from '@/store/common/hook'
import { HEADER_HEIGHT } from './components/Header'
import { createStyle, toast, requestStoragePermission } from '@/utils/tools'
import Menu, { type MenuType, type Menus } from '@/components/common/Menu'
import { addTask } from '@/core/download'
import RNFetchBlob from '@/utils/rnFetchBlob'
import { getPicUrl } from '@/core/music/online'
import { getFileExtensionFromUrl } from '@/screens/Home/Views/Mylist/MusicList/download/utils'
import settingState from '@/store/setting/state'

const AnimatedCover = Animated.createAnimatedComponent(FastImage)

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
 * - 尺寸：基准 min(屏宽 * 0.65, 可用高 * 0.5)，再乘「封面大小」设置（50%~150%，
 *   与横屏 Pic 同一语义）；并用父级量出的可用高度兜底，放大后不会把信息块挤出容器。
 */
export default memo(({ componentId: _componentId, maxCoverHeight = 0 }: { componentId: string, maxCoverHeight?: number }) => {
  const playerMusicInfo = usePlayerMusicInfo()
  const playMusicInfo = usePlayMusicInfo()
  const { width: winWidth, height: winHeight } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const isPlay = useIsPlay()
  const isCoverSpin = useSettingValue('playDetail.isCoverSpin')
  const coverShape = useSettingValue('playDetail.style.coverShape')
  // 方形封面强制不旋转（两者互斥，见 SettingCoverShape.tsx 的说明）。
  // 注意：`isCoverSpin` 在下面被替换为 `allowSpin` 参与动画启停判断，
  // 这样「方形时不旋转」只需一处判据，不会出现「方形 + 旋转」被部分应用。
  const isSquare = coverShape === 'square'
  const allowSpin = isCoverSpin && !isSquare
  // 封面大小设置（50%~150%，100 = 原基准尺寸）：此前只有横屏 Pic 读取该设置，
  // 竖屏写死公式，导致播放详情页里拖动「封面大小」滑杆无效。
  const coverSizeRaw = useSettingValue('playDetail.style.coverSize')
  const coverSize = typeof coverSizeRaw === 'number' && !isNaN(coverSizeRaw) ? coverSizeRaw : 100

  // 封面 URL：playerMusicInfo.pic 已兼容在线 + 下载两种来源（playInfo.ts setPlayerMusicInfo）。
  // 同时兜底 playMusicInfo.musicInfo.meta.picUrl，保证和参考版 e58d1ab1 的数据入口一致。
  const rawMusicInfo = playMusicInfo.musicInfo
  const coverUrl = playerMusicInfo.pic ||
    (rawMusicInfo && ('progress' in rawMusicInfo
      ? (rawMusicInfo).metadata.musicInfo.meta.picUrl
      : (rawMusicInfo).meta?.picUrl)) ||
    ''

  // FastImage 加载失败状态（RN Image 失败时完全空白，无占位；改用 FastImage 并自带错误回退）
  const [isLoadError, setLoadError] = useState(false)
  useEffect(() => {
    setLoadError(false)
  }, [coverUrl])
  const handleCoverError = useCallback(() => {
    setLoadError(true)
  }, [])

  // 当前歌曲 id，用于切歌时重置旋转角度
  const musicId = playerMusicInfo.id

  // 基准封面尺寸（100% 档）
  const baseSize = useMemo(() => {
    const availableHeight = winHeight - statusBarHeight - HEADER_HEIGHT
    return Math.min(winWidth * 0.65, availableHeight * 0.5)
  }, [winWidth, winHeight, statusBarHeight])

  // 实际封面尺寸 = 基准 × 百分比，并用父级量出的可用高度封顶
  // （竖屏封面页是「封面贴顶 + 信息块贴底」的 space-between 布局，
  //   放大到 150% 时必须留出信息块高度，否则信息块会被挤出容器压到控制条上）
  const size = useMemo(() => {
    const scaled = baseSize * (coverSize / 100)
    const limit = maxCoverHeight > 0 ? maxCoverHeight : Number.POSITIVE_INFINITY
    return Math.min(scaled, limit)
  }, [baseSize, coverSize, maxCoverHeight])

  // ---- 旋转动画：采用与横屏/沉浸一致的 createAnimation/start/stop 模式 ----
  // 原 Animated.loop 在首屏挂载时常不启动（进页面不转、切歌才转），
  // 这里改为 stopAnimation -> 取当前角度 -> 重新 timing 的可靠循环方式，
  // 进页面（歌曲已播放）即开始旋转，暂停时停止，切歌时重置角度重新旋转。
  const spinValue = useRef(new Animated.Value(0)).current
  const animationRef = useRef<Animated.CompositeAnimation | null>(null)
  const isAnimating = useRef(false)
  const isUnmounted = useRef(false)

  const createAnimation = useCallback((value: number) => {
    return Animated.timing(spinValue, {
      toValue: 1,
      duration: 25000 * (1 - value),
      easing: Easing.linear,
      useNativeDriver: true,
    })
  }, [spinValue])

  const startAnimation = useCallback(() => {
    if (isAnimating.current || !allowSpin || isUnmounted.current) return
    isAnimating.current = true
    spinValue.stopAnimation((value) => {
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
  }, [spinValue, createAnimation, allowSpin])

  const stopAnimation = useCallback(() => {
    if (!isAnimating.current) return
    isAnimating.current = false
    animationRef.current?.stop()
    animationRef.current = null
    spinValue.stopAnimation()
  }, [spinValue])

  useEffect(() => {
    if (isPlay && allowSpin) {
      startAnimation()
    } else {
      stopAnimation()
    }
  }, [isPlay, allowSpin, startAnimation, stopAnimation])

  useEffect(() => {
    stopAnimation()
    spinValue.setValue(0)
    if (isPlay && allowSpin && musicId) {
      startAnimation()
    }
  }, [musicId, isPlay, allowSpin, startAnimation, stopAnimation, spinValue])

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

  // ---- 长按菜单：下载歌曲 / 下载封面（保留原功能）----
  const menuRef = useRef<MenuType>(null)
  const coverRef = useRef<View>(null)
  const [menuVisible, setMenuVisible] = useState(false)

  const menus = useMemo((): Menus => [
    { action: 'download_song', label: '下载歌曲' },
    { action: 'download_pic', label: '下载封面' },
  ], [])

  const handleLongPress = () => {
    if (!coverRef.current) return
    coverRef.current.measure((x, y, w, h, px, py) => {
      setMenuVisible(true)
      requestAnimationFrame(() => {
        menuRef.current?.show({ x: px, y: py, w, h })
      })
    })
  }

  const menuMusicInfo = playMusicInfo.musicInfo
  const handleMenuPress = ({ action }: typeof menus[number]) => {
    switch (action) {
      case 'download_song':
        if (menuMusicInfo) {
          const quality = settingState.setting['player.playQuality']
          addTask(menuMusicInfo as LX.Music.MusicInfo, quality)
        }
        break
      case 'download_pic':
        if (menuMusicInfo) {
          void (async() => {
            try {
              const isGranted = await requestStoragePermission()
              if (isGranted === false) {
                toast('没有存储权限，无法下载', 'short')
                return
              }
              toast('正在下载封面...', 'short')
              const picUrl = await getPicUrl({ musicInfo: menuMusicInfo as LX.Music.MusicInfoOnline, isRefresh: true })
              const extension = getFileExtensionFromUrl(picUrl)
              const picBaseDir = RNFetchBlob.fs.dirs.PictureDir || RNFetchBlob.fs.dirs.DownloadDir
              const downloadDir = `${picBaseDir}/LX-N-Music`
              const mInfo = menuMusicInfo as LX.Music.MusicInfo
              const fileName = `${mInfo.name}_${mInfo.singer}.${extension}`.replace(/[\\/:*?"<>|]/g, '_')
              const filePath = `${downloadDir}/${fileName}`

              const exists = await RNFetchBlob.fs.exists(downloadDir)
              if (!exists) {
                try {
                  await RNFetchBlob.fs.mkdir(downloadDir)
                } catch (e) {
                  console.warn('mkdir failed')
                }
              }
              const targetPath = (await RNFetchBlob.fs.exists(downloadDir)) ? filePath : `${picBaseDir}/${fileName}`
              await RNFetchBlob.config({ path: targetPath }).fetch('GET', picUrl)
              await RNFetchBlob.fs.scanFile([{ path: targetPath }])
              toast(`封面已保存到: ${targetPath}`, 'long')
            } catch (err: any) {
              toast(`下载封面失败: ${err.message}`, 'long')
            }
          })()
        }
        break
    }
  }

  // 方形封面的圆角：小圆角，保留图本身的方形观感。
  // 与横屏 Pic.tsx 的方形分支保持同一个 4（两处都是「非圆形」档）。
  const SQUARE_RADIUS = 4
  const radius = isSquare ? SQUARE_RADIUS : size / 2
  // 外层容器：只负责固定尺寸与定位，**不做 overflow 裁切**。
  // iOS 上 overflow:'hidden'(clipsToBounds) 的祖先 + 带 transform 的后代
  // 会被错误剔除出渲染树（封面白屏的根因）。圆形效果完全由封面自身的
  // borderRadius 实现——圆形旋转后仍是圆形，视觉与裁切完全一致。
  // 方形同理不需要裁切：方形本来就不旋转，圆角也由封面自身给。
  const coverContainerStyle = useMemo(() => ({
    width: size,
    height: size,
    backgroundColor: 'transparent' as const,
  }), [size])

  // 封面图样式：固定尺寸 + 圆角（圆形=size/2，方形=小圆角）+ 旋转动画
  // （方形时 allowSpin 恒为 false，动画不会启动、角度停在 0）
  const animatedCoverStyle = useMemo(() => ({
    width: size,
    height: size,
    borderRadius: radius,
    transform: [{ rotate: spin }],
  } as any), [size, radius, spin])

  // 无封面 URL 时回退到通用 Image 组件（显示 EmptyPic 占位）
  const emptyImageStyle = useMemo(() => ({
    width: '100%',
    height: '100%',
    borderRadius: radius,
  } as any), [radius])

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
      {menuVisible && <Menu ref={menuRef} menus={menus} onPress={handleMenuPress} onHide={() => { setMenuVisible(false) }} />}
    </View>
  )
})

const styles = createStyle({
  container: {
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
