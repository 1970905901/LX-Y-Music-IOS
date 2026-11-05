import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Animated, Pressable, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'

import { type COMPONENT_IDS } from '@/config/constant'

interface Props {
  visibleNavNames: COMPONENT_IDS[]
  widthPercentage: number
  widthPercentageMax?: number
  children: React.ReactNode
  renderNavigationView: () => React.ReactNode
  drawerPosition?: 'left' | 'right'
  drawerBackgroundColor?: string
  style?: StyleProp<ViewStyle>
}

export interface DrawerLayoutFixedType {
  openDrawer: () => void
  closeDrawer: () => void
  fixWidth: () => void
}

const DrawerLayoutFixed = forwardRef<DrawerLayoutFixedType, Props>(({
  widthPercentage,
  widthPercentageMax,
  children,
  renderNavigationView,
  drawerPosition = 'left',
  drawerBackgroundColor,
  style,
}, ref) => {
  const [containerWidth, setContainerWidth] = useState(0)
  const [visible, setVisible] = useState(false)
  // 动画期间把侧边栏内容光栅化成位图，避免滑入/滑出时逐帧重新合成
  // 复杂的歌单卡片列表（封面图 + 文本），显著降低 GPU 合成开销、提升帧率。
  const [rasterize, setRasterize] = useState(false)
  const animation = useRef(new Animated.Value(0)).current

  const drawerWidth = useMemo(() => {
    if (!containerWidth) return 0
    const width = Math.floor(containerWidth * widthPercentage)
    return widthPercentageMax ? Math.min(width, widthPercentageMax) : width
  }, [containerWidth, widthPercentage, widthPercentageMax])

  // 抽屉开合会锁 Home 列表滚动。历史坑（2026-10 审计）：旧实现在 closeDrawer 的
  // 动画回调里无条件恢复滚动，但回调在动画被打断时同样会执行 —— 若此时又点开了抽屉，
  // 滚动锁被提前解开（可见抽屉背后的列表能滑动）；反过来动画被打断没执行回调时，
  // 锁会永久保持（关掉抽屉后首页滑不动）。用「目标开合状态」判定，而不是回调时机。
  const openRef = useRef(false)
  const setHomeScrollEnabled = (enabled: boolean) => {
    global.app_event.changeHomePageScrollEnabled?.(enabled)
  }

  const openDrawer = useCallback(() => {
    if (!drawerWidth) return
    openRef.current = true
    setVisible(true)
    setRasterize(true)
    setHomeScrollEnabled(false)
    Animated.timing(animation, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setRasterize(false)
    })
  }, [animation, drawerWidth])

  const closeDrawer = useCallback(() => {
    openRef.current = false
    setRasterize(true)
    Animated.timing(animation, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      // 期间又被打开：保持可见、保持滚动锁，由那次 openDrawer 收尾
      if (openRef.current) return
      if (finished) setVisible(false)
      setRasterize(false)
      setHomeScrollEnabled(true)
    })
  }, [animation])

  // 卸载（切页 / 组件销毁）时必须解锁：否则首页列表会一直滑不动
  useEffect(() => {
    return () => {
      if (openRef.current) setHomeScrollEnabled(true)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    openDrawer,
    closeDrawer,
    fixWidth() {},
  }), [closeDrawer, openDrawer])

  const handleLayout = useCallback(({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    setContainerWidth(layout.width)
  }, [])

  const drawerTranslate = animation.interpolate({
    inputRange: [0, 1],
    outputRange: drawerPosition == 'left' ? [-drawerWidth, 0] : [drawerWidth, 0],
  })
  const overlayOpacity = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.32],
  })

  return (
    <View onLayout={handleLayout} style={[{ flex: 1, width: '100%', overflow: 'hidden' }, style]}>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        {children}
      </View>
      {
        drawerWidth
          ? (
              <View
                pointerEvents={visible ? 'auto' : 'box-none'}
                style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
              >
                <Animated.View
                  pointerEvents={visible ? 'auto' : 'none'}
                  style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: overlayOpacity }}
                >
                  <Pressable onPress={closeDrawer} style={{ flex: 1, backgroundColor: '#000' }} />
                </Animated.View>
                <Animated.View
                  pointerEvents={visible ? 'auto' : 'none'}
                  shouldRasterizeIOS={rasterize}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    width: drawerWidth,
                    backgroundColor: drawerBackgroundColor,
                    transform: [{ translateX: drawerTranslate }],
                    left: drawerPosition == 'left' ? 0 : undefined,
                    right: drawerPosition == 'right' ? 0 : undefined,
                  }}
                >
                  {renderNavigationView()}
                </Animated.View>
              </View>
            )
          : null
      }
    </View>
  )
})

export default DrawerLayoutFixed
