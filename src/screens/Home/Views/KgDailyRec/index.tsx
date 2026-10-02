import { memo, useRef, useState, useCallback } from 'react'
import { TouchableOpacity, View, ScrollView } from 'react-native'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { designSpacing } from '@/theme/DesignTokens'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import RecSongs from './RecSongs'
import { BorderWidths } from '@/theme'
import { setNavActiveId } from '@/core/common'
import PageTopInset from '@/components/common/PageTopInset'
import SwipeBackArea from '@/components/common/SwipeBackArea'

type TabType = 'recommend' | 'everyday'

const TABS: Array<{ id: TabType, label: string }> = [
  { id: 'recommend', label: '每日推荐' },
  { id: 'everyday', label: '新歌速递' },
]

const Tabs = ({
  activeTab,
  onTabChange,
}: {
  activeTab: TabType
  onTabChange: (tab: TabType) => void
}) => {
  const theme = useTheme()
  return (
    <ScrollView
      style={styles.tabsScroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tabsContainer}
    >
      {TABS.map((tab) => (
        <TouchableOpacity
          key={tab.id}
          style={styles.tab}
          onPress={() => { onTabChange(tab.id) }}
        >
          <Text
            style={[
              styles.tabText,
              { borderBottomColor: activeTab === tab.id ? theme['c-primary-font-active'] : 'transparent' },
            ]}
            color={theme['c-font']}
          >
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  )
}

export default memo(() => {
  const [activeTab, setActiveTab] = useState<TabType>('recommend')
  const pagerViewRef = useRef<PagerView>(null)
  const theme = useTheme()
  const t = useI18n()

  const handleTabChange = (newTab: TabType) => {
    if (activeTab === newTab) return
    setActiveTab(newTab)
    const tabIndex = TABS.findIndex((t) => t.id === newTab)
    pagerViewRef.current?.setPage(tabIndex)
  }

  const onPageSelected = useCallback(
    (event: PagerViewOnPageSelectedEvent) => {
      const newTab = TABS[event.nativeEvent.position]?.id || 'recommend'
      if (newTab !== activeTab) {
        setActiveTab(newTab)
      }
    },
    [activeTab],
  )

  const handleBackToDiscovery = useCallback(() => {
    setNavActiveId('nav_discovery')
  }, [])

  const pageHeader = (
    <>
      <PageTopInset withSafeAreaTop />
      {/* 标题在上、按钮在同一行在其下方（原来按钮挤在标题右侧） */}
      <View style={styles.titleBlock}>
        {/* 与「推荐」页大标题同一条水平线：同字号/字重，标题行与推荐页 header 行等高、垂直居中 */}
        <View style={styles.titleRow}>
          <Text style={styles.titleText} size={34} color={theme['c-font']}>
            {t('nav_kg_daily_rec')}
          </Text>
        </View>
        <Tabs activeTab={activeTab} onTabChange={handleTabChange} />
      </View>
    </>
  )

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {/* 固定页头：页头（标题 + tab）不再作为列表的 ListHeaderComponent 塞进内容里，
            否则首次进入本页时首帧偏移会把页头一起顶到刘海后面（返回再进又正常）。 */}
        {pageHeader}
        <PagerView
          ref={pagerViewRef}
          style={{ flex: 1 }}
          initialPage={TABS.findIndex((t) => t.id === activeTab)}
          onPageSelected={onPageSelected}
          scrollEnabled
        >
          <View key="recommend">
            <RecSongs type="recommend" />
          </View>
          <View key="everyday">
            <RecSongs type="everyday" />
          </View>
        </PagerView>
      </View>
      <SwipeBackArea onBack={handleBackToDiscovery} />
    </View>
  )
})

const styles = createStyle({
  // 标题独占一行，两个 tab 在它下方另起一行（左右内边距与标题对齐）
  titleBlock: {
    paddingHorizontal: designSpacing.lg,
  },
  // 标题行与「推荐」页 header 行等高（该页那行的高度由右上角 42pt 圆形按钮决定），
  // 标题垂直居中后，两页大标题才落在同一条水平线上
  titleRow: {
    minHeight: 42,
    justifyContent: 'center',
  },
  titleText: {
    fontWeight: '800',
    // 不写死 lineHeight：行高小于字高会把字形往上顶（更贴状态栏）、字号放大时还会裁掉笔画，
    // 与「推荐」页大标题一致，交给系统按字体度量计算
  },
  // 两个 tab 同一行：横向滚动兜底，字号放大 / 窄屏放不下时可左右滑动，不会换行或被裁掉
  tabsScroll: {
    flexGrow: 0,
    flexShrink: 1,
    marginTop: 4,
  },
  tabsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  tabText: {
    paddingBottom: 5,
    borderBottomWidth: BorderWidths.normal3,
  },
})
