import { AppState, BackHandler, Dimensions, NativeEventEmitter, NativeModules, Platform } from 'react-native'

const { UtilsModule } = NativeModules
const isIOS = Platform.OS === 'ios'

// UtilsModule 在 iOS/Android 均有原生实现（见 ios/AppDelegate.mm）。
// 以下导出对 iOS 上不存在/不适用的方法做平台守卫，统一降级以避免调用 undefined。

// iOS 无 UtilsModule 原生实现，所有导出在 iOS 上安全降级，避免调用 undefined 崩溃。

export const exitApp = (): void => {
  // iOS 退出应用须走 RN 标准出口（BackHandler.exitApp 在 iOS 为 no-op，符合 App Store 规范）
  BackHandler.exitApp()
}

export const getSupportedAbis = isIOS
  ? (async (): Promise<string[]> => [])
  : (UtilsModule.getSupportedAbis as () => Promise<string[]>)

export const installApk = isIOS
  ? (_filePath: string, _fileProviderAuthority: string): void => {}
  : (filePath: string, fileProviderAuthority: string) =>
      UtilsModule.installApk(filePath, fileProviderAuthority)

export const screenkeepAwake = () => {
  if (global.lx.isScreenKeepAwake) return
  global.lx.isScreenKeepAwake = true
  // iOS/Android 均有 UtilsModule.screenkeepAwake 原生实现（iOS 用 idleTimerDisabled 保持常亮）
  UtilsModule.screenkeepAwake?.()
}
export const screenUnkeepAwake = () => {
  if (!global.lx.isScreenKeepAwake) return
  global.lx.isScreenKeepAwake = false
  UtilsModule.screenUnkeepAwake?.()
}

export const getWIFIIPV4Address = isIOS
  ? (async (): Promise<string> => '')
  : (UtilsModule.getWIFIIPV4Address as () => Promise<string>)

export const getDeviceName = async (): Promise<string> => {
  if (isIOS) return 'iPhone'
  return UtilsModule.getDeviceName().then((deviceName: string) => deviceName || 'Unknown')
}

export const isNotificationsEnabled = isIOS
  ? (async (): Promise<boolean> => true)
  : (UtilsModule.isNotificationsEnabled as () => Promise<boolean>)

export const requestNotificationPermission = async () =>
  new Promise<boolean>((resolve) => {
    if (isIOS) {
      // iOS 走系统标准通知授权，此处视为已授权（具体授权由系统弹窗处理）
      resolve(true)
      return
    }
    let subscription = AppState.addEventListener('change', (state) => {
      if (state != 'active') return
      subscription.remove()
      setTimeout(() => {
        void isNotificationsEnabled().then(resolve)
      }, 1000)
    })
    UtilsModule.openNotificationPermissionActivity().then((result: boolean) => {
      if (result) return
      subscription.remove()
      resolve(false)
    })
  })

export const shareText = async (shareTitle: string, title: string, text: string): Promise<void> => {
  if (isIOS) {
    // iOS 使用系统分享面板由调用方兜底（Alert），此处不调用不存在的原生模块
    return
  }
  UtilsModule.shareText(shareTitle, title, text)
}

export const getSystemLocales = async (): Promise<string> => {
  if (isIOS) {
    try {
      // RN 0.7x 提供 SettingsManager；旧版本回退到本地化
      const SettingsManager = (NativeModules as any).SettingsManager
      if (SettingsManager?.settings?.AppleLocale) return SettingsManager.settings.AppleLocale as string
      if (SettingsManager?.settings?.AppleLanguages?.[0]) return SettingsManager.settings.AppleLanguages[0] as string
    } catch {}
    return 'zh-CN'
  }
  return UtilsModule.getSystemLocales()
}

export const onScreenStateChange = (handler: (state: 'ON' | 'OFF') => void): (() => void) => {
  if (isIOS) return () => {}
  const eventEmitter = new NativeEventEmitter(UtilsModule)
  const eventListener = eventEmitter.addListener('screen-state', (event) => {
    handler(event.state as 'ON' | 'OFF')
  })

  return () => {
    eventListener.remove()
  }
}

export const getWindowSize = async (): Promise<{ width: number; height: number }> => {
  // iOS 未实现 UtilsModule.getWindowSize，回退到 Dimensions（返回逻辑像素的物理像素当量）
  if (Platform.OS !== 'android' || !UtilsModule?.getWindowSize) {
    const { width, height, scale } = Dimensions.get('window')
    return { width: width * scale, height: height * scale }
  }
  return UtilsModule.getWindowSize()
}

export const getCutoutLeftPx = async (): Promise<number> => {
  // 仅安卓有刘海（挖孔屏）偏移概念；iOS 使用安全区，无需额外偏移
  if (Platform.OS !== 'android' || !UtilsModule?.getCutoutLeftPx) return 0
  return UtilsModule.getCutoutLeftPx()
}

export const onWindowSizeChange = (
  handler: (size: { width: number; height: number }) => void
): (() => void) => {
  if (isIOS) return () => {}
  UtilsModule.listenWindowSizeChanged()

  const eventEmitter = new NativeEventEmitter(UtilsModule)
  const eventListener = eventEmitter.addListener('screen-size-changed', (event) => {
    handler(event as { width: number; height: number })
  })

  return () => {
    eventListener.remove()
  }
}

export const onRemoteCommand = (
  handler: (event: { command: string; position?: number }) => void
): (() => void) => {
  if (!isIOS) return () => {}
  // iOS：原生 UtilsModule 会监听 MPRemoteCommandCenter 并把命令通过 remote-command 事件转发给 JS
  const eventEmitter = new NativeEventEmitter(UtilsModule)
  const eventListener = eventEmitter.addListener('remote-command', (event) => {
    handler(event as { command: string; position?: number })
  })
  return () => {
    eventListener.remove()
  }
}

export const isIgnoringBatteryOptimization = async (): Promise<boolean> => {
  if (isIOS) return true
  return UtilsModule.isIgnoringBatteryOptimization()
}

export const requestIgnoreBatteryOptimization = async () =>
  new Promise<boolean>((resolve) => {
    if (isIOS) {
      resolve(true)
      return
    }
    let subscription = AppState.addEventListener('change', (state) => {
      if (state != 'active') return
      subscription.remove()
      setTimeout(() => {
        void isIgnoringBatteryOptimization().then(resolve)
      }, 1000)
    })
    UtilsModule.requestIgnoreBatteryOptimization().then((result: boolean) => {
      if (result) return
      subscription.remove()
      resolve(false)
    })
  })

// UI_MODE_TYPE_NORMAL = 1；iOS 无车机模式概念，直接返回普通模式
export const getUiMode = isIOS
  ? (async (): Promise<number> => 1)
  : (UtilsModule.getUiMode as () => Promise<number>)

export const adjustSystemMediaVolume = (direction: 'up' | 'down'): Promise<void> => {
  if (isIOS) return Promise.resolve() // iOS 音量由系统侧键控制，无原生接口
  return UtilsModule.adjustSystemMediaVolume(direction)
}

export const setScreenOrientation = (orientation: 'landscape' | 'portrait' | 'auto'): void => {
  // iOS 无 UtilsModule.setScreenOrientation，横屏锁定由 RNN 的 layout.orientation 配置处理
  if (isIOS) return
  UtilsModule.setScreenOrientation(orientation)
}

// 锁屏/后台切歌：iOS 在音频停止后会很快挂起 App（Info.plist 的 UIBackgroundModes 仅 audio），
// 「获取下一首播放链接」的网络请求会被冻结，播放器就卡在暂停态不再跳歌。
// 切歌期间申请 UIApplication 的后台任务，为 JS 争取一段额外的后台执行时间。
// 同时只允许持有一个任务：连续切歌时复用，避免重复申请把系统给的预算耗光。
let backgroundTaskId: number | null = null

export const beginBackgroundTask = async (): Promise<void> => {
  if (!isIOS || !UtilsModule?.beginBackgroundTask) return
  if (backgroundTaskId != null) return
  try {
    const taskId = await (UtilsModule.beginBackgroundTask as () => Promise<number>)()
    // UIBackgroundTaskInvalid == 0，表示系统本次未分配后台时间
    if (typeof taskId == 'number' && taskId > 0) backgroundTaskId = taskId
  } catch {}
}

export const endBackgroundTask = (): void => {
  if (!isIOS || !UtilsModule?.endBackgroundTask) return
  if (backgroundTaskId == null) return
  const taskId = backgroundTaskId
  backgroundTaskId = null
  try {
    UtilsModule.endBackgroundTask(taskId)
  } catch {}
}
