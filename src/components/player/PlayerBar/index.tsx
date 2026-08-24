import {memo, useCallback, useEffect, useMemo, useRef} from 'react'
import { PanResponder, View, TouchableOpacity } from 'react-native'
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
import commonState from '@/store/common/state'
import { usePlayerMusicInfo } from '@/store/player/hook'
import PlayerPlaylist, { PlayerPlaylistType } from '@/components/player/PlayerPlaylist.tsx'
import MiniProgressBar from "@/components/player/PlayerBar/components/MiniProgressBar.tsx"
import playerState from '@/store/player/state'
import { LIST_IDS } from '@/config/constant'

export default memo(({ componentId, isHome = false }: { isHome?: boolean }) => {
  const { keyboardShown } = useKeyboard()
  const theme = useTheme()
  const musicInfo = usePlayerMusicInfo()
  const longPressedRef = useRef(false)
  const playlistRef = useRef<PlayerPlaylistType>(null)
  const drawerLayoutPosition = useSettingValue('common.drawerLayoutPosition')
  const picOpacity = useSettingValue('theme.picOpacity')
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
    const currentComponentId = commonState.componentIds[commonState.componentIds.length - 1]?.id!
    navigations.pushPlayDetailScreen(currentComponentId)
  }

  const handleShowPlaylist = () => {
    playlistRef.current?.show()
  }

  useEffect(() => {
    global.app_event.on('showPlaylist', handleShowPlaylist)
    return () => {
      global.app_event.off('showPlaylist', handleShowPlaylist)
    }
  }, [])

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
      return (
        <View style={styles.wrapper}>
          <View style={styles.container} {...panResponder.panHandlers}>
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
    [theme, isHome, handleShowPlaylist, panResponder.panHandlers, drawerLayoutPosition],
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
    paddingHorizontal: 10,
    paddingBottom: 12,
    paddingTop: 4,
  },
  container: {
    width: '100%',
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    borderWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    shadowColor: 'rgba(0, 0, 0, 0.15)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
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
