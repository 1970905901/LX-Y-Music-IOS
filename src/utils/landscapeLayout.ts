import { useMemo } from 'react'
import { useWindowSize } from '@/utils/hooks'

/**
 * 横屏布局档位
 *
 * 横屏 UI 的挂载由 useHorizontalMode（宽高比 > 1.2）决定，与设备类型/手动开关无关，
 * 因此只要窗口够宽就会走横屏布局。这里再按窗口长边细分两档，让 iPad 这类大屏
 * 不必沿用为手机横屏调过的尺寸。
 *
 * 档位阈值取 1000pt：
 * - 手机横屏最宽约 956pt（iPhone Pro Max 系列）→ 全部落在 medium
 * - iPad 全屏横屏约 1080~1366pt（iPad mini ~ 12.9"）→ 落在 expanded
 * 两档之间留有空隙，避免手机被误判为大屏。
 *
 * medium 的每一项参数都与历史实现逐值相同，保证手机横屏零回归。
 */
const EXPANDED_MIN_WIDTH = 1000

export interface LandscapeLayout {
  /** 是否为大屏（iPad 全屏横屏）档位 */
  isExpanded: boolean
  /** 横屏首页侧边栏宽度 */
  asideWidth: number
  /** 横屏首页侧边栏图标尺寸 */
  asideIconSize: number
  /** 播放详情左半区（封面/控制）宽度占比 */
  leftRatio: number
  /** 播放详情右半区（歌词）宽度占比 */
  rightRatio: number
  /** 歌词区最大宽度，超出后由左半区吸收剩余空间（避免超宽屏上歌词行过长） */
  lyricMaxWidth: number
  /** 封面占左半区可用宽度的比例 */
  coverFillRatio: number
  /** 封面占左半区可用高度的比例 */
  coverHeightRatio: number
}

const MEDIUM_LAYOUT: LandscapeLayout = {
  isExpanded: false,
  asideWidth: 68,
  asideIconSize: 20,
  leftRatio: 0.45,
  rightRatio: 0.55,
  lyricMaxWidth: Number.POSITIVE_INFINITY,
  coverFillRatio: 0.76,
  coverHeightRatio: 0.62,
}

// 大屏档：空间充裕，歌词区不再线性变宽，封面填充率提高以利用多出来的空间。
const EXPANDED_LAYOUT: LandscapeLayout = {
  isExpanded: true,
  asideWidth: 84,
  asideIconSize: 24,
  leftRatio: 0.5,
  rightRatio: 0.5,
  lyricMaxWidth: 700,
  coverFillRatio: 0.85,
  coverHeightRatio: 0.7,
}

export const getLandscapeLayout = (width: number, height: number): LandscapeLayout => {
  // 取长边判断，避免竖屏窗口（width < height）因传入顺序不同被误判
  const longSide = Math.max(width, height)
  return longSide >= EXPANDED_MIN_WIDTH ? EXPANDED_LAYOUT : MEDIUM_LAYOUT
}

export const useLandscapeLayout = (): LandscapeLayout => {
  const { width, height } = useWindowSize()
  return useMemo(() => getLandscapeLayout(width, height), [width, height])
}

/** 歌词区实际宽度，受最大宽度限制 */
export const getLyricWidth = (winWidth: number, layout: LandscapeLayout): number =>
  Math.min(winWidth * layout.rightRatio, layout.lyricMaxWidth)

/** 左侧信息区实际宽度：歌词区被限宽后，剩余空间由左半区吸收 */
export const getLeftWidth = (winWidth: number, layout: LandscapeLayout): number =>
  Math.max(0, winWidth - getLyricWidth(winWidth, layout))
