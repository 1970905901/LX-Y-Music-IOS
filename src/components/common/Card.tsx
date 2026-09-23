import { memo, useMemo } from 'react'
import { StyleSheet, View, type ViewProps } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { designRadius, designSpacing, type DesignSpacingToken } from '@/theme/DesignTokens'

const styles = createStyle({
  base: {
    borderRadius: designRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
})

export interface CardProps extends ViewProps {
  padding?: DesignSpacingToken
}

export default memo(({ padding = 'md', style, ...props }: CardProps) => {
  const theme = useTheme()

  const cardStyle = useMemo(
    () => StyleSheet.compose(
      {
        ...styles.base,
        padding: designSpacing[padding],
        backgroundColor: theme['c-content-background'],
        borderColor: theme['c-border-background'],
      },
      style,
    ),
    [padding, style, theme],
  )

  return <View style={cardStyle} {...props} />
})
