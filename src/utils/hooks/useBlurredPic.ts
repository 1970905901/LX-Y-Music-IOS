import { useCallback, useEffect, useState } from 'react'

import { getBlurredPic } from '@/utils/nativeModules/utils'

/**
 * 取「已模糊的背景图」本地缓存地址（原生按 图片地址 + 模糊半径 生成一次并落盘复用，
 * 见 AppDelegate.mm 的 UtilsModule.getBlurredPic）。
 *
 * 背景类图片（整屏动态背景 / 页面顶部封面）原先由 Image 的 blurRadius 在每次挂载时重算，
 * 整屏图解码 + 模糊要几十毫秒，这段时间只画得出底色（浅色主题是纯白）= 进入页面「闪一下白色」。
 * 用本地缓存图后首帧即可绘制（模糊算法与 RN 的 blurRadius 完全一致，观感不变）。
 *
 * 返回 [uri, onImageError]：
 * - uri 为 null 表示缓存尚未就绪 / 不可用，调用方应继续用 blurRadius 兜底（观感一致）；
 * - 把 onImageError 挂到 Image 上，缓存文件被「清理缓存」删掉时可自动回退，不会留下空白底。
 */
export const useBlurredPic = (
  uri: string | null | undefined,
  blurRadius: number,
): [string | null, () => void] => {
  const [blurredUri, setBlurredUri] = useState<string | null>(null)

  useEffect(() => {
    if (!uri || blurRadius <= 0) {
      setBlurredUri(null)
      return
    }
    let cancelled = false
    void getBlurredPic(uri, blurRadius).then((path) => {
      if (!cancelled && path) setBlurredUri(path)
    })
    return () => { cancelled = true }
  }, [uri, blurRadius])

  const onImageError = useCallback(() => { setBlurredUri(null) }, [])

  return [blurredUri, onImageError]
}

export default useBlurredPic
