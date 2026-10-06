import { memo, useCallback, useRef, useEffect } from 'react'
import { type LayoutChangeEvent, StyleSheet, View, StatusBar, NativeModules, Platform, Dimensions } from 'react-native'
import commonState from '@/store/common/state'
import { setStatusbarHeight, setSafeAreaTop, setSafeAreaBottom } from '@/core/common'
import { windowSizeTools, getWindowSize } from '@/utils/windowSizeTools'
import { getSafeAreaInsets } from '@/utils/nativeModules/utils'

// iOS 没有 StatusBar.currentHeight（恒为 undefined），且顶部刘海/状态栏是物理存在、
// 必须预留的空间。
// 这里用 NativeModules.StatusBarManager.getHeight 获取真实状态栏高度（异步），
// 同步先用兜底值，拿到真实值后再校准一次。
const IOS_STATUSBAR_HEIGHT_FALLBACK = 44
let iosStatusbarHeight = IOS_STATUSBAR_HEIGHT_FALLBACK
// 原生回调是否已写入过真实值：基线变量初始值恰好等于部分机型（iPhone X~14 系列）
// 的真实高度 44，若仅用「值不同」判断，这些机型第一次回调会被短路，真实高度永远
// 不写入 state（statusbarHeight 恒 0），所有 PageTopInset/useStatusbarHeight 页面
// 顶部贴状态栏（用户反馈的「返回按钮位置固定偏高、贴着状态栏」）。
let iosStatusbarSynced = false
const StatusBarManager = NativeModules.StatusBarManager
function syncIosStatusbarHeight() {
  if (Platform.OS !== 'ios' || !StatusBarManager?.getHeight) return
  StatusBarManager.getHeight(({ height }: { height: number }) => {
    const h = height > 0 ? height : IOS_STATUSBAR_HEIGHT_FALLBACK
    if (!iosStatusbarSynced || h !== iosStatusbarHeight) {
      iosStatusbarSynced = true
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
    const currentSafeAreaTopRef = useRef(commonState.safeAreaTop)
    const currentSafeAreaBottomRef = useRef(commonState.safeAreaBottom)

    // 安全区（顶部刘海/灵动岛、底部 Home 指示器）高度随机型与方向变化：
    // iPhone 顶部 44~62pt / 底部 34pt，全面屏 iPad 底部约 20pt，带 Home 键的 iPad 底部为 0。
    // iPhone 系统层面仅支持竖屏（Info.plist 只声明 Portrait），iPad 支持竖屏 + 左右横屏，
    // 因此旋转会改变窗口尺寸。这里在每次尺寸变化时重新向原生侧取一次，
    // 避免旋转后底部弹层、固定页头沿用旧值。
    //
    // 顶部值（safeAreaTop）供「固定页头」补系统安全区用：列表（ScrollView/FlatList）
    // 由 RN 自动叠加这份插图，页头不在列表里时拿不到，必须自己补（见 PageTopInset）。
    const syncSafeAreaInsets = useCallback(() => {
      void getSafeAreaInsets().then(({ top, bottom }) => {
        if (currentSafeAreaTopRef.current != top) {
          currentSafeAreaTopRef.current = top
          setSafeAreaTop(top)
        }
        if (currentSafeAreaBottomRef.current != bottom) {
          currentSafeAreaBottomRef.current = bottom
          setSafeAreaBottom(bottom)
        }
      })
    }, [])

    const handleLayout = useCallback(
      ({
        nativeEvent: { layout },
      }: LayoutChangeEvent | { nativeEvent: { layout: { width: number, height: number } } }) => {
        // 窗口尺寸变化（含 iPad 旋转 / 分屏）会触发 onLayout。
        // 这里不再依赖 Dimensions 'change' 事件（该事件在 iPad 旋转 / 分屏下可能不触发，
        // 会导致窗口尺寸不更新、横竖屏布局残留），改为每次 onLayout 都直接同步更新尺寸。
        const currentSize = windowSizeTools.getSize()
        if (currentSize.width != layout.width || currentSize.height != layout.height) {
          windowSizeTools.setWindowSize(layout.width, layout.height)
        }
        // 状态栏高度需异步校准（依赖原生返回的物理像素高度）
        void getWindowSize().then((size) => {
          const height = getStatusbarHeight(size.height, layout.height)

          if (currentHeightRef.current != height) {
            currentHeightRef.current = height
            setStatusbarHeight(height)
          }
          // iOS 状态栏高度需异步校准（StatusBarManager 首次可能为 0），拿到真实值后再更新一次
          if (Platform.OS === 'ios') syncIosStatusbarHeight()
        })
        syncSafeAreaInsets()
      },
      [syncSafeAreaInsets],
    )
    useEffect(() => {
      // iOS 首次进入主动校准一次状态栏高度（StatusBarManager 异步）
      if (Platform.OS === 'ios') syncIosStatusbarHeight()
      // 首帧同步一次安全区，供底部弹层 / 列表 / 固定页头避让系统 UI
      syncSafeAreaInsets()

      // 兜底：Modal/Dialog 覆盖期间设备旋转或分屏时，底层 SizeView 的 onLayout 可能不触发，
      // 导致 windowSizeTools.size 停留在旧尺寸、横屏被卡成竖屏 sidebar。用 Dimensions 事件再同步一次。
      const sub = Dimensions.addEventListener('change', () => {
        void getWindowSize().then((size) => {
          if (!size.width) return
          windowSizeTools.setWindowSize(size.width, size.height)
        })
      })
      return () => { sub?.remove() }
    }, [syncSafeAreaInsets])
    return <View style={StyleSheet.absoluteFill} onLayout={handleLayout} />
  },
  () => true,
)
