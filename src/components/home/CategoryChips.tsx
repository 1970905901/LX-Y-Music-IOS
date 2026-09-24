import { memo, useMemo } from 'react'
import { Pressable, ScrollView } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { designRadius, designSpacing, designTypography } from '@/theme/DesignTokens'
import Text from '@/components/common/Text'

interface CategoryChipsProps {
  options: Array<{ id: string, label: string }>
  selectedId: string
  onChange: (id: string) => void
}

const styles = createStyle({
  scroll: {
    flexGrow: 0,
  },
  content: {
    paddingHorizontal: designSpacing.lg,
    paddingRight: designSpacing.md,
    paddingVertical: 2,
  },
  chip: {
    height: 34,
    paddingHorizontal: designSpacing.md,
    marginRight: designSpacing.xs,
    borderRadius: designRadius.pill,
    justifyContent: 'center',
    borderWidth: 1,
  },
  label: {
    fontWeight: '600',
  },
})

const CategoryChips = memo(({ options, selectedId, onChange }: CategoryChipsProps) => {
  const theme = useTheme()

  const activeChipStyle = useMemo(
    () => ({
      backgroundColor: theme['c-primary'],
      borderColor: theme['c-primary'],
    }),
    [theme],
  )

  const inactiveChipStyle = useMemo(
    () => ({
      backgroundColor: theme['c-primary-light-900-alpha-200'],
      borderColor: theme['c-border-background'],
    }),
    [theme],
  )

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {options.map((option) => {
        const isActive = option.id === selectedId
        return (
          <Pressable
            key={option.id}
            style={[styles.chip, isActive ? activeChipStyle : inactiveChipStyle]}
            onPress={() => { onChange(option.id) }}
            hitSlop={4}
          >
            <Text
              style={styles.label}
              size={designTypography.caption}
              color={isActive ? theme['c-primary-light-1000'] : theme['c-font']}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
})

CategoryChips.displayName = 'HomeCategoryChips'
export default CategoryChips
