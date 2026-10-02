import { memo, useMemo } from 'react'
import { View } from 'react-native'

import { useSafeAreaTop, useStatusbarHeight } from '@/store/common/hook'
import { designSpacing } from '@/theme/DesignTokens'

interface PageTopInsetProps {
  /**
   * 固定页头（页头不在 ScrollView / FlatList 里）必须置 true。
   *
   * 为什么：iOS 上 RN 会给**列表**自动叠加一份「安全区顶部插图」
   * （RCTScrollView.automaticallyAdjustContentInsets + RCTContentInsets，
   * 取所在控制器的 safeAreaInsets，见 node_modules/react-native/
   * React/Views/ScrollView/RCTScrollView.m 与 RCTViewUtils.m）。
   * 所以页头放在列表内容里时，系统已经把它让过了刘海/灵动岛，这里再加就变成双倍留白；
   * 而页头独立在列表之外（DailyRec/TXDailyRec/KgDailyRec 等固定页头）时拿不到这份插图，
   * 必须自己补，否则大标题会比「推荐」页标题高出一整个安全区（iPhone 59~62pt），
   * 表现为标题贴着状态栏/灵动岛。
   */
  withSafeAreaTop?: boolean
}

const PageTopInset = memo(({ withSafeAreaTop = false }: PageTopInsetProps) => {
  const statusBarHeight = useStatusbarHeight()
  const safeAreaTop = useSafeAreaTop()

  const style = useMemo(
    () => ({
      // 与「推荐」页大标题（Discovery.header.paddingTop）用同一公式，
      // 固定页头再补上列表会自动获得的系统安全区顶部插图。
      paddingTop: (withSafeAreaTop ? safeAreaTop : 0) + Math.max(designSpacing.sm, statusBarHeight - designSpacing.md),
    }),
    [withSafeAreaTop, safeAreaTop, statusBarHeight],
  )

  return <View style={style} />
})

PageTopInset.displayName = 'CommonPageTopInset'
export default PageTopInset
