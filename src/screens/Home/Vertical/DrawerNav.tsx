import { memo, useMemo, useRef, useState, useCallback } from 'react'
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native'
import { useI18n } from '@/lang'
import { useNavActiveId, useStatusbarHeight } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { Icon } from '@/components/common/Icon'
import { SvgIcon } from '@/components/common/SvgIcon'
import { confirmDialog, createStyle, exitApp as backHome } from '@/utils/tools'
import { NAV_MENUS, type NAV_ID_Type, getEffectiveFlatOrder } from '@/config/constant'
import type { InitState } from '@/store/common/state'
import { exitApp, setNavActiveId } from '@/core/common'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import { Animated as AnimatedType, Easing } from 'react-native'
import { useMyList } from '@/store/list/hook'
import { setActiveList } from '@/core/list'
import { applyOpacity } from '@/utils/colorOpacity'
import { designRadius, designSpacing } from '@/theme/DesignTokens'



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
    height: 48,
    marginHorizontal: designSpacing.sm,
    marginBottom: designSpacing.xs,
    borderRadius: designRadius.md,
    paddingLeft: designSpacing.lg,
    paddingRight: designSpacing.md,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  iconContent: {
    width: 24,
    alignItems: 'center',
  },
  text: {
    paddingLeft: designSpacing.md,
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

  const activeItemStyle = useMemo(
    () => StyleSheet.compose(styles.menuItem, {
      backgroundColor: theme['c-primary-background-hover'],
    }),
    [theme],
  )

  return activeId == id ? (
    <View style={activeItemStyle}>
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
    const order: NAV_ID_Type[] = getEffectiveFlatOrder(navFlatOrder, navOrder)
    if (!order?.length) return NAV_MENUS.filter(
      menu => menu.id === 'nav_setting' || (navStatus[menu.id] ?? true)
    )
    return order
      .map(id => NAV_MENUS.find(menu => menu.id === id))
      .filter((menu): menu is typeof NAV_MENUS[number] => menu !== undefined && (menu.id === 'nav_setting' || (navStatus[menu.id] ?? true)))
  }, [navStatus, navOrder, navFlatOrder])

  return (
    <View style={{ ...styles.container, backgroundColor: bgColorWithOpacity }}>
      <ScrollView
        style={styles.menus}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: statusBarHeight,
          paddingBottom: 110,
          flexGrow: 1,
          justifyContent: 'center',
        }}
      >
        <View style={styles.list}>
          {filteredNavMenus.map((menu) => {
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
