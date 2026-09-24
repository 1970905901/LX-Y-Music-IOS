import { useRef, forwardRef, useImperativeHandle } from 'react'
import { View } from 'react-native'

// import music from '@/utils/musicSdk'
import { designSpacing } from '@/theme/DesignTokens'
// import InsetShadow from 'react-native-inset-shadow'
import SourceSelector, {
  type SourceSelectorType as _SourceSelectorType,
  type SourceSelectorProps as _SourceSelectorProps,
} from '@/components/SourceSelector'
import SearchInput, { type SearchInputType, type SearchInputProps } from './SearchInput'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import { type Source as MusicSource } from '@/store/search/music/state'
import { type Source as SonglistSource } from '@/store/search/songlist/state'

type Sources = Readonly<Array<MusicSource | SonglistSource>>
type SourceSelectorProps = _SourceSelectorProps<Sources>
type SourceSelectorType = _SourceSelectorType<Sources>

export interface HeaderBarProps {
  title: string
  onSourceChange: SourceSelectorProps['onSourceChange']
  onTipSearch: SearchInputProps['onChangeText']
  onSearch: SearchInputProps['onSubmit']
  onHideTipList: SearchInputProps['onBlur']
  onShowTipList: SearchInputProps['onTouchStart']
}

export interface HeaderBarType {
  setSourceList: SourceSelectorType['setSourceList']
  setText: SearchInputType['setText']
  focus: SearchInputType['focus']
  blur: SearchInputType['blur']
}

export default forwardRef<HeaderBarType, HeaderBarProps>(
  ({ title, onSourceChange, onTipSearch, onSearch, onHideTipList, onShowTipList }, ref) => {
    const sourceSelectorRef = useRef<SourceSelectorType>(null)
    const searchInputRef = useRef<SearchInputType>(null)
    const theme = useTheme()
    const statusBarHeight = useStatusbarHeight()

    useImperativeHandle(
      ref,
      () => ({
        setSourceList(list, source) {
          sourceSelectorRef.current?.setSourceList(list, source)
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
      <View style={[styles.container, { paddingTop: statusBarHeight }]}>
        <Text style={styles.title} size={34} color={theme['c-font']}>{title}</Text>
        <View
          style={{
            ...styles.searchBar,
            backgroundColor: theme['c-primary-light-900-alpha-300'],
            borderColor: theme['c-border-background'],
          }}
        >
          <View style={{ ...styles.selector, borderRightColor: theme['c-border-background'] }}>
            <SourceSelector ref={sourceSelectorRef} onSourceChange={onSourceChange} center />
          </View>
          <View style={styles.searchIcon}>
            <Icon name="search-2" size={17} color={theme['c-font-label']} />
          </View>
          <SearchInput
            ref={searchInputRef}
            onChangeText={onTipSearch}
            onSubmit={onSearch}
            onBlur={onHideTipList}
            onTouchStart={onShowTipList}
          />
        </View>
      </View>
    )
  },
)

const styles = createStyle({
  container: {
    zIndex: 2,
    marginBottom: designSpacing.xs,
  },
  title: {
    paddingHorizontal: designSpacing.lg,
    fontWeight: '800',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    marginHorizontal: designSpacing.lg,
    marginBottom: designSpacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    zIndex: 2,
  },
  selector: {
    justifyContent: 'center',
    borderRightWidth: 1,
    maxWidth: 110,
  },
  searchIcon: {
    paddingLeft: designSpacing.sm,
    paddingRight: 4,
    justifyContent: 'center',
  },
})
