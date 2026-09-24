import { memo, useMemo, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { designSpacing, designTypography } from '@/theme/DesignTokens'
import Text from './Text'

const styles = createStyle({
  container: {
    paddingHorizontal: designSpacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: designSpacing.md,
  },
  action: {
    paddingLeft: designSpacing.md,
  },
  title: {
    fontWeight: '700',
  },
})

interface SectionHeaderProps {
  title: ReactNode
  actionLabel?: string
  onPressAction?: () => void
}

const SectionHeader = memo(({ title, actionLabel, onPressAction }: SectionHeaderProps) => {
  const theme = useTheme()

  const titleStyle = useMemo(
    () => StyleSheet.compose(styles.title, {
      color: theme['c-font'],
    }),
    [theme],
  )

  const actionStyle = useMemo(
    () => StyleSheet.compose(styles.action, {
      color: theme['c-primary-font'],
    }),
    [theme],
  )

  return (
    <View style={styles.container}>
      <Text style={titleStyle} size={designTypography.title} numberOfLines={1}>{title}</Text>
      {actionLabel ? (
        <Pressable onPress={onPressAction} hitSlop={12}>
          <Text style={actionStyle} size={designTypography.caption}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
})
SectionHeader.displayName = 'CommonSectionHeader'
export default SectionHeader
