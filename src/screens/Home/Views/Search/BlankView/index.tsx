import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { designSpacing } from '@/theme/DesignTokens'
import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type ReactElement } from 'react'
import { ScrollView, View } from 'react-native'
import { Icon } from '@/components/common/Icon'
import HistorySearch, { type HistorySearchType } from './HistorySearch'
import HotSearch, { type HotSearchType } from './HotSearch'

interface BlankViewProps {
  header?: ReactElement
  onSearch: (keyword: string) => void
}
type Source = LX.OnlineSource | 'all'

export interface BlankViewType {
  show: (source: Source) => void
}

export default forwardRef<BlankViewType, BlankViewProps>(({ header, onSearch }, ref) => {
  // const [listType, setListType] = useState<SearchState['searchType']>('music')
  const [visible, setVisible] = useState(false)
  const hotSearchRef = useRef<HotSearchType>(null)
  const historySearchRef = useRef<HistorySearchType>(null)
  const isShowHotSearch = useSettingValue('search.isShowHotSearch')
  const isShowHistorySearch = useSettingValue('search.isShowHistorySearch')
  const t = useI18n()
  const theme = useTheme()

  const cardStyle = useMemo(
    () => ({
      marginBottom: designSpacing.md,
    }),
    [],
  )

  const handleShow = (source: Source) => {
    hotSearchRef.current?.show(source)
    historySearchRef.current?.show()
  }

  useImperativeHandle(
    ref,
    () => ({
      show(source) {
        if (visible) handleShow(source)
        else {
          setVisible(true)
          requestAnimationFrame(() => {
            handleShow(source)
          })
        }
      },
    }),
    [visible],
  )

  return visible ? (
    isShowHotSearch || isShowHistorySearch ? (
      <ScrollView>
        {header}
        <View style={styles.content}>
          <View style={styles.emptyState}>
            <Icon name="search-2" size={48} color={theme['c-300']} />
            <Text style={styles.emptyTitle} size={22} color={theme['c-font']}>
              {t('search_empty_title')}
            </Text>
            <Text style={styles.emptyDescription} size={15} color={theme['c-font-label']}>
              {t('search_empty_description')}
            </Text>
          </View>
          {isShowHotSearch ? (
            <View style={cardStyle}>
              <HotSearch ref={hotSearchRef} onSearch={onSearch} />
            </View>
          ) : null}
          {isShowHistorySearch ? (
            <View style={cardStyle}>
              <HistorySearch ref={historySearchRef} onSearch={onSearch} />
            </View>
          ) : null}
        </View>
      </ScrollView>
    ) : (
      <View style={styles.welcome}>
        <Text size={22} color={theme['c-font-label']}>
          {t('search__welcome')}
        </Text>
      </View>
    )
  ) : null
})

const styles = createStyle({
  content: {
    paddingBottom: 180,
    paddingHorizontal: designSpacing.lg,
  },
  welcome: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: designSpacing.xl,
    paddingBottom: designSpacing.lg,
  },
  emptyTitle: {
    marginTop: designSpacing.md,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyDescription: {
    marginTop: designSpacing.sm,
    textAlign: 'center',
  },
})
