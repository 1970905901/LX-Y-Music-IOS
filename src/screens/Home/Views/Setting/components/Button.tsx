import { memo } from 'react'

import Button, { type BtnProps } from '@/components/common/Button'
import Text from '@/components/common/Text'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'

type ButtonProps = BtnProps

// 设置页的动作按钮统一走「推荐页排行榜按钮」那套视觉语言：
// 圆角 designRadius.md + 1px 边框 + 半透明主题色底 + 主题色文字，
// 与页面里的开关行、输入行是同一套控件外观。
export default memo(({ disabled, onPress, children }: ButtonProps) => {
  const theme = useTheme()

  return (
    <Button
      style={[
        styles.button,
        {
          backgroundColor: theme['c-primary-light-900-alpha-200'],
          borderColor: theme['c-border-background'],
        },
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text size={14} style={styles.label} color={theme['c-primary']}>
        {children}
      </Text>
    </Button>
  )
})

const styles = createStyle({
  button: {
    minHeight: 40,
    paddingHorizontal: designSpacing.md,
    borderRadius: designRadius.md,
    borderWidth: 1,
    marginRight: 10,
    // minHeight 撑高后，RN 默认纵向排列会把文字顶到上沿，必须显式双向居中
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontWeight: '600',
  },
})
