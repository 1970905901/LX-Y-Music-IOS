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
import { type Source as MusicSource } from '@/store/search/music/state'
import { type Source as SonglistSource } from '@/store/search/songlist/state'

type Sources = Readonly<Array<MusicSource | SonglistSource>>
type SourceSelectorProps = _SourceSelectorProps<Sources>
type SourceSelectorType = _SourceSelectorType<Sources>

export interface HeaderBarProps {
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
  ({ onSourceChange, onTipSearch, onSearch, onHideTipList, onShowTipList }, ref) => {
    const sourceSelectorRef = useRef<SourceSelectorType>(null)
    const searchInputRef = useRef<SearchInputType>(null)
    const theme = useTheme()

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
      []
    )

    return (
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
        <SearchInput
          ref={searchInputRef}
          onChangeText={onTipSearch}
          onSubmit={onSearch}
          onBlur={onHideTipList}
          onTouchStart={onShowTipList}
        />
      </View>
    )
  }
)

const styles = createStyle({
  searchBar: {
    flexDirection: 'row',
    height: 46,
    marginHorizontal: designSpacing.lg,
    marginTop: designSpacing.sm,
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
})
