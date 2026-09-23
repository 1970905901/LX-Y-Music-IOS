import {StyleSheet, View, TouchableOpacity, PanResponder} from 'react-native'
// import Button from '@/components/common/Button'
// import { navigations } from '@/navigation'
// import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import { useNavActiveId, useStatusbarHeight } from '@/store/common/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import StatusBar from '@/components/common/StatusBar'
import { useSettingValue } from '@/store/setting/hook'
import { scaleSizeH } from '@/utils/pixelRatio'
import { HEADER_HEIGHT } from '@/config/constant'
import { designSpacing } from '@/theme/DesignTokens'
import { type InitState as CommonState } from '@/store/common/state'
import SearchTypeSelector from '@/screens/Home/Views/Search/SearchTypeSelector'
import GlobalSearch from '@/components/GlobalSearch'
import React, {useMemo, useRef} from "react";

const headerComponents: Partial<Record<CommonState['navActiveId'], React.ReactNode>> = {
  nav_search: <SearchTypeSelector />,
}

// const LeftTitle = () => {
//   const id = useNavActiveId()
//   const t = useI18n()

//   return <Text style={styles.leftTitle} size={18}>{t(id)}</Text>
// }
const LeftHeader = () => {
  const theme = useTheme()
  const id = useNavActiveId()
  const t = useI18n()
  const statusBarHeight = useStatusbarHeight()

  const isSearchPage = id === 'nav_search'
  const openMenu = () => {
    global.app_event.changeMenuVisible(true)
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const { dx, dy } = gestureState;
        return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10;
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx > 40) {
          global.app_event.changeMenuVisible(true);
        }
      },
    }),
  ).current;
  const menuBtnStyle = useMemo(
    () => StyleSheet.compose(styles.btn, {
      backgroundColor: theme['c-primary-background'],
    }),
    [theme],
  )

  return (
    <View
      style={{
        ...styles.container,
        height: scaleSizeH(HEADER_HEIGHT) + statusBarHeight,
        paddingTop: statusBarHeight,
      }}
      {...panResponder.panHandlers}
    >
      <View style={styles.left}>
        <TouchableOpacity style={menuBtnStyle} onPress={openMenu}>
          <Icon color={theme['c-font']} name="menu" size={18} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.titleBtn} onPress={openMenu}>
          <Text style={styles.leftTitle} size={20}>
            {t(id)}
          </Text>
        </TouchableOpacity>
      </View>
      {isSearchPage ? headerComponents[id] : <GlobalSearch />}

      {/* <TouchableOpacity style={menuBtnStyle} onPress={openSetting}>
        <Icon style={{ ...styles.btnText, color: theme['c-font'] }} name="setting" size={styles.btnText.fontSize} />
      </TouchableOpacity> */}
    </View>
  )
}

// const RightTitle = () => {
//   const id = useNavActiveId()
//   const t = useI18n()

//   return <Text style={styles.rightTitle} size={18}>{t(id)}</Text>
// }
const RightHeader = () => {
  const theme = useTheme()
  const t = useI18n()
  const id = useNavActiveId()
  const statusBarHeight = useStatusbarHeight()

  const isSearchPage = id === 'nav_search'
  const openMenu = () => {
    global.app_event.changeMenuVisible(true)
  }
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const { dx, dy } = gestureState;
        return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10;
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx < -40) {
          global.app_event.changeMenuVisible(true);
        }
      },
    }),
  ).current;
  const menuBtnStyle = useMemo(
    () => StyleSheet.compose(styles.btn, {
      backgroundColor: theme['c-primary-background'],
    }),
    [theme],
  )

  return (
    <View
      style={{
        ...styles.container,
        height: scaleSizeH(HEADER_HEIGHT) + statusBarHeight,
        paddingTop: statusBarHeight,
      }}
      {...panResponder.panHandlers}
    >
      <View style={styles.left}>
        <TouchableOpacity style={styles.titleBtn} onPress={openMenu}>
          <Text style={styles.rightTitle} size={20}>
            {t(id)}
          </Text>
        </TouchableOpacity>
      </View>

      {isSearchPage ? headerComponents[id] : <GlobalSearch />}
      <TouchableOpacity style={menuBtnStyle} onPress={openMenu}>
        <Icon color={theme['c-font']} name="menu" size={18} />
      </TouchableOpacity>
      {/* <TouchableOpacity style={menuBtnStyle} onPress={openSetting}>
        <Icon style={{ ...styles.btnText, color: theme['c-font'] }} name="setting" size={styles.btnText.fontSize} />
      </TouchableOpacity> */}
    </View>
  )
}

const Header = () => {
  const drawerLayoutPosition = useSettingValue('common.drawerLayoutPosition')

  return (
    <>
      <StatusBar />
      {drawerLayoutPosition == 'left' ? <LeftHeader /> : <RightHeader />}
    </>
  )
}

const styles = createStyle({
  container: {
    // width: '100%',
    paddingRight: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    // backgroundColor: 'rgba(0,0,0,0.1)',
    zIndex: 10,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    paddingLeft: 12,
    alignItems: 'center',
    height: '100%',
  },
  btn: {
    // flex: 1,
    width: HEADER_HEIGHT,
    height: HEADER_HEIGHT,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: designSpacing.xs,
  },
  titleBtn: {
    flex: 1,
    // backgroundColor: 'rgba(0,0,0,0.1)',
    height: '100%',
    justifyContent: 'center',
  },
  leftTitle: {
    paddingLeft: designSpacing.xs,
    paddingRight: designSpacing.sm,
    fontWeight: '700',
  },
  rightTitle: {
    paddingLeft: designSpacing.sm,
    paddingRight: designSpacing.sm,
    fontWeight: '700',
  },
})

export default Header
