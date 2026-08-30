import { memo, useMemo, useState, useEffect } from 'react'
import { ScrollView, TouchableOpacity, View, Dimensions, Platform } from 'react-native'
import { useNavActiveId, useStatusbarHeight, useBgPic } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { Icon } from '@/components/common/Icon'
import { SvgIcon } from '@/components/common/SvgIcon'
import { confirmDialog, createStyle, exitApp as backHome } from '@/utils/tools'
import { NAV_MENUS, NAV_GROUPS, type NavGroup, type NAV_ID_Type, getEffectiveFlatOrder, getEffectiveGroupChildren } from '@/config/constant'
import type { InitState } from '@/store/common/state'
// import commonState from '@/store/common/state'
import { exitApp, setNavActiveId, updateSetting } from '@/core/common'
import { BorderWidths } from '@/theme'
import { useSettingValue } from '@/store/setting/hook'
import ImageBackground from '@/components/common/ImageBackground'
import { defaultHeaders } from '@/components/common/Image'
import { getCutoutLeftPx } from '@/utils/nativeModules/utils'
import commonState from '@/store/common/state'
import { navigations } from '@/navigation'
import { useLandscapeLayout } from '@/utils/landscapeLayout'

const NAV_WIDTH = 68

const useCutoutLeft = () => {
  const [cutoutLeftDp, setCutoutLeftDp] = useState(() => {
    // iOS 不存在 Android 式的左侧刘海缺口，安全区由 RNN/system 处理；
    // 旧逻辑用 screen.width - window.width 在 iPad 横屏/Stage Manager 下会算出巨大边距，挤压右侧内容。
    if (Platform.OS === 'ios') return 0
    const screen = Dimensions.get('screen')
    const win = Dimensions.get('window')
    return Math.max(0, screen.width - win.width)
  })

  useEffect(() => {
    if (Platform.OS === 'ios') return
    const update = () => {
      void getCutoutLeftPx().then((px: number) => {
        const { PixelRatio } = require('react-native')
        setCutoutLeftDp(px > 0 ? Math.round(px / PixelRatio.get()) : 0)
      })
    }
    update()
    const sub = Dimensions.addEventListener('change', update)
    return () => sub?.remove()
  }, [])

  return cutoutLeftDp
}

const styles = createStyle({
  container: {
    flexGrow: 0,
    // flex: 1,
    // alignItems: 'center',
    // justifyContent: 'center',
    // padding: 10,
    borderRightWidth: BorderWidths.normal,
    // 底部内边距：满宽悬浮的迷你播放器（高约 72）会盖住屏幕底部，
    // 这里在原有 10 基础上加 80，让底部历史/下载按钮浮在胶囊上方不被遮挡。
    paddingBottom: 90,
    width: NAV_WIDTH,
  },
  header: {
    paddingTop: 15,
    paddingBottom: 15,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    textAlign: 'center',
    marginLeft: 16,
  },
  menus: {
    flex: 1,
  },
  list: {
    // paddingTop: 10,
    paddingBottom: 15,
  },
  menuItem: {
    flexDirection: 'row',
    paddingTop: 15,
    paddingBottom: 15,
    // paddingLeft: 25,
    // paddingRight: 25,
    justifyContent: 'center',
    alignItems: 'center',
    // backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  subMenuItem: {
    paddingTop: 9,
    paddingBottom: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContent: {
    // width: 24,
    // backgroundColor: 'rgba(0, 0, 0, 0.2)',
    alignItems: 'center',
  },
  text: {
    paddingLeft: 15,
    // fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 4,
    marginHorizontal: 12,
  },
  footer: {
    paddingVertical: 6,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerBtn: {
    padding: 8,
  },
})

const Header = () => {
  const theme = useTheme()
  const statusBarHeight = useStatusbarHeight()

  const handleLogoPress = () => {
    setNavActiveId('nav_love')
  }

  return (
    <View style={{ paddingTop: statusBarHeight }}>
      <TouchableOpacity style={styles.header} onPress={handleLogoPress}>
        <Icon name="logo" color={theme['c-primary-dark-100-alpha-300']} size={22} />
      </TouchableOpacity>
    </View>
  )
}

type IdType = InitState['navActiveId'] | 'nav_exit' | 'back_home'

const renderIcon = (icon: string, size: number, color: string) => {
  if (icon.startsWith('svg:')) {
    return <SvgIcon name={icon.slice(4)} size={size} color={color} />
  }
  return <Icon name={icon} size={size} color={color} />
}

const MenuItem = ({
  id,
  icon,
  iconSize,
  onPress,
}: {
  id: IdType
  icon: string
  iconSize: number
  onPress: (id: IdType) => void
}) => {
  // const t = useI18n()
  const activeId = useNavActiveId()
  const theme = useTheme()

  return activeId == id ? (
    <View style={{ ...styles.menuItem, backgroundColor: theme['c-primary-background-hover'] }}>
      <View style={styles.iconContent}>
        {renderIcon(icon, iconSize, theme['c-primary-font-active'])}
      </View>
      {/* <Text style={styles.text} size={14} color={theme['c-primary-font']}>{t(id)}</Text> */}
    </View>
  ) : (
    <TouchableOpacity
      style={styles.menuItem}
      onPress={() => {
        onPress(id)
      }}
    >
      <View style={styles.iconContent}>
        {renderIcon(icon, iconSize, theme['c-font-label'])}
      </View>
      {/* <Text style={styles.text} size={14}>{t(id)}</Text> */}
    </TouchableOpacity>
  )
}

const CollapsibleGroupItem = ({
  group,
  iconSize,
  onPress,
}: {
  group: NavGroup
  iconSize: number
  onPress: (id: IdType) => void
}) => {
  const theme = useTheme()
  const activeId = useNavActiveId()
  const navGroupExpanded = useSettingValue('common.navGroupExpanded')
  const navGroupOrder = useSettingValue('common.navGroupOrder')
  const navStatus = useSettingValue('common.navStatus')
  const isExpanded = navGroupExpanded[group.id] ?? false

  const orderedChildren = useMemo(() => {
    return getEffectiveGroupChildren(group, navGroupOrder[group.id])
      .filter(id => (navStatus[id as keyof typeof navStatus] ?? true))
  }, [group, navGroupOrder, navStatus])

  const toggleCollapse = () => {
    updateSetting({ 'common.navGroupExpanded': { ...navGroupExpanded, [group.id]: !isExpanded } })
  }

  return (
    <View>
      <TouchableOpacity style={styles.menuItem} onPress={toggleCollapse}>
        <View style={styles.iconContent}>
          {renderIcon(group.icon, iconSize, theme['c-font-label'])}
        </View>
      </TouchableOpacity>
      {isExpanded
        ? orderedChildren.map(childId => {
            const childMenu = NAV_MENUS.find(m => m.id === childId)
            if (!childMenu) return null
            const isActive = childId === activeId
            return (
              <TouchableOpacity
                key={childId}
                style={styles.subMenuItem}
                onPress={() => onPress(childId as IdType)}
              >
                <View style={styles.iconContent}>
                  {renderIcon(
                    childMenu.icon,
                    Math.round(iconSize * 0.85),
                    isActive ? theme['c-primary-font-active'] : theme['c-font-label']
                  )}
                </View>
              </TouchableOpacity>
            )
          })
        : null}
    </View>
  )
}

export default memo(() => {
  const theme = useTheme()
  // console.log('render drawer nav')
  const showBackBtn = useSettingValue('common.showBackBtn')
  const showExitBtn = useSettingValue('common.showExitBtn')
  const navStatus = useSettingValue('common.navStatus');
  const navOrder = useSettingValue('common.navOrder');
  const navFlatOrder = useSettingValue('common.navFlatOrder');
  const navGroupEnabled = useSettingValue('common.navGroupEnabled');
  const navGroupOrder = useSettingValue('common.navGroupOrder');
  const navGroupVisible = useSettingValue('common.navGroupVisible');
  const navGroupExpanded = useSettingValue('common.navGroupExpanded');
  const isDynamicBg = useSettingValue('theme.dynamicBg');
  const isSidebarDynamicBg = useSettingValue('theme.sidebarDynamicBg');
  const dynamicPic = useBgPic();
  const customBgPicPath = useSettingValue('theme.customBgPicPath');
  const pic = customBgPicPath || dynamicPic;
  const blur = useSettingValue('theme.blur');
  const picOpacity = useSettingValue('theme.picOpacity');

  const showSidebarBg = isDynamicBg && isSidebarDynamicBg && pic;

  const handlePress = (id: IdType) => {
    switch (id) {
      case 'nav_exit':
        void confirmDialog({
          message: global.i18n.t('exit_app_tip'),
          confirmButtonText: global.i18n.t('list_remove_tip_button'),
        }).then((isExit) => {
          if (!isExit) return
          exitApp('Exit Btn')
        })
        return
      case 'back_home':
        backHome()
        return
    }

    global.app_event.changeMenuVisible(false)
    setNavActiveId(id as any)
  }

  const filteredNavMenus = useMemo(() => {
    const order: NAV_ID_Type[] = navGroupEnabled
      ? (navOrder as NAV_ID_Type[])
      : getEffectiveFlatOrder(navFlatOrder, navOrder)
    if (!order?.length) return NAV_MENUS.filter(
      menu => menu.id !== 'nav_play_history' && (menu.id === 'nav_setting' || (navStatus[menu.id] ?? true))
    )
    return order
      .filter(id => id !== 'nav_play_history')
      .map(id => NAV_MENUS.find(menu => menu.id === id))
      .filter((menu): menu is typeof NAV_MENUS[number] => menu !== undefined && (menu.id === 'nav_setting' || (navStatus[menu.id] ?? true)))
  }, [navStatus, navOrder, navFlatOrder, navGroupEnabled])

  const visibleGroups = useMemo(() => {
    return NAV_GROUPS.filter(group => {
      if (navGroupVisible && navGroupVisible[group.id] === false) return false
      return true
    })
  }, [navGroupVisible])

  const groupChildIds = useMemo(() => new Set(NAV_GROUPS.flatMap(g => g.children)), [])

  const menuWithGroups = useMemo(() => {
    if (!navGroupEnabled) {
      return filteredNavMenus.map(menu => ({ type: 'menu' as const, menu }))
    }
    const items: Array<{ type: 'menu'; menu: typeof NAV_MENUS[number] } | { type: 'group'; group: NavGroup }> = []
    const insertedGroupIds = new Set<string>()
    for (const menu of filteredNavMenus) {
      if (groupChildIds.has(menu.id as any)) {
        const parentGroup = visibleGroups.find(g => g.children.includes(menu.id as any))
        if (parentGroup && !insertedGroupIds.has(parentGroup.id)) {
          items.push({ type: 'group', group: parentGroup })
          insertedGroupIds.add(parentGroup.id)
        }
        continue
      }
      items.push({ type: 'menu', menu })
    }
    for (const group of visibleGroups) {
      if (!insertedGroupIds.has(group.id)) {
        const order = (navOrder as NAV_ID_Type[]) || NAV_MENUS.map(m => m.id)
        const firstChildIdx = order.findIndex(id => group.children.includes(id as any))
        let insertIdx = items.length
        if (firstChildIdx >= 0) {
          for (let i = 0; i < items.length; i++) {
            const item = items[i]
            const itemOrderIdx = order.indexOf(item.type === 'group' ? (NAV_GROUPS.find(g => g.id === item.group.id)?.children[0] as any) : item.menu.id)
            if (itemOrderIdx > firstChildIdx) { insertIdx = i; break }
          }
        }
        items.splice(insertIdx, 0, { type: 'group', group })
      }
    }
    return items
  }, [filteredNavMenus, visibleGroups, groupChildIds, navGroupEnabled, navOrder])

  const isLandscapeStretch = useSettingValue('theme.isLandscapeStretch')
  const layout = useLandscapeLayout()
  const rawCutoutLeft = useCutoutLeft()
  const cutoutLeft = isLandscapeStretch ? 0 : rawCutoutLeft

  const handleHistoryPress = () => {
    setNavActiveId('nav_play_history')
  }

  return (
    <View style={{ ...styles.container, width: layout.asideWidth, marginLeft: cutoutLeft, borderRightColor: theme['c-border-background'], backgroundColor: showSidebarBg ? 'transparent' : undefined }}>
      {showSidebarBg ? (
        <ImageBackground
          style={{
            position: 'absolute',
            left: -cutoutLeft,
            top: 0,
            bottom: 0,
            right: 0,
          }}
          source={{ uri: pic, headers: defaultHeaders }}
          resizeMode="cover"
          blurRadius={blur}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: theme['c-content-background'],
              opacity: picOpacity / 100,
            }}
          />
        </ImageBackground>
      ) : null}
      <Header />
      <ScrollView style={styles.menus}>
        <View style={styles.list}>
          {menuWithGroups.map((item) => {
            if (item.type === 'group') {
              return <CollapsibleGroupItem key={item.group.id} group={item.group} iconSize={layout.asideIconSize} onPress={handlePress} />
            }
            return <MenuItem key={item.menu.id} id={item.menu.id} icon={item.menu.icon} iconSize={layout.asideIconSize} onPress={handlePress} />
          })}
          <View style={styles.divider} />
        </View>
      </ScrollView>
      {global.lx.isCarMode && showBackBtn ? <MenuItem id="back_home" icon="home" iconSize={layout.asideIconSize} onPress={handlePress} /> : null}
      {global.lx.isCarMode && showExitBtn ? <MenuItem id="nav_exit" icon="exit2" iconSize={layout.asideIconSize} onPress={handlePress} /> : null}

      <View style={styles.footer}>
        <TouchableOpacity style={styles.footerBtn} onPress={handleHistoryPress}>
          <Icon name="music_time" size={22} color={theme['c-font-label']} />
        </TouchableOpacity>
      </View>
    </View>
  )
})
