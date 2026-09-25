import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { View } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { type Source, type InitState } from '@/store/hotSearch/state'
import Button from '@/components/common/Button'
import { getList } from '@/core/hotSearch'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { designSpacing, designTypography } from '@/theme/DesignTokens'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'

interface ListProps {
  onSearch: (keyword: string) => void
}
export interface HotSearchType {
  show: (source: Source) => void
}

export type List = NonNullable<InitState['sourceList'][keyof InitState['sourceList']]>

const ListItem = ({
  keyword,
  onSearch,
}: {
  keyword: string
  onSearch: (keyword: string) => void
}) => {
  const theme = useTheme()
  return (
    <Button
      style={{
        ...styles.button,
        backgroundColor: theme['c-primary-light-900-alpha-200'],
        borderColor: theme['c-border-background'],
      }}
      onPress={() => {
        onSearch(keyword)
      }}
    >
      <Icon name="search-2" size={16} color={theme['c-primary']} style={styles.icon} />
      <Text color={theme['c-font']} size={13}>
        {keyword}
      </Text>
    </Button>
  )
}

export default forwardRef<HotSearchType, ListProps>((props, ref) => {
  // const [listType, setListType] = useState<SearchState['searchType']>('music')
  // const listRef = useRef<MusicListType>(null)
  const [list, setList] = useState<List>([])
  const t = useI18n()
  // const theme = useTheme()

  const isUnmountedRef = useRef(false)
  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      show(source) {
        void getList(source).then((list) => {
          if (isUnmountedRef.current) return
          setList(list)
        })
      },
    }),
    [],
  )

  return list.length ? (
    <View>
      <Text style={styles.title} size={designTypography.title}>
        {t('search_hot_search')}
      </Text>
      <View style={styles.list}>
        {list.slice(0, 12).map((keyword, _index) => (
          <ListItem
            keyword={keyword}
            key={keyword}
            onSearch={props.onSearch}
          />
        ))}
      </View>
    </View>
  ) : null
})

const styles = createStyle({
  title: {
    marginBottom: designSpacing.sm,
    fontWeight: '700',
  },
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: designSpacing.sm,
    columnGap: designSpacing.sm,
  },
  button: {
    width: '48%',
    height: 44,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: designSpacing.md,
    borderRadius: 22,
    marginBottom: designSpacing.sm,
    borderWidth: 1,
  },
  icon: {
    marginRight: designSpacing.sm,
  },
  keyword: {
    flexShrink: 1,
  },
})
