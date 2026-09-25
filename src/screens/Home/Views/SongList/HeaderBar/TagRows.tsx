import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { getTags } from '@/core/songlist'
import { type Source, type TagInfo } from '@/store/songlist/state'
import { designSpacing } from '@/theme/DesignTokens'

export interface TagRowsProps {
  onTagChange: (name: string, id: string) => void
}

export interface TagRowsType {
  setSource: (source: Source, activeId: string) => void
}

// 平台标签分组行：原侧边分组抽屉/左栏（TagList）改为平台按钮下方的行式布局，
// 每个分组一行（组名 + 横向滚动的标签胶囊），「默认」始终位于首行。
export default forwardRef<TagRowsType, TagRowsProps>(({ onTagChange }, ref) => {
  const theme = useTheme()
  const t = useI18n()
  const [groups, setGroups] = useState<TagInfo['tags']>([])
  const [activeId, setActiveId] = useState('')
  const prevSource = useRef('')
  const isUnmountedRef = useRef(false)

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  useImperativeHandle(ref, () => ({
    setSource(source, activeId) {
      setActiveId(activeId)
      if (source == prevSource.current) return
      prevSource.current = source
      // 先展示「默认」占位，标签数据到达后补齐各分组
      setGroups([
        {
          name: '',
          list: [{ name: t('songlist_tag_default'), id: '', parent_id: '', parent_name: '', source }],
        },
      ])
      void getTags(source)
        .then((tagInfo) => {
          if (isUnmountedRef.current) return
          setGroups(
            [
              {
                name: '',
                list: [
                  {
                    name: t('songlist_tag_default'),
                    id: '',
                    parent_id: '',
                    parent_name: '',
                    source,
                  },
                ],
              },
              { name: t('songlist_tag_hot'), list: [...tagInfo.hotTag] },
              ...tagInfo.tags,
            ].filter((group) => group.list.length),
          )
        })
        .catch(() => {
          // 汽水等平台无标签列表（getTags reject），保持默认空标签即可
        })
    },
  }))

  const handlePress = (name: string, id: string) => {
    setActiveId(id)
    onTagChange(name, id)
  }

  return (
    <View style={styles.container}>
      {groups.map((group, index) => (
        <View key={`${group.name}-${index}`} style={styles.groupRow}>
          {group.name ? (
            <Text
              style={styles.groupName}
              size={13}
              color={theme['c-font-label']}
              numberOfLines={1}
            >
              {group.name}
            </Text>
          ) : null}
          <ScrollView
            style={styles.groupScroll}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={styles.groupContent}
          >
            {group.list.map((tag) => {
              const isActive = activeId == tag.id
              return (
                <Pressable
                  key={tag.id || `default-${index}`}
                  style={{
                    ...styles.tagButton,
                    backgroundColor: isActive
                      ? theme['c-primary']
                      : theme['c-primary-light-900-alpha-300'],
                    borderColor: isActive
                      ? theme['c-primary']
                      : theme['c-border-background'],
                  }}
                  onPress={() => { handlePress(tag.name, tag.id) }}
                >
                  <Text
                    style={styles.tagText}
                    color={isActive ? theme['c-primary-light-1000'] : theme['c-font']}
                  >
                    {tag.name}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      ))}
    </View>
  )
})

const styles = createStyle({
  container: {
    marginTop: designSpacing.xs,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: designSpacing.sm,
  },
  groupName: {
    marginRight: designSpacing.xs,
  },
  groupScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  groupContent: {
    alignItems: 'center',
  },
  tagButton: {
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: designSpacing.sm,
    marginRight: designSpacing.xs,
    borderRadius: 999,
    borderWidth: 1,
  },
  tagText: {
    fontSize: 13,
    fontWeight: '600',
  },
})
