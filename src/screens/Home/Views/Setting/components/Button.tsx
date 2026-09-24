import { memo } from 'react'

import Button, { type BtnProps } from '@/components/common/Button'
import Text from '@/components/common/Text'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
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
      <Text size={14} color={theme['c-button-font']}>
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
    // minHeight 撑高后，RN 默认纵向排列会把文字顶到胶囊上沿，必须显式双向居中
    alignItems: 'center',
    justifyContent: 'center',
  },
})
