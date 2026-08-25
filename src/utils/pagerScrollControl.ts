// 用于在进度条拖动时同步禁用 PagerView 的原生横滑手势。
// 直接通过 setNativeProps 下发 scrollEnabled，绕过 React state 的异步重渲染，
// 避免“左拖进度条被原生 pager 抢手势导致卡顿”。
type PagerInstance = { setNativeProps?: (props: Record<string, unknown>) => void } | null

let pagerRef: { current: PagerInstance } | null = null

export const registerPager = (ref: { current: PagerInstance } | null) => {
  pagerRef = ref
}

export const setPagerScrollEnabled = (enabled: boolean) => {
  try {
    const inst = pagerRef?.current as PagerInstance
    inst?.setNativeProps?.({ scrollEnabled: enabled })
  } catch {
    // 某些平台/版本下 setNativeProps 不支持该属性时静默忽略，
    // 由 PagerView 的 scrollEnabled prop 兜底。
  }
}
