import { memo } from 'react'
import { View } from 'react-native'

import { useStatusbarHeight } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { designSpacing } from '@/theme/DesignTokens'
import Text from './Text'

interface PageHeaderProps {
  title: string
}

const PageHeader = memo(({ title }: PageHeaderProps) => {
  const theme = useTheme()
  const statusBarHeight = useStatusbarHeight()

  return (
    <View style={[styles.container, { paddingTop: statusBarHeight + designSpacing.sm }]}>
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
