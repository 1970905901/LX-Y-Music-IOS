// 用于在进度条拖动时同步禁用 PagerView 的原生横滑手势，避免左拖进度条时
// 被原生 pager 抢手势导致卡顿 / 误切歌词页。
//
// 关键：react-native-pager-view 的 PagerView 组件本身【没有 setNativeProps】，
// 必须通过它自带的命令式实例方法 setScrollEnabled()（底层调用
// PagerViewNativeCommands.setScrollEnabledImperatively）才能即时生效，
// 且该调用在 onPanResponderGrant（触摸按下）时同步执行，早于原生手势识别器开始跟踪，
// 从而彻底拦住原生横滑。PagerView 的 scrollEnabled prop 仅作兜底。
type PagerInstance = { setScrollEnabled?: (enabled: boolean) => void } | null

let pagerRef: { current: PagerInstance } | null = null

export const registerPager = (ref: { current: PagerInstance } | null) => {
  pagerRef = ref
}

export const setPagerScrollEnabled = (enabled: boolean) => {
  try {
    const inst = pagerRef?.current as PagerInstance
    inst?.setScrollEnabled?.(enabled)
  } catch {
    // 个别版本/平台下 setScrollEnabled 不可用时静默忽略，由 scrollEnabled prop 兜底。
  }
}
