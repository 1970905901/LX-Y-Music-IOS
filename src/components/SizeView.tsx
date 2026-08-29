import { memo, useCallback, useRef, useEffect } from 'react'
import { type LayoutChangeEvent, StyleSheet, View, StatusBar, Dimensions, NativeModules, Platform } from 'react-native'
import commonState from '@/store/common/state'
import { setStatusbarHeight } from '@/core/common'
import { windowSizeTools, getWindowSize } from '@/utils/windowSizeTools'

// iOS 没有 StatusBar.currentHeight（恒为 undefined），且顶部刘海/状态栏是物理存在、
// 必须预留的空间。
// 这里用 NativeModules.StatusBarManager.getHeight 获取真实状态栏高度（异步），
// 同步先用兜底值，拿到真实值后再校准一次。
const IOS_STATUSBAR_HEIGHT_FALLBACK = 44
let iosStatusbarHeight = IOS_STATUSBAR_HEIGHT_FALLBACK
const StatusBarManager = NativeModules.StatusBarManager
function syncIosStatusbarHeight() {
  if (Platform.OS !== 'ios' || !StatusBarManager?.getHeight) return
  StatusBarManager.getHeight(({ height }: { height: number }) => {
    const h = height > 0 ? height : IOS_STATUSBAR_HEIGHT_FALLBACK
    if (h !== iosStatusbarHeight) {
      iosStatusbarHeight = h
      setStatusbarHeight(iosStatusbarHeight)
    }
  })
}

const getStatusbarHeight = (winHeight: number, layoutHeight: number) => {
  // iOS：始终返回真实状态栏高度
  if (Platform.OS === 'ios') return iosStatusbarHeight
  // Android：动态判断是否需要为系统状态栏保留间距
  const height =
    parseFloat(winHeight.toFixed(2)) >= parseFloat(layoutHeight.toFixed(2))
      ? 0
      : (StatusBar.currentHeight ?? 0)

  return height
}

export default memo(
  () => {
    const currentHeightRef = useRef(commonState.statusbarHeight)
    const dimensionsChangedRef = useRef(true)
    const handleLayout = useCallback(
      ({
        nativeEvent: { layout },
      }: LayoutChangeEvent | { nativeEvent: { layout: { width: number; height: number } } }) => {
        // console.log('handleLayout')
        if (!dimensionsChangedRef.current) return
        void getWindowSize().then((size) => {
          dimensionsChangedRef.current = false
          // console.log(layout, size)
          const height = getStatusbarHeight(size.height, layout.height)

          if (currentHeightRef.current != height) {
            currentHeightRef.current = height
            setStatusbarHeight(height)
          }
          // iOS 状态栏高度需异步校准（StatusBarManager 首次可能为 0），拿到真实值后再更新一次
          if (Platform.OS === 'ios') syncIosStatusbarHeight()
          // console.log(layout, size)
          const currentSize = windowSizeTools.getSize()
          if (currentSize.width != layout.width || currentSize.height != layout.height) {
            windowSizeTools.setWindowSize(layout.width, layout.height)
          }
        })
      },
      []
    )
    useEffect(() => {
      // iOS 首次进入主动校准一次状态栏高度（StatusBarManager 异步）
      if (Platform.OS === 'ios') syncIosStatusbarHeight()
      // let timeout: NodeJS.Timeout | null = null
      const subscription = Dimensions.addEventListener('change', () => {
        dimensionsChangedRef.current = true
        // if (timeout) clearTimeout(timeout)
        // timeout = setTimeout(() => {
        //   timeout = null
        //   viewRef.current?.measureInWindow((x, y, width, height) => {
        //     handleLayout({ nativeEvent: { layout: { width, height } } })
        //   })
        // }, 100)
      })

      return () => {
        subscription.remove()
      }
    }, [])
    return <View style={StyleSheet.absoluteFill} onLayout={handleLayout} />
  },
  () => true
)
