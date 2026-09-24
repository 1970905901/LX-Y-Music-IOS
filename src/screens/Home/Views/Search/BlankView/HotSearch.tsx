import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { View } from 'react-native'
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
  rank,
  onSearch,
}: {
  keyword: string
  rank: number
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
      <Text color={theme['c-button-font']} size={13}>
        {keyword}
      </Text>
      <Text color={theme['c-font-label']} size={11}>{rank}</Text>
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
        {list.slice(0, 12).map((keyword, index) => (
          <ListItem
            keyword={keyword}
            rank={index + 1}
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
  },
  button: {
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: designSpacing.md,
    borderRadius: 999,
    marginRight: designSpacing.sm,
    marginBottom: designSpacing.sm,
    borderWidth: 1,
  },
})
