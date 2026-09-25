import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ScrollView, TouchableOpacity } from 'react-native'
import songlistState, { type SortInfo, type Source } from '@/store/songlist/state'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { designSpacing } from '@/theme/DesignTokens'

export interface SortTabProps {
  onSortChange: (id: string) => void
}

export interface SortTabType {
  setSource: (source: Source, activeTab: SortInfo['id']) => void
}

export default forwardRef<SortTabType, SortTabProps>(({ onSortChange }, ref) => {
  const [sortList, setSortList] = useState<SortInfo[]>([])
  const [activeId, setActiveId] = useState<SortInfo['id']>('')
  const t = useI18n()
  const theme = useTheme()
  const scrollViewRef = useRef<ScrollView>(null)

  useImperativeHandle(ref, () => ({
    setSource(source, activeTab) {
      scrollViewRef.current?.scrollTo({ x: 0 })
      setSortList(songlistState.sortList[source]!)
      setActiveId(activeTab)
    },
  }))

  const sorts = useMemo(() => {
    return sortList.map((s) => ({ label: t(`songlist_${s.tid}`), id: s.id }))
  }, [sortList, t])

  const handleSortChange = (id: string) => {
    onSortChange(id)
    setActiveId(id)
  }

  return (
    <ScrollView
      ref={scrollViewRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps={'always'}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {sorts.map((s) => {
        const isActive = activeId == s.id
        return (
          <TouchableOpacity
            style={{
              ...styles.button,
              backgroundColor: isActive ? theme['c-primary'] : theme['c-primary-light-900-alpha-300'],
              borderColor: isActive ? theme['c-primary'] : theme['c-border-background'],
            }}
            onPress={() => {
              handleSortChange(s.id)
            }}
            key={s.id}
          >
            <Text
              style={{
                ...styles.buttonText,
                color: isActive ? theme['c-primary-light-1000'] : theme['c-font'],
              }}
            >
              {s.label}
            </Text>
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
})

const styles = createStyle({
  container: {
    flexGrow: 1,
    flexShrink: 1,
    // paddingLeft: 5,
    // paddingRight: 5,
  },
  button: {
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: designSpacing.lg,
    paddingRight: designSpacing.lg,
    marginRight: designSpacing.sm,
    borderRadius: 999,
    borderWidth: 1,
  },
  content: {
    alignItems: 'center',
  },
  buttonText: {
    textAlign: 'center',
    fontWeight: '600',
  },
})
