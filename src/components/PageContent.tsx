// import { useEffect, useState } from 'react'
import { View, StyleSheet, Animated } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import ImageBackground from '@/components/common/ImageBackground'
import { useMemo, useEffect, useRef, useState } from 'react'
import { defaultHeaders } from './common/Image'
import SizeView from './SizeView'
import { useBgPic } from '@/store/common/hook'
import { useBlurredPic } from '@/utils/hooks/useBlurredPic'

import { useSettingValue } from '@/store/setting/hook'
interface Props {
  children: React.ReactNode
  // 进入该页面时，动态背景从底色平滑淡入到完整背景（用于从迷你播放器进入详情页，
  // 避免“空白底色→动态背景”的生硬跳变）。仅在存在动态/自定义背景、且首帧还画不出
  // 背景（模糊图尚未就绪）时生效；首帧就能画出背景时直接显示，否则那段淡入就是闪白。
  backgroundFadeIn?: boolean
}

// const BLUR_RADIUS = Math.max(scaleSizeAbsHR(18), 10)

export default ({ children, backgroundFadeIn = false }: Props) => {
  const theme = useTheme()
  const dynamicPic = useBgPic()
  const customBgPicPath = useSettingValue('theme.customBgPicPath')
  const pic = customBgPicPath || dynamicPic
  const picOpacity = useSettingValue('theme.picOpacity')
  const blur = useSettingValue('theme.blur')
  // const BLUR_RADIUS = Math.max(scaleSizeAbsHR(blur), 10)
  const BLUR_RADIUS = blur

  // 已模糊背景图（本地缓存）地址：原生按 图片地址 + 模糊半径 生成一次并落盘复用。
  // 拿到它之前仍用 Image 的 blurRadius 兜底，因此观感与改动前完全一致（同一套模糊算法），
  // 只是进入页面时不再每次重算一遍整屏模糊——那几十毫秒的空白底就是“闪一下白色”。
  const [blurredPicUri, handleBlurredPicError, blurredPicColor] = useBlurredPic(pic, BLUR_RADIUS)

  // 挂载当帧是否已同步拿到模糊图（Home 与详情页共用同一张背景图，缓存命中的是常态）。
  // 已拿到就说明第一帧就能画出真实背景，此时必须【跳过白底淡入】——那段 350ms 的白底
  // 正是“点迷你播放器进入播放详情页闪白”的主因；不满足时（冷启动 / 首次遇到该背景，
  // 模糊还没算好）仍保留淡入，避免“空白底 → 背景”的硬跳变。
  const hadBlurredPicAtMount = useRef(blurredPicUri != null).current
  // 首帧底色 / 淡入起点色：优先用背景图平均色（与该页真实背景接近），未知时退回主题底色。
  const bgLayerColor = blurredPicColor ?? theme['c-content-background']

  // 仅当“开启背景淡入”且“当前确实有动态/自定义背景”且“首帧画不出背景”时才淡入；否则直接显示。
  const shouldFade = backgroundFadeIn && !!pic && !hadBlurredPicAtMount
  // 背景透明度动画：0（底色）→ 1（完整动态背景）。初始值取决于是否淡入。
  const bgOpacity = useRef(new Animated.Value(shouldFade ? 0 : 1)).current
  useEffect(() => {
    if (!shouldFade) {
      bgOpacity.setValue(1)
      return
    }
    bgOpacity.setValue(0)
    const anim = Animated.timing(bgOpacity, {
      toValue: 1,
      // 与 navigation 整页 alpha 转场（350ms）对齐，确保底色→背景与整页淡入同步完成。
      duration: 350,
      useNativeDriver: true,
    })
    anim.start()
    return () => { anim.stop() }
  }, [shouldFade, bgOpacity])

  // 首帧只挂载背景层，页面内容延后一帧再挂载。
  // 动态/自定义背景是一整屏图片，需要解码 + 高斯模糊（几十毫秒，绘制必须等它算完）；
  // 若背景与页面内容在同一个 commit 里挂载，这段时间会被“先渲染整个页面”占满，
  // 期间屏幕上什么都没有，只能看到转场底色（浅色主题是纯白）——即“进入设置 / 详情页闪一下白色”。
  // 让背景层先挂载，图片解码与模糊能在内容就绪前就开始，内容随后补上，露白窗口明显缩短。
  // SizeView 不受影响（它在 contentComponent 之外），窗口尺寸仍在首帧完成测量。
  const [contentReady, setContentReady] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => { setContentReady(true) })
    return () => { cancelAnimationFrame(raf) }
  }, [])

  const contentComponent = useMemo(() => {
    return (
      <View style={{ flex: 1, overflow: 'hidden' }}>
        {/* 淡入时的底色：动画进行中背景半透明，透出此底色形成平滑过渡；动画结束后动态背景
            完全不透明，底色被完全覆盖、无残留影响。仅淡入时存在。
            底色用「背景图平均色」而非纯白：纯白会在浅色主题下与整屏模糊封面形成明显色差，
            淡入过程本身就是一次肉眼可见的“闪白”；用平均色后过渡几乎不可察觉。 */}
        {shouldFade ? (
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: bgLayerColor }]} />
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
              // 图片解码完成前透出的底色：用背景平均色（与该图接近）代替纯白，
              // 使「转场/首帧 → 图片」这几帧不再是白 → 彩的突变。
              backgroundColor: bgLayerColor,
            }}
            // 优先用原生缓存的「已模糊本地图」（无需 blurRadius，首帧即可绘制）；
            // 缓存尚未就绪时回退到原方案（远程图 + blurRadius），两者像素结果一致。
            source={pic
              ? (blurredPicUri ? { uri: blurredPicUri } : { uri: pic, headers: defaultHeaders })
              : theme['bg-image']}
            resizeMode="cover"
            blurRadius={pic && !blurredPicUri ? BLUR_RADIUS : undefined}
            // 缓存文件被「清理缓存」删掉等异常情况：回退到原方案（远程图 + blurRadius），
            // 自愈而不会留下一块空白底。
            onError={blurredPicUri ? handleBlurredPicError : undefined}
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
          {contentReady ? children : null}
        </Animated.View>
      </View>
    )
  }, [children, contentReady, pic, blurredPicUri, handleBlurredPicError, theme, BLUR_RADIUS, picOpacity, shouldFade, bgOpacity, bgLayerColor, hadBlurredPicAtMount])

  return (
    <>
      <SizeView />
      {contentComponent}
    </>
  )
}
