import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import settingState from '@/store/setting/state'
import Content from './Content'
import TagList from './TagList'
import { useTheme } from '@/store/theme/hook'
import { useHorizontalMode } from '@/utils/hooks'
import DrawerLayoutFixed, {
  type DrawerLayoutFixedType,
} from '@/components/common/DrawerLayoutFixed'
import { COMPONENT_IDS } from '@/config/constant'
import { scaleSizeW } from '@/utils/pixelRatio'
import { useI18n } from '@/lang'
import PageHeader from '@/components/common/PageHeader'
import type { InitState as CommonState } from '@/store/common/state'

const MAX_WIDTH = scaleSizeW(560)

export default () => {
  const drawer = useRef<DrawerLayoutFixedType>(null)
  const theme = useTheme()
  const isHorizontal = useHorizontalMode()
  const t = useI18n()

  useEffect(() => {
    const handleFixDrawer = (id: CommonState['navActiveId']) => {
      if (id == 'nav_songlist') drawer.current?.fixWidth()
    }
    const handleShow = () => {
      requestAnimationFrame(() => {
        drawer.current?.openDrawer()
      })
    }
    const handleHide = () => {
      drawer.current?.closeDrawer()
    }

    global.state_event.on('navActiveIdUpdated', handleFixDrawer)
    global.app_event.on('showSonglistTagList', handleShow)
    global.app_event.on('hideSonglistTagList', handleHide)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleFixDrawer)
      global.app_event.off('showSonglistTagList', handleShow)
      global.app_event.off('hideSonglistTagList', handleHide)
    }
  }, [])

  const navigationView = () => <TagList />
  // console.log('render drawer content')

  // iPad 横屏：标签列表常驻左栏、歌单列表在右栏（master-detail），竖屏走抽屉。
  if (isHorizontal) {
    return (
      <View style={{ flex: 1 }}>
        <PageHeader title={t('nav_songlist')} />
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View
            style={{
              width: 280,
              flexShrink: 0,
              borderRightWidth: 1,
              borderRightColor: theme['c-border-background'],
            }}
          >
            <TagList />
          </View>
          <View style={{ flex: 1, overflow: 'hidden' }}>
            <Content />
          </View>
        </View>
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <PageHeader title={t('nav_songlist')} />
      <DrawerLayoutFixed
        ref={drawer}
        visibleNavNames={[COMPONENT_IDS.home]}
        widthPercentage={0.8}
        widthPercentageMax={MAX_WIDTH}
        drawerPosition={settingState.setting['common.drawerLayoutPosition']}
        renderNavigationView={navigationView}
        drawerBackgroundColor={theme['c-content-background']}
      >
        <Content />
      </DrawerLayoutFixed>
    </View>
  )
}
