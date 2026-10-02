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
  onTipSearch: SearchInputProps['onChangeText']
  onSearch: SearchInputProps['onSubmit']
  onHideTipList: SearchInputProps['onBlur']
  onOpenSearch: SearchInputProps['onFocus']
  onCancelSearch: () => void
  onShowTipList: SearchInputProps['onTouchStart']
  /**
   * 输入行（搜索框所在那一行）底边在**窗口坐标系**里的 y（pt）。
   *
   * 为什么必须用窗口坐标：联想浮层是页面级的绝对定位层（与结果列表同级），而搜索框
   * 在结果列表的 header 里——iOS（react-native-navigation 的全局 swizzle：
   * contentInsetAdjustmentBehavior = scrollableAxes）会给列表自动叠加安全区顶部插图，
   * 列表内容因此整体下移（能否滚动还会让这份插图时有时无）。用组件内 layout.y 报位置
   * 会与浮层差出一个安全区：实测已出现「联想词把搜索框整个盖住」（用户反馈截图）。
   * 直接报窗口坐标，浮层贴边位置与搜索框在屏幕上的真实位置永远一致。
   */
  onSearchBarLayout?: (bottomInWindow: number) => void
}

export interface HeaderBarType {
  setText: SearchInputType['setText']
  focus: SearchInputType['focus']
  blur: SearchInputType['blur']
  /** 重新实测「搜索框行底边」的窗口坐标（联想浮层显示前刷新贴边位置） */
  measureSearchBar: () => void
}

export default forwardRef<HeaderBarType, HeaderBarProps>(
  ({
    sources,
    source,
    onSourceChange,
    onTipSearch,
    onSearch,
    onHideTipList,
    onOpenSearch,
    onCancelSearch,
    onShowTipList,
    onSearchBarLayout,
  }, ref) => {
    const searchInputRef = useRef<SearchInputType>(null)
    // 输入行节点：用 measureInWindow 报「搜索框底边」的窗口坐标（见 onSearchBarLayout 注释）
    const openHeaderRef = useRef<View>(null)
    const theme = useTheme()
    const statusBarHeight = useStatusbarHeight()
    const t = useI18n()
    // 输入框当前是否有内容：空输入时不显示「取消」（用户要求：没有输入任何内容时不要
    // 多出一个可以点的取消）；输入内容后出现，点它清空并复位搜索。
    const [hasText, setHasText] = useState(false)

    const handleChangeText = useCallback<SearchInputProps['onChangeText']>((text) => {
      setHasText(text.trim().length > 0)
      onTipSearch(text)
    }, [onTipSearch])

    // 用窗口坐标上报「搜索框那一行的底边」：measureInWindow 给的是它在屏幕上的真实位置，
    // 已经把 iOS 给结果列表叠加的安全区插图 / 列表滚动偏移算进去了（见 onSearchBarLayout 注释）。
    const reportSearchBar = useCallback(() => {
      openHeaderRef.current?.measureInWindow((_x, y, _width, height) => {
        if (!Number.isFinite(y) || !Number.isFinite(height)) return
        onSearchBarLayout?.(y + height)
      })
    }, [onSearchBarLayout])

    useImperativeHandle(
      ref,
      () => ({
        measureSearchBar() {
          reportSearchBar()
        },
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
      [reportSearchBar],
    )

    return (
      <View style={[styles.container, { paddingTop: Math.max(designSpacing.sm, statusBarHeight - designSpacing.md) }]}>
        <View
          ref={openHeaderRef}
          style={styles.openHeader}
          onLayout={reportSearchBar}
        >
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
              onBlur={onHideTipList}
              onFocus={onOpenSearch}
              onTouchStart={onShowTipList}
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
