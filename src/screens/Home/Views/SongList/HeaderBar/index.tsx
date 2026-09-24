import { forwardRef, useImperativeHandle, useRef } from 'react'
import { View } from 'react-native'

// import { useGetter, useDispatch } from '@/store'
import SortTab, { type SortTabProps, type SortTabType } from './SortTab'
// import Tag from './Tag'
// import OpenList from './OpenList'
import { createStyle } from '@/utils/tools'
// import { BorderWidths } from '@/theme'
import SourceSelector, { type SourceSelectorType, type SourceSelectorProps } from './SourceSelector'
import { type Source } from '@/store/songlist/state'
import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import Tag, { type TagType, type TagProps } from './Tag'
import { designRadius, designSpacing } from '@/theme/DesignTokens'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
// import { BorderWidths } from '@/theme'

export interface HeaderBarProps {
  title: string
  onSortChange: SortTabProps['onSortChange']
  onTagChange: TagProps['onTagChange']
  onSourceChange: SourceSelectorProps['onSourceChange']
}

export interface HeaderBarType {
  setSource: (source: Source, sortId: string, tagName: string, tagId: string) => void
}

export default forwardRef<HeaderBarType, HeaderBarProps>(
  ({ title, onSortChange, onTagChange, onSourceChange }, ref) => {
    const sortTabRef = useRef<SortTabType>(null)
    const tagRef = useRef<TagType>(null)
    const sourceSelectorRef = useRef<SourceSelectorType>(null)
    const theme = useTheme()
    const statusBarHeight = useStatusbarHeight()
    // const theme = useTheme()

    useImperativeHandle(
      ref,
      () => ({
        setSource(source, sortId, tagName, tagId) {
          sortTabRef.current?.setSource(source, sortId)
          tagRef.current?.setSelectedTagInfo(source, tagName, tagId)
          sourceSelectorRef.current?.setSource(source)
        },
      }),
      [],
    )

    return (
      <View style={[styles.container, { paddingTop: Math.max(designSpacing.sm, statusBarHeight - designSpacing.md) }]}>
        <Text style={styles.title} size={34} color={theme['c-font']}>{title}</Text>
        <View style={styles.actions}>
          <View
            style={[styles.sourcePill, {
              backgroundColor: theme['c-primary-light-900-alpha-200'],
              borderColor: theme['c-border-background'],
            }]}
          >
            <SourceSelector ref={sourceSelectorRef} onSourceChange={onSourceChange} />
          </View>
        </View>

        <View
          style={[styles.filterRow, {
            backgroundColor: theme['c-primary-light-900-alpha-200'],
            borderColor: theme['c-border-background'],
          }]}
        >
          <Icon name="checkbox-marked" size={16} color={theme['c-primary']} />
          <Tag ref={tagRef} onTagChange={onTagChange} />
        </View>

        <View style={styles.sortRow}>
          <SortTab ref={sortTabRef} onSortChange={onSortChange} />
        </View>
      </View>
    )
  },
)

const styles = createStyle({
  container: {
    zIndex: 2,
    paddingHorizontal: designSpacing.lg,
    marginBottom: designSpacing.xs,
  },
  title: {
    fontWeight: '800',
    lineHeight: 36,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: designSpacing.md,
  },
  sourcePill: {
    height: 36,
    justifyContent: 'center',
    borderRadius: designRadius.pill,
    borderWidth: 1,
    overflow: 'hidden',
    marginRight: 0,
  },
  filterRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designSpacing.sm,
    borderRadius: designRadius.lg,
    borderWidth: 1,
  },
  sortRow: {
    marginTop: designSpacing.sm,
    minHeight: 36,
    justifyContent: 'center',
  },
})
