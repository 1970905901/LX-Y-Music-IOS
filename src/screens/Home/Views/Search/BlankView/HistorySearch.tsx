import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Pressable, TouchableOpacity, View } from 'react-native'
import { type InitState } from '@/store/hotSearch/state'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { designSpacing, designTypography, designRadius } from '@/theme/DesignTokens'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { clearHistoryList, getSearchHistory, removeHistoryWord } from '@/core/search/search'
import { Icon } from '@/components/common/Icon'

export type List = NonNullable<InitState['sourceList'][keyof InitState['sourceList']]>

const ListItem = ({
  keyword,
  onSearch,
  onRemove,
}: {
  keyword: string
  onSearch: (keyword: string) => void
  onRemove: (keyword: string) => void
}) => {
  const theme = useTheme()

  const chipStyle = {
    ...styles.button,
    backgroundColor: theme['c-primary-light-900-alpha-200'],
    borderColor: theme['c-border-background'],
  }

  return (
    <Pressable
      style={chipStyle}
      onPress={() => {
        onSearch(keyword)
      }}
    >
      <Text color={theme['c-font']} size={13}>
        {keyword}
      </Text>
      <TouchableOpacity
        hitSlop={8}
        style={{ ...styles.removeButton, backgroundColor: theme['c-primary-background-active'] }}
        onPress={() => {
          onRemove(keyword)
        }}
      >
        <Icon name="close" color={theme['c-font-label']} size={10} />
      </TouchableOpacity>
    </Pressable>
  )
}

interface HistorySearchProps {
  onSearch: (keyword: string) => void
}
export interface HistorySearchType {
  show: () => void
}

export default forwardRef<HistorySearchType, HistorySearchProps>((props, ref) => {
  const [list, setList] = useState<List>([])
  const isUnmountedRef = useRef(false)
  const t = useI18n()
  const theme = useTheme()

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      show() {
        void getSearchHistory().then((list) => {
          if (isUnmountedRef.current) return
          setList(list)
        })
      },
    }),
    [],
  )

  const handleClear = () => {
    clearHistoryList()
    setList([])
  }

  const handleRemove = useCallback((keyword: string) => {
    setList((list) => {
      list = [...list]
      const index = list.indexOf(keyword)
      list.splice(index, 1)
      removeHistoryWord(index)
      return list
    })
  }, [])

  return list.length ? (
    <View>
      <View style={styles.titleContent}>
        <Text size={designTypography.title} style={styles.title}>{t('search_history_search')}</Text>
        <TouchableOpacity
          onPress={handleClear}
          style={{ ...styles.titleBtn, backgroundColor: theme['c-primary-background-hover'] }}
        >
          <Icon name="eraser" color={theme['c-300']} size={14} />
        </TouchableOpacity>
      </View>
      <View style={styles.list}>
        {list.map((keyword) => (
          <ListItem
            keyword={keyword}
            key={keyword}
            onSearch={props.onSearch}
            onRemove={handleRemove}
          />
        ))}
      </View>
    </View>
  ) : null
})

const styles = createStyle({
  titleContent: {
    marginBottom: designSpacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontWeight: '700',
  },
  titleBtn: {
    marginLeft: designSpacing.sm,
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: designSpacing.sm,
  },
  button: {
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: designSpacing.md,
    marginRight: designSpacing.sm,
    marginBottom: designSpacing.sm,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: designRadius.pill,
  },
  removeButton: {
    marginLeft: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
