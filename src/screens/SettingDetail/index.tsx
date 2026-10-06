import { memo, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'

import PageContent from '@/components/common/PageContent'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import LandscapeCentered from '@/components/layout/LandscapeCentered'
import { pop } from '@/navigation'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useSafeAreaBottom, useStatusbarHeight } from '@/store/common/hook'
import { designSpacing } from '@/theme/DesignTokens'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import { type SettingScreenIds } from '@/screens/Home/Views/Setting/Main'
import { subscribeScrollLock } from '@/utils/scrollLock'
import WebLoginManager from '@/components/login/WebLoginManager'
import QQWebLoginManager from '@/components/login/QQWebLoginManager'
import KgWebLoginManager from '@/components/login/KgWebLoginManager'
import Basic from '@/screens/Home/Views/Setting/settings/Basic'
import Player from '@/screens/Home/Views/Setting/settings/Player'
import Search from '@/screens/Home/Views/Setting/settings/Search'
import List from '@/screens/Home/Views/Setting/settings/List'
import Sync from '@/screens/Home/Views/Setting/settings/Sync'
import Download from '@/screens/Home/Views/Setting/settings/Download'
import Backup from '@/screens/Home/Views/Setting/settings/Backup'
import Other from '@/screens/Home/Views/Setting/settings/Other'
import About from '@/screens/Home/Views/Setting/settings/About'
import ThemeScreen from '@/screens/Home/Views/Setting/settings/ThemeScreen'
import PlatformScreen from '@/screens/Home/Views/Setting/settings/PlatformScreen'

const SETTING_COMPONENTS: Record<SettingScreenIds, ComponentType> = {
  theme: ThemeScreen,
  platform: PlatformScreen,
  player: Player,
  search: Search,
  list: List,
  download: Download,
  sync: Sync,
  backup: Backup,
  other: Other,
  about: About,
  basic: Basic,
}

export default memo(({ settingId, componentId }: {
  settingId: SettingScreenIds
  componentId: string
}) => {
  const theme = useTheme()
  const t = useI18n()
  const safeAreaBottom = useSafeAreaBottom()
  const statusBarHeight = useStatusbarHeight()
  const appearedAtRef = useRef(0)
  // 深层列表项（如自定义源拖拽排序）在拖拽期间通过 scrollLock 请求锁定祖先滚动容器，
  // 避免iOS 原生 UIScrollView 抢手势导致整页随拖动滚动（与 Setting/Horizontal 的处理一致）。
  const [scrollLocked, setScrollLocked] = useState(false)
  useEffect(() => subscribeScrollLock(setScrollLocked), [])

  useEffect(() => {
    setComponentId(COMPONENT_IDS.SETTING_DETAIL, componentId)
    appearedAtRef.current = Date.now()
  }, [componentId])

  // push 转场进行中忽略返回，避免 pop 打断 push；返回走无自定义动画的 popPlain，
  // 与 push 侧（系统默认转场）配套，彻底规避 RNN iOS 自定义转场取消不回调导致的整栈卡死。
  const handleBack = () => {
    if (Date.now() - appearedAtRef.current < 400) return
    void pop(componentId)
  }

  const ActiveScreen = useMemo(() => (
    SETTING_COMPONENTS[settingId] ?? Basic
  ), [settingId])

  const contentStyle = useMemo(() => ({
    // 设置详情内容离屏幕边缘过近，水平内边距从 lg(24) 提到 xl(32)
    paddingHorizontal: designSpacing.xl,
    paddingTop: designSpacing.sm,
    paddingBottom: designSpacing.xl + safeAreaBottom,
  }), [safeAreaBottom])

  return (
    <PageContent>
      <LandscapeCentered>
        <View style={{ ...styles.header, paddingTop: statusBarHeight + designSpacing.sm }}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Icon name="chevron-left" size={20} color={theme['c-font']} />
          </TouchableOpacity>
          <Text size={18} style={styles.title} color={theme['c-font']} numberOfLines={1}>
            {t(`setting_${settingId}`)}
          </Text>
          <View style={styles.headerSpace} />
        </View>
        <ScrollView
          style={styles.content}
          contentContainerStyle={contentStyle}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
          scrollEnabled={!scrollLocked}
          // iOS 键盘避让（默认 false，必须显式开启）：
          // 开启后由原生 RCTScrollView._keyboardWillChangeFrame 处理——键盘出现/尺寸变化时
          // ① 把 contentInset.bottom 设为被遮挡高度（max(遮挡高度, contentInset.bottom)）；
          // ② 沿响应链找到当前第一响应者（即聚焦的输入框），若其底边低于键盘顶边，
          //    则以键盘动画同款时长把它的底边滚到键盘上方（RCTScrollView.m:300-371）。
          // 此前该 ScrollView 完全没有键盘避让，而它就是「设置」各详情页唯一的滚动容器，
          // 因此「数据同步」（WebDAV 的服务器地址/用户名/密码/同步路径、同步服务地址等）
          // 这类靠近底部的输入框一旦聚焦，就会被键盘整块盖住、看不到正在输入的内容。
          // 属性仅 iOS 有效，Android 会忽略（本项目仅 iOS）。
          automaticallyAdjustKeyboardInsets
        >
          <ActiveScreen />
        </ScrollView>
      </LandscapeCentered>
      {/* 登录弹窗必须挂在本页面视图树内：RN Modal 仅在宿主视图挂在窗口上时呈现，
          挂在被 Home 托管的树里会因 Home 被 push 页面覆盖（self.window == nil）而不显示 */}
      <WebLoginManager />
      <QQWebLoginManager />
      <KgWebLoginManager />
    </PageContent>
  )
})

const styles = createStyle({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: designSpacing.sm,
    paddingHorizontal: designSpacing.sm,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '600',
  },
  headerSpace: {
    width: 44,
  },
  content: {
    flex: 1,
  },
})
