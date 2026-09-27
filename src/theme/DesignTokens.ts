export const designSpacing = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
} as const

export const designRadius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  pill: 999,
} as const

export const designTypography = {
  title: 20,
  body: 15,
  caption: 13,
} as const

export const designMotion = {
  quick: 150,
  standard: 250,
  smooth: 350,
} as const

export type DesignSpacingToken = keyof typeof designSpacing

/** 沉底悬浮组件（底部 tab 栏 / 迷你播放条）在安全区之上的额外留缝（pt）。
 *  安全区本身（iPhone 34 / 全面屏 iPad 20 / Home 键 iPad 0）由 useSafeAreaBottom 提供。 */
export const bottomFloatGap = 4
