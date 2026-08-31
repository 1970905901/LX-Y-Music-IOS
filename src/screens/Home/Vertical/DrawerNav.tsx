import { memo, useMemo, useRef, useState, useCallback } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import { useI18n } from '@/lang'
import { useNavActiveId, useStatusbarHeight } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { Icon } from '@/components/common/Icon'
import { SvgIcon } from '@/components/common/SvgIcon'
import { confirmDialog, createStyle, exitApp as backHome } from '@/utils/tools'
import { NAV_MENUS, NAV_GROUPS, type NavGroup, type NAV_ID_Type, getEffectiveFlatOrder, getEffectiveGroupChildren } from '@/config/constant'
import type { InitState } from '@/store/common/state'
import { exitApp, setNavActiveId } from '@/core/common'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import { Animated as AnimatedType, Easing } from 'react-native'
import { useMyList } from '@/store/list/hook'
import { setActiveList } from '@/core/list'
import { applyOpacity } from '@/utils/colorOpacity'


import { updateSetting } from '@/core/common'

interface MyListItemProps {
  item: LX.List.MyListInfo;
  onPress: () => void;
}

const MyListItem = memo(({
  item,
  onPress,
}: MyListItemProps) => {
  const theme = useTheme();

  return (
    <TouchableOpacity style={styles.subMenuItem} onPress={onPress}>
      <Text size={14} color={theme['c-font-label']} numberOfLines={1}>
        {item.name}
      </Text>
    </TouchableOpacity>
  );
});

const CollapsibleMyListItem = () => {
  const t = useI18n();
  const theme = useTheme();
  const allList = useMyList();
  const [isExpanded, setExpanded] = useState(false);
  const animation = useRef(new AnimatedType.Value(0)).current;
  const contentHeight = useRef(0);

  const toggleCollapse = () => {
    const toValue = isExpanded ? 0 : 1;
    AnimatedType.timing(animation, {
      toValue,
      duration: 300,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();
    setExpanded(!isExpanded);
  };

  const handleSelect = useCallback((listId: string) => {
    setNavActiveId('nav_love');
    setActiveList(listId);
    global.app_event.changeMenuVisible(false);
  }, []);

  const animatedHeight = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, contentHeight.current],
  });

  const animatedOpacity = animation.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0, 1],
  });

  return (
    <View>
      <TouchableOpacity style={styles.menuItem} onPress={toggleCollapse}>
        <View style={styles.iconContent}>
          <Icon name="love" size={20} color={theme['c-font-label']} />
        </View>
        <Text style={styles.text}>{t('nav_love')}</Text>
      </TouchableOpacity>

      <AnimatedType.View style={{ height: animatedHeight, opacity: animatedOpacity, overflow: 'hidden' }}>
        <View
          onLayout={(event) => {
            contentHeight.current = event.nativeEvent.layout.height;
          }}
          style={{ position: 'absolute', width: '100%' }}
        >
          {allList.map((list) => (
            <MyListItem
              key={list.id}
              item={list}
              onPress={() => handleSelect(list.id)}
            />
          ))}
        </View>
      </AnimatedType.View>
    </View>
  );
};

const renderIcon = (icon: string, size: number, color: string) => {
  if (icon.startsWith('svg:')) {
    return <SvgIcon name={icon.slice(4)} size={size} color={color} />
  }
  return <Icon name={icon} size={size} color={color} />
}

const CollapsibleGroupItem = ({ group, activeId, onPress }: { group: NavGroup; activeId: string; onPress: (id: string) => void }) => {
  const t = useI18n()
  const theme = useTheme()
  const navGroupExpanded = useSettingValue('common.navGroupExpanded')
  const navGroupOrder = useSettingValue('common.navGroupOrder')
  const navStatus = useSettingValue('common.navStatus')
  const isExpanded = navGroupExpanded[group.id] ?? false
  const animation = useRef(new AnimatedType.Value(isExpanded ? 1 : 0)).current
  const [contentHeight, setContentHeight] = useState(0)

  const orderedChildren = useMemo(() => {
    return getEffectiveGroupChildren(group, navGroupOrder[group.id])
      .filter(id => (navStatus[id as keyof typeof navStatus] ?? true))
  }, [group, navGroupOrder, navStatus])

  const toggleCollapse = () => {
    const toValue = isExpanded ? 0 : 1
    AnimatedType.timing(animation, {
      toValue,
      duration: 250,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start()
    updateSetting({ 'common.navGroupExpanded': { ...navGroupExpanded, [group.id]: !isExpanded } })
  }

  const animatedHeight = animation.interpolate({ inputRange: [0, 1], outputRange: [0, contentHeight] })
  const animatedOpacity = animation.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] })

  return (
    <View>
      <TouchableOpacity style={styles.menuItem} onPress={toggleCollapse}>
        <View style={styles.iconContent}>
          {renderIcon(group.icon, 20, theme['c-font-label'])}
        </View>
        <Text style={styles.text}>{t(group.label as any)}</Text>
      </TouchableOpacity>
      <AnimatedType.View style={{ height: animatedHeight, opacity: animatedOpacity, overflow: 'hidden' }}>
        <View
          onLayout={(e) => { setContentHeight(e.nativeEvent.layout.height) }}
          style={{ position: 'absolute', width: '100%' }}
        >
          {orderedChildren.map(childId => {
            const childMenu = NAV_MENUS.find(m => m.id === childId)
            if (!childMenu) return null
            return (
              <TouchableOpacity key={childId} style={styles.subMenuItem} onPress={() => onPress(childId)}>
                <Text size={14} color={theme['c-font-label']} numberOfLines={1}>
                  {t(childId as any)}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </AnimatedType.View>
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  menus: {
    flex: 1,
  },
  subMenuItem: {
    paddingVertical: 12,
    paddingLeft: 55,
    paddingRight: 10,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  list: {
    // 顶部/底部内边距与垂直居中由 ScrollView 的 contentContainerStyle 统一控制
    // （顶部：状态栏高度 + 10；底部：避让迷你播放器胶囊 110）。
  },
  menuItem: {
    flexDirection: 'row',
    paddingTop: 13,
    paddingBottom: 13,
    paddingLeft: 25,
    paddingRight: 25,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  iconContent: {
    width: 24,
    alignItems: 'center',
  },
  text: {
    paddingLeft: 20,
  },
  footer: {
    paddingVertical: 5,
    paddingHorizontal: 15,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  footerBtn: {
    padding: 10,
  },
})

type IdType = InitState['navActiveId'] | 'nav_exit' | 'back_home'

const MenuItem = ({
  id,
  icon,
  onPress,
}: {
  id: IdType
  icon: string
  onPress: (id: IdType) => void
}) => {
  const t = useI18n()
  const activeId = useNavActiveId()
  const theme = useTheme()

  return activeId == id ? (
    <View style={{ ...styles.menuItem, backgroundColor: theme['c-primary-background-hover'] }}>
      <View style={styles.iconContent}>
        {renderIcon(icon, 20, theme['c-primary-font-active'])}
      </View>
      <Text style={styles.text} color={theme['c-primary-font']}>
        {t(id)}
      </Text>
    </View>
  ) : (
    <TouchableOpacity
      style={styles.menuItem}
      onPress={() => {
        onPress(id)
      }}
    >
      <View style={styles.iconContent}>
        {renderIcon(icon, 20, theme['c-font-label'])}
      </View>
      <Text style={styles.text}>{t(id)}</Text>
    </TouchableOpacity>
  )
}

export default memo(() => {
  const theme = useTheme()
  const showBackBtn = useSettingValue('common.showBackBtn')
  const showExitBtn = useSettingValue('common.showExitBtn')
  const navStatus = useSettingValue('common.navStatus');
  const navOrder = useSettingValue('common.navOrder');
  const isShowMyListSubMenu = useSettingValue('list.isShowMyListSubMenu');
  const navGroupEnabled = useSettingValue('common.navGroupEnabled');
  const navGroupVisible = useSettingValue('common.navGroupVisible');
  const navFlatOrder = useSettingValue('common.navFlatOrder');
  const sidebarOpacity = useSettingValue('theme.sidebarOpacity');
  const statusBarHeight = useStatusbarHeight()
  const activeId = useNavActiveId()

  // Convert opacity (0-100) to an alpha-composited background color.
  // Applying opacity to the View would fade the text too; tinting only the
  // background keeps menu labels fully opaque.
  const bgColorWithOpacity = applyOpacity(theme['c-content-background'], sidebarOpacity)

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
      menu => menu.id === 'nav_setting' || (navStatus[menu.id] ?? true)
    )
    return order
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
  }, [filteredNavMenus, visibleGroups, groupChildIds, navGroupEnabled])

  return (
    <View style={{ ...styles.container, backgroundColor: bgColorWithOpacity }}>
      <ScrollView
        style={styles.menus}
        contentContainerStyle={{
          paddingTop: statusBarHeight,
          paddingBottom: 110,
          flexGrow: 1,
          justifyContent: 'center',
        }}
      >
        <View style={styles.list}>
          {menuWithGroups.map((item, idx) => {
            if (item.type === 'group') {
              return <CollapsibleGroupItem key={item.group.id} group={item.group} activeId={activeId} onPress={handlePress as any} />
            }
            const menu = item.menu
            if (menu.id === 'nav_love') {
              return isShowMyListSubMenu
                ? <CollapsibleMyListItem key={menu.id} />
                : <MenuItem key={menu.id} id={menu.id} icon={menu.icon} onPress={handlePress} />
            }
            return <MenuItem key={menu.id} id={menu.id} icon={menu.icon} onPress={handlePress} />
          })}
        </View>
      </ScrollView>

      {global.lx.isCarMode && showBackBtn ? <MenuItem id="back_home" icon="home" onPress={handlePress} /> : null}
      {global.lx.isCarMode && showExitBtn ? <MenuItem id="nav_exit" icon="exit2" onPress={handlePress} /> : null}
    </View>
  )
})
