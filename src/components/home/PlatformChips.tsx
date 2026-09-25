import { memo, useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { designSpacing, designTypography } from '@/theme/DesignTokens'
import Text from '@/components/common/Text'

export interface PlatformOption {
  id: string
  label: string
}

interface PlatformChipsProps {
  options: PlatformOption[]
  selectedId: string
  onChange: (id: string) => void
  /** 嵌入已带水平内边距的容器（如歌单页头部）时关闭自带的左右内边距 */
  noInset?: boolean
}

const styles = createStyle({
  scroll: {
    flexGrow: 0,
  },
  content: {
    paddingHorizontal: designSpacing.lg,
    paddingRight: designSpacing.md,
  },
  contentBare: {},
  chip: {
    height: 38,
    paddingHorizontal: designSpacing.lg,
    marginRight: designSpacing.sm,
    borderRadius: 999,
    justifyContent: 'center',
    borderWidth: 1,
  },
  label: {
    fontWeight: '600',
  },
})

const PlatformChips = memo(({ options, selectedId, onChange, noInset }: PlatformChipsProps) => {
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
      backgroundColor: theme['c-primary-light-900-alpha-300'],
      borderColor: theme['c-border-background'],
    }),
    [theme],
  )

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={noInset ? styles.contentBare : styles.content}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {options.map((option) => {
        const isActive = option.id === selectedId
        return (
          <Pressable
            key={option.id}
            style={[styles.chip, isActive ? activeChipStyle : inactiveChipStyle]}
            onPress={() => onChange(option.id)}
          >
            <Text
              style={styles.label}
              size={designTypography.body}
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
PlatformChips.displayName = 'HomePlatformChips'
export default PlatformChips
