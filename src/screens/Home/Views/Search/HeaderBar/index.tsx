import { useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
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
  sources: Sources
  source: MusicSource | SonglistSource
  onSourceChange: (source: MusicSource | SonglistSource) => void
  onSearch: SearchInputProps['onSubmit']
  onCancelSearch: () => void
}

export interface HeaderBarType {
  setText: SearchInputType['setText']
  focus: SearchInputType['focus']
  blur: SearchInputType['blur']
}

export default forwardRef<HeaderBarType, HeaderBarProps>(
  ({
    sources,
    source,
    onSourceChange,
    onSearch,
    onCancelSearch,
  }, ref) => {
    const searchInputRef = useRef<SearchInputType>(null)
    const theme = useTheme()
    const statusBarHeight = useStatusbarHeight()
    const t = useI18n()
    // 输入框当前是否有内容：空输入时不显示「取消」（用户要求：没有输入任何内容时不要
    // 多出一个可以点的取消）；输入内容后出现，点它清空并复位搜索。
    const [hasText, setHasText] = useState(false)

    const handleChangeText = useCallback<SearchInputProps['onChangeText']>((text) => {
      setHasText(text.trim().length > 0)
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        setText(text) {
          // 父级预填/清空（例如从歌单菜单「搜索同名歌曲」、返回时复位）也要同步取消按钮
          setHasText(text.trim().length > 0)
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
      <View style={[styles.container, { paddingTop: Math.max(designSpacing.sm, statusBarHeight - designSpacing.md) }]}>
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
              onChangeText={handleChangeText}
              onSubmit={onSearch}
            />
          </View>
          {hasText ? (
            <Text style={styles.cancelButton} color={theme['c-primary']} onPress={onCancelSearch}>
              取消
            </Text>
          ) : null}
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
    // 与搜索框的间距挂在**行**上（原来挂在搜索框的 marginBottom 上：那样搜索框盒高
    // 比文字高 8pt，行内居中的「取消」看起来比搜索框中心低 4pt，用户反馈偏下）。
    paddingBottom: designSpacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    marginRight: designSpacing.sm,
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
