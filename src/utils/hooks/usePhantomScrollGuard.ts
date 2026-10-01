import { useCallback, useEffect, useMemo, useRef } from 'react'

/**
 * 「首次进入整页上飘」修正（页头被顶到刘海/灵动岛后面，返回再进就正常）。
 *
 * 现象：进入首页 PagerView 里的页面（QQ 每日推荐「主页推荐」/ 试听列表 / 我的收藏…）时，
 * 内容整体上移一段（≈ 刘海高度），页头被顶出屏幕；返回再进就正常。
 *
 * 根因（判断）：这些页挂在 react-native-pager-view 里，每一页都被包进独立的
 * UIViewController（RNCPagerView 用 UIPageViewController + initWithView）。
 * RN 的 RCTScrollView 默认 automaticallyAdjustContentInsets=YES，会在「最近 VC 的
 * 安全区插图发生变化」时调用 autoAdjustInsetsForView(updateOffset:YES)，直接改写
 * UIScrollView.contentOffset：
 *     contentOffset.y -= (新插图 - 旧插图)
 * 页首次上屏时安全区插图会经历一次计算/落定（页面自身用 PageTopInset 让位刘海，
 * 列表内不再需要额外插图），这一次性变化把 contentOffset 抬到 0 以上、幅度正好
 * 是刘海高度，于是整页上移、页头被推到刘海后面；第二次进入时插图已稳定，
 * 不再发生该变化，所以正常。
 *
 * 处理：进入页面后的一段保护窗口内，只要发现列表被抬到「顶部之上」且幅度是
 * 安全区量级（0 < y <= 120），就无动画拉回 y = 0；用户一旦拖动
 * （onScrollBeginDrag）或调用 stop()（恢复上次滚动位置 / 定位到当前播放等
 * 程序化定位）立即永久停止干预，因此不影响后续滚动与定位。
 *
 * 重要：只纠正「已经实测到的」幽灵偏移（onScroll 事件里的真实 contentOffset）。
 * 绝不在没有实测值的情况下盲发 scrollToOffset(0)——若这台机型的安全区插图本来
 * 就是非 0（正确静止位置是负值），盲归零反而会制造出同款上飘。
 *
 * 触发源：onScroll（原生插图变化会派发一次）+ 窗口内定点复查（防止那次
 * scrollToOffset 之后原生又把偏移顶起来而不再派发事件）。
 *
 * 用法：
 *   const guard = usePhantomScrollGuard(flatListRef)
 *   <FlatList ref={flatListRef} {...guard.props} />
 *   // 需要程序化定位时先 guard.stop()
 */

/** 幽灵偏移的幅度上限（pt）：原生安全区插图变化造成的位移 ≈ 刘海/灵动岛高度（20~60） */
const GHOST_MAX_OFFSET = 120
/** 定时复查时间点（ms）：确认纠正是否被原生二次顶回 */
const RECHECK_AT = [0, 60, 160, 320, 640, 1100, 1800]

export const usePhantomScrollGuard = (
  listRef: { current: { scrollToOffset?: (params: { offset: number, animated?: boolean }) => void } | null },
  /** 保护窗口（ms）：只有进入该页后的这段时间内才修偏移 */
  windowMs = 2500,
) => {
  const mountAtRef = useRef(Date.now())
  const stoppedRef = useRef(false)
  const userScrolledRef = useRef(false)
  const offsetRef = useRef(0)

  // 省电：超出保护窗口、用户已滑动、或被调用方停用后，onScroll 立刻早退
  // （只做一次比较），列表滚动期间的 JS 开销降到最低。
  const isGuardActive = useCallback(
    () => !stoppedRef.current && !userScrolledRef.current && Date.now() - mountAtRef.current <= windowMs,
    [windowMs],
  )

  /**
   * 把「被抬到顶部之上」的幽灵偏移拉回真正的顶部（offset 0 == 内容首行贴列表顶边）。
   * 仅在实测到 0 < y <= GHOST_MAX_OFFSET 时才动手（见文件头注释）。
   */
  const correct = useCallback(() => {
    if (!isGuardActive()) return
    const y = offsetRef.current
    // 只纠正「略微越过顶部」的幽灵偏移：
    // 负值 = 下拉刷新 / 回弹；大正值 = 用户滚动或程序化定位，都不能动。
    // y <= 0.5 时是正常静止位置（含初始值 0），不做任何事。
    if (y <= 0.5 || y > GHOST_MAX_OFFSET) return
    listRef.current?.scrollToOffset?.({ offset: 0, animated: false })
  }, [listRef, isGuardActive])

  const handleScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    if (!isGuardActive()) return
    offsetRef.current = e.nativeEvent.contentOffset.y
    correct()
  }, [isGuardActive, correct])

  const handleScrollBeginDrag = useCallback(() => {
    userScrolledRef.current = true
  }, [])

  // 布局/内容尺寸稳定后复查一次：此时原生若已把偏移顶起来，这里立刻拉回。
  const handleLayout = useCallback(() => { correct() }, [correct])
  const handleContentSizeChange = useCallback(() => { correct() }, [correct])

  // 定时复查兜底（见文件头注释）：窗口内定点再确认几次，仍偏就再拉回。
  useEffect(() => {
    const timers = RECHECK_AT.map((ms) => setTimeout(() => { correct() }, ms))
    return () => { timers.forEach((timer) => { clearTimeout(timer) }) }
  }, [correct])

  /** 程序化定位（恢复上次滚动位置 / 定位到当前播放歌曲）前调用：立即停止干预 */
  const stop = useCallback(() => { stoppedRef.current = true }, [])

  const props = useMemo(() => ({
    onScroll: handleScroll,
    onScrollBeginDrag: handleScrollBeginDrag,
    onLayout: handleLayout,
    onContentSizeChange: handleContentSizeChange,
    scrollEventThrottle: 16,
  }), [handleScroll, handleScrollBeginDrag, handleLayout, handleContentSizeChange])

  return useMemo(() => ({ props, stop }), [props, stop])
}
