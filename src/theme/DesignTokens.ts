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
  // 玻璃胶囊统一圆角（2026-09-29 定案）：= 透镜圆角（56 药丸的胶囊半高）。
  // tab 栏玻璃 / 迷你播放器玻璃 / 透镜同值；端头曲线由原生宿主统一 circular，
  // 观感完全一致（原 continuous squircle 端头偏方、视觉圆角显小，统一后即
  // 「圆角适当加大」的效果）。
  glass: 28,
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
