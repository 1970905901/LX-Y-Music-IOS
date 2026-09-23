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
