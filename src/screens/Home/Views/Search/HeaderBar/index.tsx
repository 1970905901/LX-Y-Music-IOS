import { useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'

// import music from '@/utils/musicSdk'
import { designSpacing } from '@/theme/DesignTokens'
// import InsetShadow from 'react-native-inset-shadow'
import SearchInput, { type SearchInputType, type SearchInputProps } from './SearchInput'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { useI18n } from '@/lang'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import { type Source as MusicSource } from '@/store/search/music/state'
import { type Source as SonglistSource } from '@/store/search/songlist/state'

type Sources = Readonly<Array<MusicSource | SonglistSource>>

export interface HeaderBarProps {
  onSourceChange: (source: MusicSource | SonglistSource) => void
  onTipSearch: SearchInputProps['onChangeText']
  onSearch: SearchInputProps['onSubmit']
  onHideTipList: SearchInputProps['onBlur']
  onOpenSearch: SearchInputProps['onFocus']
  onCancelSearch: () => void
  onShowTipList: SearchInputProps['onTouchStart']
}

export interface HeaderBarType {
  setSourceList: (list: Sources, source: MusicSource | SonglistSource) => void
  setText: SearchInputType['setText']
  focus: SearchInputType['focus']
  blur: SearchInputType['blur']
}

export default forwardRef<HeaderBarType, HeaderBarProps>(
  ({
    onSourceChange,
    onTipSearch,
    onSearch,
    onHideTipList,
    onOpenSearch,
    onCancelSearch,
    onShowTipList,
  }, ref) => {
    const [sources, setSources] = useState<Sources>([])
    const [source, setSource] = useState<MusicSource | SonglistSource>('kw')
    const searchInputRef = useRef<SearchInputType>(null)
    const theme = useTheme()
    const statusBarHeight = useStatusbarHeight()
    const t = useI18n()

    useImperativeHandle(
      ref,
      () => ({
        setSourceList(list, source) {
          setSources(list)
          setSource(source)
        },
        setText(text) {
          searchInputRef.current?.setText(text)
        },
        focus() {
          searchInputRef.current?.focus()
        },
        blur() {
          searchInputRef.current?.blur()
        },
      }),
      [],
    )

    return (
      <View style={[styles.container, { paddingTop: Math.max(0, statusBarHeight - designSpacing.xs) }]}>
        <View style={styles.openHeader}>
          <View
            style={{
              ...styles.searchBar,
              flexShrink: 1,
              backgroundColor: theme['c-primary-light-900-alpha-300'],
              borderColor: theme['c-border-background'],
            }}
          >
            <View style={styles.searchIcon}>
              <Icon name="search-2" size={17} color={theme['c-font-label']} />
            </View>
            <SearchInput
              ref={searchInputRef}
              onChangeText={onTipSearch}
              onSubmit={onSearch}
              onBlur={onHideTipList}
              onFocus={onOpenSearch}
              onTouchStart={onShowTipList}
            />
          </View>
          <Text style={styles.cancelButton} color={theme['c-primary']} onPress={onCancelSearch}>
            取消
          </Text>
        </View>
        <View style={styles.platformHeader}>
          <Text size={17} color={theme['c-font']}>搜索平台</Text>
          <Text size={13} color={theme['c-primary']}>{t(`source_${source}`)}</Text>
        </View>
        <ScrollView
          style={styles.platformScroll}
          contentContainerStyle={styles.platformContent}
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
        >
          {sources.map((sourceId) => {
            const isActive = sourceId == source
            return (
              <TouchableOpacity
                key={sourceId}
                style={{
                  ...styles.platformItem,
                  backgroundColor: isActive
                    ? theme['c-primary']
                    : theme['c-primary-light-900-alpha-200'],
                }}
                onPress={() => {
                  setSource(sourceId)
                  onSourceChange(sourceId)
                }}
              >
                <Text
                  size={15}
                  color={isActive ? theme['c-primary-light-1000'] : theme['c-font']}
                >
                  {t(`source_${sourceId}`)}
                </Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      </View>
    )
  },
)

const styles = createStyle({
  container: {
    zIndex: 2,
    marginBottom: designSpacing.xs,
  },
  openHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: designSpacing.lg,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    marginRight: designSpacing.sm,
    marginBottom: designSpacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    zIndex: 2,
  },
  searchIcon: {
    paddingLeft: designSpacing.sm,
    paddingRight: 4,
    justifyContent: 'center',
  },
  cancelButton: {
    fontWeight: '700',
  },
  platformHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: designSpacing.lg,
    marginTop: designSpacing.xs,
  },
  platformScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  platformContent: {
    paddingHorizontal: designSpacing.lg,
    paddingVertical: designSpacing.sm,
  },
  platformItem: {
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: designSpacing.md,
    marginRight: designSpacing.sm,
    borderRadius: 999,
  },
})
