import { memo, useMemo } from 'react'
import { View } from 'react-native'

import { useStatusbarHeight } from '@/store/common/hook'
import { designSpacing } from '@/theme/DesignTokens'

const PageTopInset = memo(() => {
  const statusBarHeight = useStatusbarHeight()

  const style = useMemo(
    () => ({
      paddingTop: Math.max(designSpacing.sm, statusBarHeight - designSpacing.md),
    }),
    [statusBarHeight],
  )

  return <View style={style} />
})

PageTopInset.displayName = 'CommonPageTopInset'
export default PageTopInset
