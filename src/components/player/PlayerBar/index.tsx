import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { ImageBackground, PanResponder, StyleSheet, View, TouchableOpacity, useWindowDimensions } from 'react-native'
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
import { useBgPic } from '@/store/common/hook'
import { defaultHeaders } from '@/components/common/Image'

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
  const dynamicPic = useBgPic()
  const customBgPicPath = useSettingValue('theme.customBgPicPath')
  const blurSetting = useSettingValue('theme.blur')
  const { height: windowHeight } = useWindowDimensions()
  // 胶囊在窗口中的 y 坐标：通过 onLayout + measureInWindow 测量得到，
  // 用于把背景图的"窗口对齐副本"定位到胶囊区域，让模糊图与页面背景无缝衔接。
  const containerRef = useRef<View>(null)
  const [frostedY, setFrostedY] = useState(0)

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
      // 迷你播放器磨砂玻璃胶囊：纯 JS 路线，依赖 RN 内置的 Image.blurRadius（无需原生 pod）。
      // 不透明度由主题设置 theme.miniPlayerOpacity 控制（0–100），同时控制 blurRadius 和白色叠层。
      const opacity = (Number(miniPlayerOpacity) || 0) / 100
      // 背景图源与 PageContent 保持一致（动态封面 > 自定义背景 > 主题默认图），
      // 用 defaultHeaders 解决部分音源 CDN 对无 UA 请求返回 403 的问题。
      const pic = customBgPicPath || dynamicPic
      const bgSource: any = pic
        ? { uri: pic, headers: defaultHeaders }
        : (theme['bg-image'] || null)
      // blurRadius 取一个明显强于页面背景的值（≥25），保证胶囊里看到的是"被重模糊"的图，
      // 而不是与页面同强度的模糊（那会和上面的页面背景视觉上糊在一起，失去磨砂玻璃边界感）。
      const barBlurRadius = Math.max(Number(blurSetting) || 10, 25)
      const containerStyle = {
        borderColor: `rgba(255, 255, 255, ${Math.min(0.5, opacity * 0.6 + 0.2)})`,
      }
      // wrapper 留 16 水平边距，让胶囊呈"悬浮胶囊"形态而不是满宽。
      return (
        <View style={styles.wrapper}>
          <View
            ref={containerRef}
            style={[styles.container, containerStyle]}
            {...panResponder.panHandlers}
            onLayout={() => {
              // 用 measureInWindow 拿到胶囊在窗口中的真实 y 坐标，
              // 这样背景图"窗口对齐副本"才能精准覆盖到胶囊区域，与 PageContent 背景无缝衔接。
              containerRef.current?.measureInWindow((_x, y) => {
                if (Math.round(y) !== Math.round(frostedY)) setFrostedY(y)
              })
            }}
          >
            {bgSource && frostedY > 0 ? (
              <ImageBackground
                source={bgSource}
                resizeMode="cover"
                blurRadius={barBlurRadius}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: -frostedY,
                  height: windowHeight,
                }}
              />
            ) : null}
            {/* 极薄的白色叠层：让磨砂玻璃偏冷白/亮调（iOS light 风格），又不至于把模糊图盖住 */}
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFillObject, { backgroundColor: `rgba(255, 255, 255, ${Math.min(0.3, opacity * 0.6)})` }]}
            />
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
    // 椭圆磨砂胶囊：绝对定位浮在屏幕底部（iOS Music 同款），不再挤压列表高度。
    // 留 16 水平边距让胶囊"悬浮"在底部两侧。
    // 父容器需要 flex:1 + position:'relative' 作为定位参照；
    // 内容区域需要给列表加 paddingBottom 避免最后一项被盖住。
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  container: {
    width: '100%',
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 12,
    // 椭圆磨砂胶囊：四个角都用 28 大圆角，左右两端呈半圆（胶囊形）
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 0.5,
    shadowColor: 'rgba(0, 0, 0, 0.12)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
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
