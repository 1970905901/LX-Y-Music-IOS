import { useCallback, useEffect, useState } from 'react'

import { getBgPicColor, getBlurredPic, getCachedBgPicColor, getCachedBlurredPic, invalidateBlurredPic } from '@/utils/nativeModules/utils'

/**
 * 取「已模糊的背景图」本地缓存地址（原生按 图片地址 + 模糊半径 生成一次并落盘复用，
 * 见 AppDelegate.mm 的 UtilsModule.getBlurredPic）。
 *
 * 背景类图片（整屏动态背景 / 页面顶部封面）原先由 Image 的 blurRadius 在每次挂载时重算，
 * 整屏图解码 + 模糊要几十毫秒，这段时间只画得出底色（浅色主题是纯白）= 进入页面「闪一下白色」。
 * 用本地缓存图后首帧即可绘制（模糊算法与 RN 的 blurRadius 完全一致，观感不变）。
 *
 * 地址与平均色都会在 utils 侧长期记在内存里：同一张背景图（Home 与详情页共用同一个动态背景）
 * 第二次挂载时可【同步】拿到地址，首帧就画出真实背景——这是「点迷你播放器进详情页闪白」的关键，
 * 只把模糊结果落盘仍要等一次异步桥调用，那 1~2 帧的空白底就是用户看到的白。
 *
 * 返回 [uri, onImageError, avgColor]：
 * - uri 为 null 表示缓存尚未就绪 / 不可用，调用方应继续用 blurRadius 兜底（观感一致）；
 * - 把 onImageError 挂到 Image 上，缓存文件被「清理缓存」删掉时可自动回退，不会留下空白底；
 * - avgColor 为该背景图的平均色（#RRGGBB，未知时 null），供转场背景色 / 首帧底色使用。
 */
export const useBlurredPic = (
  uri: string | null | undefined,
  blurRadius: number,
): [string | null, () => void, string | null] => {
  // 初始值直接取内存缓存：命中时首帧就能画本地图，不再经历“等桥调用”的空白帧。
  const [blurredUri, setBlurredUri] = useState<string | null>(() => getCachedBlurredPic(uri, blurRadius))
  const [avgColor, setAvgColor] = useState<string | null>(() => getCachedBgPicColor(uri, blurRadius))

  useEffect(() => {
    if (!uri || blurRadius <= 0) {
      setBlurredUri(null)
      setAvgColor(null)
      return
    }

    const cachedPath = getCachedBlurredPic(uri, blurRadius)
    if (cachedPath) setBlurredUri(cachedPath)
    const cachedColor = getCachedBgPicColor(uri, blurRadius)
    if (cachedColor) setAvgColor(cachedColor)

    let cancelled = false
    const run = async() => {
      const path = cachedPath ?? await getBlurredPic(uri, blurRadius)
      if (cancelled) return
      if (path) setBlurredUri(path)
      // 平均色必须在拿到模糊图地址之后再取：原生侧此时才保证模糊图（及同名色值文件）存在。
      const color = await getBgPicColor(uri, blurRadius)
      if (cancelled) return
      setAvgColor(color)
    }
    void run()
    return () => { cancelled = true }
  }, [uri, blurRadius])

  const onImageError = useCallback(() => {
    // 缓存文件被「清理缓存」删除等异常：作废本地记录，回退到远程图 + blurRadius 兜底，
    // 并让下次挂载重新向原生索取（否则会一直拿着已失效的地址）。
    invalidateBlurredPic(uri, blurRadius)
    setBlurredUri(null)
  }, [uri, blurRadius])

  return [blurredUri, onImageError, avgColor]
}

export default useBlurredPic
