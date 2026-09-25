import { forwardRef, useImperativeHandle, useRef } from 'react'
import { View } from 'react-native'

import SortTab, { type SortTabProps, type SortTabType } from './SortTab'
import SourceChips, { type SourceChipsProps, type SourceChipsType } from './SourceChips'
import TagRows, { type TagRowsProps, type TagRowsType } from './TagRows'
import { createStyle } from '@/utils/tools'
import { type Source } from '@/store/songlist/state'
import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { designSpacing } from '@/theme/DesignTokens'
import Text from '@/components/common/Text'

export interface HeaderBarProps {
  title: string
  onSortChange: SortTabProps['onSortChange']
  onTagChange: TagRowsProps['onTagChange']
  onSourceChange: SourceChipsProps['onSourceChange']
}

export interface HeaderBarType {
  setSource: (source: Source, sortId: string, tagName: string, tagId: string) => void
}

// 头部布局：大标题 → 平台切换胶囊行（点击直接切平台）→ 分类胶囊行（可横滑）
// → 标签分组行（原侧边分组抽屉改为各组横向滚动行）。
export default forwardRef<HeaderBarType, HeaderBarProps>(
  ({ title, onSortChange, onTagChange, onSourceChange }, ref) => {
    const sortTabRef = useRef<SortTabType>(null)
    const tagRowsRef = useRef<TagRowsType>(null)
    const sourceChipsRef = useRef<SourceChipsType>(null)
    const theme = useTheme()
    const statusBarHeight = useStatusbarHeight()

    useImperativeHandle(
      ref,
      () => ({
        setSource(source, sortId, _tagName, tagId) {
          sortTabRef.current?.setSource(source, sortId)
          tagRowsRef.current?.setSource(source, tagId)
          sourceChipsRef.current?.setSource(source)
        },
      }),
      [],
    )

    return (
      <View style={[styles.container, { paddingTop: Math.max(designSpacing.sm, statusBarHeight - designSpacing.md) }]}>
        <Text style={styles.title} size={34} color={theme['c-font']}>{title}</Text>
        <SourceChips ref={sourceChipsRef} onSourceChange={onSourceChange} />
        <View style={styles.sortRow}>
          <SortTab ref={sortTabRef} onSortChange={onSortChange} />
        </View>
        <TagRows ref={tagRowsRef} onTagChange={onTagChange} />
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
    marginBottom: designSpacing.sm,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: designSpacing.sm,
  },
})
