import { memo, useMemo } from 'react'
import { View } from 'react-native'

import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { createStyle } from '@/utils/tools'
import { designSpacing } from '@/theme/DesignTokens'
import Text from './Text'

interface PageHeaderProps {
  title: string
}

const PageHeader = memo(({ title }: PageHeaderProps) => {
  const theme = useTheme()
  const statusBarHeight = useStatusbarHeight()

  // paddingTop 与推荐页（Discovery）头部保持同一公式，两个页面的标题才会落在同一水平线上。
  // 此前这里是 statusBarHeight + designSpacing.sm（=12），而推荐页是
  // max(designSpacing.sm, statusBarHeight - designSpacing.md)（= max(12, h - 16)），
  // 两者恒差 26~28pt（iPhone 59 状态栏下 77 vs 49），表现为「设置页标题明显比推荐页低一截」。
  // 注意 useStatusbarHeight 内部已叠加常量偏移 STATUSBAR_TOP_OFFSET(=6)，这里不要再加。
  const paddingTop = useMemo(
    () => Math.max(designSpacing.sm, statusBarHeight - designSpacing.md),
    [statusBarHeight],
  )

  return (
    <View style={[styles.container, { paddingTop }]}>
      <Text style={styles.title} size={34} color={theme['c-font']}>
        {title}
      </Text>
    </View>
  )
})

const styles = createStyle({
  container: {
    paddingHorizontal: designSpacing.lg,
    paddingBottom: designSpacing.sm,
  },
  title: {
    fontWeight: '800',
  },
})

PageHeader.displayName = 'CommonPageHeader'
export default PageHeader
