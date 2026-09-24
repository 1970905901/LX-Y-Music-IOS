import { memo } from 'react'

import Button, { type BtnProps } from '@/components/common/Button'
import Text from '@/components/common/Text'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'

type ButtonProps = BtnProps

export default memo(({ disabled, onPress, children }: ButtonProps) => {
  const theme = useTheme()

  return (
    <Button
      style={{ ...styles.button, backgroundColor: theme['c-button-background'] }}
      onPress={onPress}
      disabled={disabled}
    >
      <Text size={designTypography.caption} color={theme['c-button-font']}>
        {children}
      </Text>
    </Button>
  )
})

const styles = createStyle({
  button: {
    minHeight: 36,
    paddingHorizontal: designSpacing.sm,
    borderRadius: designRadius.pill,
    marginRight: 10,
  },
})
