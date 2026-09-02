import { useCallback, useRef } from 'react'
import { type LayoutChangeEvent } from 'react-native'

import { clamp01 } from '@/utils/tools'

export const useDrag = (
  onSetProgress: (progress: number) => void,
  onDragState: (drag: boolean) => void,
  setDragProgress: (progress: number) => void,
  onPreview?: (progress: number) => void
) => {
  const info = useRef({
    isDraging: false,
    dragStartX: 0,
    dragStartProgress: 0,
    dragProgress: 0,
    progressWidth: 0,
  })

  const onDragStart = useCallback(
    (offsetX: number, locationX: number) => {
      // 宽度尚未测量成功（首次布局前 / iPad 旋转中 / 容器被折叠为 0 宽）时直接放弃本次手势。
      // 否则 locationX / 0 = Infinity，会被下面的 clamp 收成 1，
      // 表现为「轻轻一点进度条，歌曲直接跳到结尾」。
      if (!(info.current.progressWidth > 0)) return

      info.current.isDraging = true
      info.current.dragStartX = offsetX

      const val = clamp01(locationX / info.current.progressWidth)

      setDragProgress((info.current.dragStartProgress = info.current.dragProgress = val))
      // dragProgress.value = msEvent.msDownProgress = val
      onDragState(true)
      // 拖动开始即预览一次，让歌词高亮行立即跟随手指初始位置
      onPreview?.(val)
    },
    [onDragState, setDragProgress, onPreview]
  )
  const onDragEnd = useCallback(() => {
    if (info.current.isDraging) onSetProgress(info.current.dragProgress)
    info.current.isDraging = false
    onDragState(false)
  }, [onDragState, onSetProgress])
  const onDrag = useCallback(
    (offsetX: number) => {
      if (!info.current.isDraging) return
      // 同上：宽度不可用时不推进拖动，避免 Infinity 被 clamp 成 1 直接跳到结尾。
      if (!(info.current.progressWidth > 0)) return

      const progress = clamp01(
        info.current.dragStartProgress +
          (offsetX - info.current.dragStartX) / info.current.progressWidth
      )

      setDragProgress((info.current.dragProgress = progress))
      // 拖动过程中实时预览歌词时钟，让高亮行跟随进度条
      onPreview?.(progress)
    },
    [setDragProgress, onPreview]
  )

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width
    // 只接受有效的正宽度：布局过程中可能出现 0（旋转 / 折叠），
    // 此时保留上一次的可用宽度，避免把进度条基准宽度清成 0。
    if (width > 0) info.current.progressWidth = width
  }, [])

  // const onPress = useCallback((locationX: number) => {
  //   onSetProgress(locationX / info.current.progressWidth)
  // }, [onSetProgress])

  return {
    onLayout,
    onDragStart,
    onDragEnd,
    onDrag,
  }
}
