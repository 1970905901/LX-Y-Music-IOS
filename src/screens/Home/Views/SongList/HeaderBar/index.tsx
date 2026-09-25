import { forwardRef, useImperativeHandle, useRef } from 'react'
import { View } from 'react-native'

import SortTab, { type SortTabProps, type SortTabType } from './SortTab'
import SourceChips, { type SourceChipsProps, type SourceChipsType } from './SourceChips'
import { createStyle } from '@/utils/tools'
import { type Source } from '@/store/songlist/state'
import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import Tag, { type TagType, type TagProps } from './Tag'
import { designSpacing } from '@/theme/DesignTokens'
import Text from '@/components/common/Text'

export interface HeaderBarProps {
  title: string
  onSortChange: SortTabProps['onSortChange']
  onTagChange: TagProps['onTagChange']
  onSourceChange: SourceChipsProps['onSourceChange']
}

export interface HeaderBarType {
  setSource: (source: Source, sortId: string, tagName: string, tagId: string) => void
}

// 头部布局对齐参考设计：大标题 → 平台切换胶囊行（点击直接切平台）→ 分类胶囊行（可横滑）
// + 行尾常驻的标签筛选胶囊。原「右侧平台下拉 + checkbox 筛选条」已移除。
export default forwardRef<HeaderBarType, HeaderBarProps>(
  ({ title, onSortChange, onTagChange, onSourceChange }, ref) => {
    const sortTabRef = useRef<SortTabType>(null)
    const tagRef = useRef<TagType>(null)
    const sourceChipsRef = useRef<SourceChipsType>(null)
    const theme = useTheme()
    const statusBarHeight = useStatusbarHeight()

    useImperativeHandle(
      ref,
      () => ({
        setSource(source, sortId, tagName, tagId) {
          sortTabRef.current?.setSource(source, sortId)
          tagRef.current?.setSelectedTagInfo(source, tagName, tagId)
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
          <Tag ref={tagRef} onTagChange={onTagChange} />
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
    marginBottom: designSpacing.sm,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: designSpacing.sm,
  },
})
