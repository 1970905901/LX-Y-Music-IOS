import { useEffect, useRef } from 'react'
// import { getWindowSise, onDimensionChange } from '@/utils/tools'
import DrawerNav from './DrawerNav'
import Header from './Header'
import Main from './Main'
import { useSettingValue } from '@/store/setting/hook'
import { COMPONENT_IDS } from '@/config/constant'
import DrawerLayoutFixed, {
  type DrawerLayoutFixedType,
} from '@/components/common/DrawerLayoutFixed'
import { scaleSizeW } from '@/utils/pixelRatio'

// 侧边栏宽度只需容纳最长的菜单项（如“网易每日推荐”6 个中文字符：
// 左内边距 25 + 图标 24 + 文字左距 20 + 文字约 90 + 右内边距 25 ≈ 184）。
// 取 188 预留少量边距，避免右侧大片空白。
const MAX_WIDTH = scaleSizeW(188)

const Content = () => {
  const drawer = useRef<DrawerLayoutFixedType>(null)
  const drawerLayoutPosition = useSettingValue('common.drawerLayoutPosition')

  useEffect(() => {
    const changeVisible = (visible: boolean) => {
      if (visible) {
        drawer.current?.openDrawer()
      } else {
        drawer.current?.closeDrawer()
      }
    }

    global.app_event.on('changeMenuVisible', changeVisible)

    return () => {
      global.app_event.off('changeMenuVisible', changeVisible)
    }
  }, [])

  const navigationView = () => <DrawerNav />
  // console.log('render drawer content')

  return (
    <DrawerLayoutFixed
      ref={drawer}
      widthPercentage={0.85}
      widthPercentageMax={MAX_WIDTH}
      visibleNavNames={[COMPONENT_IDS.home]}
      // drawerWidth={width}
      drawerPosition={drawerLayoutPosition}
      renderNavigationView={navigationView}
    >
      <Header />
      <Main />
      {/* <View style={styles.container}>
      </View> */}
    </DrawerLayoutFixed>
  )
}

// const styles = createStyle({
//   container: {
//     flex: 1,
//   },
// })

export default Content
