import { useCallback, useMemo, useRef } from 'react'

/**
 * 「首次进入整页上飘」修正（页头被顶到刘海/灵动岛后面，返回再进就正常）。
 *
 * 现象：进入首页 PagerView 里的懒加载页（我的收藏 / 试听列表 / 平台每日推荐…）时，
 * 首帧的可用高度与插图（页面还没完成布局/测量）与最终不一致，FlatList 会把首帧算出的
 * contentOffset 保留下来；随后布局稳定，列表内容整体上移一段（≈ 页头高度），
 * 于是页头被顶出屏幕。第二次进入时布局已稳定，不再出现。
 *
 * 处理：在**用户尚未手动滑动**的前提下，布局/内容尺寸稳定后把偏移归零（无动画）；
 * 用户一旦拖动过（onScrollBeginDrag），或超过保护窗口（默认 2s），本 hook 不再干预，
 * 因此不会影响后续滚动、也不会和「定位到当前播放」这类程序化滚动打架。
 *
 * 用法：
 *   const guard = usePhantomScrollGuard(flatListRef)
 *   <FlatList ref={flatListRef} {...guard} />
 */
export const usePhantomScrollGuard = (
  listRef: { current: { scrollToOffset?: (params: { offset: number, animated?: boolean }) => void } | null },
  /** 归零保护窗口（ms）：只有进入该页后的这段时间内才修偏移 */
  windowMs = 2000,
) => {
  const mountAtRef = useRef(Date.now())
  const userScrolledRef = useRef(false)
  const offsetRef = useRef(0)

  // 省电：超出保护窗口或用户已滑动后，onScroll 立刻早退（只做一次时间比较），
  // 不再逐帧读写 ref，列表滚动期间的 JS 开销降到最低。
  const isGuardActive = useCallback(
    () => !userScrolledRef.current && Date.now() - mountAtRef.current <= windowMs,
    [windowMs],
  )

  const reset = useCallback(() => {
    if (!isGuardActive()) return
    if (offsetRef.current <= 0) return
    listRef.current?.scrollToOffset?.({ offset: 0, animated: false })
  }, [listRef, isGuardActive])

  const handleScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    if (!isGuardActive()) return
    offsetRef.current = e.nativeEvent.contentOffset.y
  }, [isGuardActive])

  const handleScrollBeginDrag = useCallback(() => {
    userScrolledRef.current = true
  }, [])

  return useMemo(() => ({
    onScroll: handleScroll,
    onScrollBeginDrag: handleScrollBeginDrag,
    onLayout: reset,
    onContentSizeChange: reset,
    scrollEventThrottle: 16,
  }), [handleScroll, handleScrollBeginDrag, reset])
}
