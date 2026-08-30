import { memo, useCallback, useMemo, useRef, type ComponentType } from 'react'
import { PanResponder, StyleSheet, View, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native'
import { useKeyboard } from '@/utils/hooks'
import Pic from './components/Pic'
import Title from './components/Title'
import PlayInfo from './components/PlayInfo'
import ControlBtn from './components/ControlBtn'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { Icon } from '@/components/common/Icon'
import { navigations } from '@/navigation'
import { PLAY_DETAIL_SCREEN } from '@/navigation/screenNames'
import commonState from '@/store/common/state'
import { usePlayerMusicInfo } from '@/store/player/hook'
import PlayerPlaylist, { PlayerPlaylistType } from '@/components/player/PlayerPlaylist.tsx'
import MiniProgressBar from "@/components/player/PlayerBar/components/MiniProgressBar.tsx"
import playerState from '@/store/player/state'
import { LIST_IDS } from '@/config/constant'

type BlurViewComponent = ComponentType<{
  style?: StyleProp<ViewStyle>
  blurType?: string
  blurAmount?: number
  reducedTransparencyFallbackColor?: string
}>
// 磨砂玻璃需要原生模块 @react-native-community/blur（需 cd ios && pod install 后重新编译原生工程）。
// 原生模块未链接时，直接 import 会在模块加载期抛错，这里延迟加载：可用则用 BlurView 做真正的
// 实时模糊；不可用则降级为半透明白色叠加层，保证未 pod install 时也能正常编译运行不闪退。
let BlurView: BlurViewComponent | null = null
try {
  BlurView = require('@react-native-community/blur').BlurView
} catch {
  BlurView = null
}

export default memo(({ componentId, isHome = false }: { componentId?: string, isHome?: boolean }) => {
  const { keyboardShown } = useKeyboard()
  const theme = useTheme()
  const musicInfo = usePlayerMusicInfo()
  const longPressedRef = useRef(false)
  const navigatingRef = useRef(false)
  const playlistRef = useRef<PlayerPlaylistType>(null)
  const drawerLayoutPosition = useSettingValue('common.drawerLayoutPosition')
  const picOpacity = useSettingValue('theme.picOpacity')
  const miniPlayerOpacity = useSettingValue('theme.miniPlayerOpacity')
  const isSwipeToShowPlaylist = useSettingValue('player.isSwipeToShowPlaylist')

  const handleLongPress = useCallback(() => {
    longPressedRef.current = true
    const listId = playerState.playMusicInfo.listId
    if (!listId || listId == LIST_IDS.DOWNLOAD) return
    global.app_event.jumpListPosition()
  }, [])

  const handleNavigate = () => {
    if (longPressedRef.current) {
      longPressedRef.current = false
      return
    }
    if (!musicInfo.id) return
    // 防重入：动画进行中忽略连续点击，避免 PlayDetail 被反复压栈导致界面卡死。
    if (navigatingRef.current) return
    const ids = commonState.componentIds
    // 若顶层已是播放详情页，不再重复 push。
    if (ids.length && String(ids[ids.length - 1]?.name) === PLAY_DETAIL_SCREEN) return
    navigatingRef.current = true
    const currentComponentId = ids[ids.length - 1]?.id!
    navigations.pushPlayDetailScreen(currentComponentId)
    setTimeout(() => {
      navigatingRef.current = false
    }, 600)
  }

  const handleShowPlaylist = () => {
    playlistRef.current?.show()
  }

  // 注意：不要监听全局 showPlaylist 事件。该事件由播放详情页的控制条发出，
  // 详情页内有自己的 PlayerPlaylist 实例负责响应；若此处也监听，会导致
  // 详情页打开队列面板时，主界面播放条的队列面板同时在底层打开——用户关闭
  // 详情页面板返回主界面后会“又出现一个队列面板”。本组件的 ☰ 按钮与
  // 上滑手势均直接调用本地 handleShowPlaylist，不依赖全局事件。

  const gestureAction = useRef<'drawer' | 'playlist' | null>(null)
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const { dx, dy } = gestureState
        if (Math.abs(dx) > Math.abs(dy) * 1.5) {
          if (drawerLayoutPosition === 'left' && dx > 10) {
            gestureAction.current = 'drawer'
            return true
          }
          if (drawerLayoutPosition === 'right' && dx < -10) {
            gestureAction.current = 'drawer'
            return true
          }
        } else if (isSwipeToShowPlaylist && Math.abs(dy) > Math.abs(dx) * 1.5) {
          if (dy < -10) {
            gestureAction.current = 'playlist'
            return true
          }
        }
        return false
      },
      onPanResponderRelease: (evt, gestureState) => {
        const { dx, dy } = gestureState
        if (gestureAction.current === 'drawer') {
          if (drawerLayoutPosition === 'left' && dx > 50) {
            global.app_event.changeMenuVisible(true)
          } else if (drawerLayoutPosition === 'right' && dx < -50) {
            global.app_event.changeMenuVisible(true)
          }
        } else if (gestureAction.current === 'playlist' && dy < -50) {
          handleShowPlaylist()
        }
        gestureAction.current = null
      },
      onPanResponderTerminate: (evt, gestureState) => {
        gestureAction.current = null
      },
    }),
  ).current

  const playerComponent = useMemo(
    () => {
      // 迷你播放器磨砂浮层的不透明度由主题设置 theme.miniPlayerOpacity 控制（0–100），
      // 实时计算内联 style（createStyle 在模块加载时冻结，无法读取运行时设置）。
      const opacity = (Number(miniPlayerOpacity) || 0) / 100
      // 磨砂浓度由主题设置 theme.miniPlayerOpacity 控制（0–100 → blurAmount 0–25）。
      // BlurView 的 blurType/blurAmount 是固定值，磨砂玻璃样式不随动态背景的颜色/亮度变化。
      // BlurView 可用时对后方视图做真正的实时模糊（iOS 走 UIVisualEffectView）；
      // 不可用时降级为半透明白色叠加在 PageContent 已模糊的动态背景上。
      const blurAmount = Math.min(25, Math.max(0, opacity * 25))
      const containerStyle = {
        borderColor: `rgba(255, 255, 255, ${Math.min(1, opacity * 0.6 + 0.3)})`,
      }
      // wrapper 保持透明：迷你播放器为满宽磨砂玻璃条，四周不再有纯色大背景块。
      return (
        <View style={styles.wrapper}>
          <View style={[styles.container, containerStyle]} {...panResponder.panHandlers}>
            {BlurView
              ? (
                <BlurView
                  style={StyleSheet.absoluteFillObject}
                  blurType="light"
                  blurAmount={blurAmount}
                  reducedTransparencyFallbackColor="white"
                />
              )
              : (
                <View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFillObject, { backgroundColor: `rgba(255, 255, 255, ${Math.min(0.75, opacity * 1.4)})` }]}
                />
              )}
            <MiniProgressBar />

            <TouchableOpacity style={styles.left} onPress={handleNavigate} onLongPress={handleLongPress} activeOpacity={0.8}>
              <Pic isHome={isHome} />
              <View style={styles.center}>
                <Title isHome={isHome} />
                <PlayInfo isHome={isHome} />
              </View>
            </TouchableOpacity>
            <View style={styles.right}>
              <ControlBtn />
              <TouchableOpacity style={styles.menuBtn} onPress={handleShowPlaylist}>
                <Icon name="menu" color={theme['c-button-font']} size={22} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )
    },
    [theme, isHome, handleShowPlaylist, panResponder.panHandlers, drawerLayoutPosition, miniPlayerOpacity],
  )

  return (
    <>
      {keyboardShown ? null : playerComponent}
      <PlayerPlaylist ref={playlistRef} />
    </>
  )
})

const styles = createStyle({
  wrapper: {
    // 磨砂玻璃条满宽铺底：去掉水平内边距，保留底部安全区
    paddingHorizontal: 0,
    paddingBottom: 18,
    paddingTop: 4,
  },
  container: {
    width: '100%',
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 12,
    // 磨砂玻璃样式：去掉椭圆大圆角（28 全部归零），满宽铺底；
    // BlurView 的 blurType/blurAmount 为固定值，不再随动态背景颜色/亮度变化。
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 0,
    shadowColor: 'rgba(0, 0, 0, 0.08)',
    shadowOffset: { width: 0, height: -1 },
    shadowOpacity: 1,
    shadowRadius: 2,
    overflow: 'hidden',
  },
  left: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  center: {
    flexDirection: 'column',
    flexGrow: 1,
    flexShrink: 1,
    paddingLeft: 5,
    height: '100%',
    // justifyContent: 'space-evenly',
    // height: 48,
    // backgroundColor: 'rgba(0, 0, 0, .1)',
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 0,
    flexShrink: 0,
    paddingLeft: 5,
    paddingRight: 5,
  },
  menuBtn: {
    width: 46,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // row: {
  //   flexDirection: 'row',
  //   flexGrow: 0,
  //   flexShrink: 0,
  // },
})
