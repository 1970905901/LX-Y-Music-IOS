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
  ? async(): Promise<string[]> => []
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
  ? async(): Promise<string> => ''
  : (UtilsModule.getWIFIIPV4Address as () => Promise<string>)

export const getDeviceName = async(): Promise<string> => {
  if (isIOS) return 'iPhone'
  return UtilsModule.getDeviceName().then((deviceName: string) => deviceName || 'Unknown')
}

/**
 * 当前安装包的版本号（iOS 取 CFBundleShortVersionString，CI 构建时按日期注入，如 20260926）。
 * package.json 里的 version 只是打包时的快照，可能与实际安装的包不一致，
 * 所以「关于」页展示版本号必须走这里从运行中的主包读取；原生不可用时返回空串，由调用方回退。
 */
export const getVersionInfo = async(): Promise<string> => {
  try {
    if (isIOS && typeof UtilsModule.getVersionInfo == 'function') {
      const version = await (UtilsModule.getVersionInfo() as Promise<string>)
      return version || ''
    }
  } catch {}
  return ''
}

export const isNotificationsEnabled = isIOS
  ? async(): Promise<boolean> => true
  : (UtilsModule.isNotificationsEnabled as () => Promise<boolean>)

export const requestNotificationPermission = async() =>
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

export const shareText = async(shareTitle: string, title: string, text: string): Promise<void> => {
  if (isIOS) {
    // iOS 使用系统分享面板由调用方兜底（Alert），此处不调用不存在的原生模块
    return
  }
  UtilsModule.shareText(shareTitle, title, text)
}

export const getSystemLocales = async(): Promise<string> => {
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

export const getWindowSize = async(): Promise<{ width: number, height: number }> => {
  // iOS 未实现 UtilsModule.getWindowSize，回退到 Dimensions（返回逻辑像素的物理像素当量）
  if (Platform.OS !== 'android' || !UtilsModule?.getWindowSize) {
    const { width, height, scale } = Dimensions.get('window')
    return { width: width * scale, height: height * scale }
  }
  return UtilsModule.getWindowSize()
}

export const getCutoutLeftPx = async(): Promise<number> => {
  // 仅安卓有刘海（挖孔屏）偏移概念；iOS 使用安全区，无需额外偏移
  if (Platform.OS !== 'android' || !UtilsModule?.getCutoutLeftPx) return 0
  return UtilsModule.getCutoutLeftPx()
}

export const onWindowSizeChange = (
  handler: (size: { width: number, height: number }) => void,
): (() => void) => {
  if (isIOS) return () => {}
  UtilsModule.listenWindowSizeChanged()

  const eventEmitter = new NativeEventEmitter(UtilsModule)
  const eventListener = eventEmitter.addListener('screen-size-changed', (event) => {
    handler(event as { width: number, height: number })
  })

  return () => {
    eventListener.remove()
  }
}

export const onRemoteCommand = (
  handler: (event: { command: string, position?: number }) => void,
): (() => void) => {
  if (!isIOS) return () => {}
  // iOS：原生 UtilsModule 会监听 MPRemoteCommandCenter 并把命令通过 remote-command 事件转发给 JS
  const eventEmitter = new NativeEventEmitter(UtilsModule)
  const eventListener = eventEmitter.addListener('remote-command', (event) => {
    handler(event as { command: string, position?: number })
  })
  return () => {
    eventListener.remove()
  }
}

export const onHeadphonesDisconnected = (handler: () => void): (() => void) => {
  // iOS：原生 AppDelegate 监听 AVAudioSessionRouteChange，耳机拔出时转发
  // headphones-disconnected 事件。参考 Q-1515/lx-music-mobile ios-adaptation，
  // 播放器侧据此自动暂停。原生未就绪时安全降级为空订阅。
  if (!UtilsModule) return () => {}
  const eventEmitter = new NativeEventEmitter(UtilsModule)
  const eventListener = eventEmitter.addListener('headphones-disconnected', () => {
    handler()
  })
  return () => {
    eventListener.remove()
  }
}

export const isIgnoringBatteryOptimization = async(): Promise<boolean> => {
  if (isIOS) return true
  return UtilsModule.isIgnoringBatteryOptimization()
}

export const requestIgnoreBatteryOptimization = async() =>
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
  ? async(): Promise<number> => 1
  : (UtilsModule.getUiMode as () => Promise<number>)

export const adjustSystemMediaVolume = async(direction: 'up' | 'down'): Promise<void> => {
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

export const beginBackgroundTask = async(): Promise<void> => {
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

const blurredPicCacheKey = (uri: string, blurRadius: number) => `${uri}|${blurRadius}`

interface BlurredPicCacheEntry {
  /** 已模糊背景图本地地址；空串表示“平均色已到、地址还没到” */
  path: string
  /** 背景图平均色（#RRGGBB）；null 表示尚未取到 */
  color: string | null
}

// 已解析的模糊图地址 / 平均色，按「地址 + 半径」记在内存里。
// 原生落盘缓存只解决“不用重复模糊”，但页面每次挂载都要等一次异步桥调用才拿到地址，
// 这 1~2 帧里页面画不出背景（浅色主题是纯白）= 进页面「闪一下白色」。
// 记在内存后，同一张背景图（Home 与详情页共用同一个动态背景）第二次挂载即可【同步】拿到地址：
// 首帧直接画本地图，push 转场也能用平均色作容器背景色（见 navigation 的 getPushBackgroundColor）。
// 缓存文件被「清理缓存」删除时由图片 onError → invalidate 作废，不会留下空白底。
// 背景图随歌曲变化，这里只保留最近若干条（原生侧留 6 张，JS 侧留多一些覆盖最近听过的歌），
// 避免长时间播放让缓存无上限增长；被淘汰的条目最多让下次挂载多一次桥调用。
const MAX_BLURRED_PIC_CACHE = 16
const blurredPicCache = new Map<string, BlurredPicCacheEntry>()
const blurredPicPending = new Map<string, Promise<string | null>>()
const blurredPicColorPending = new Map<string, Promise<string | null>>()

const rememberBlurredPic = (cacheKey: string, patch: { path?: string, color?: string }) => {
  const entry = blurredPicCache.get(cacheKey)
  // 先删再插：让它成为“最新”的一条（Map 按插入顺序迭代，淘汰时取最旧的 key）
  if (entry) blurredPicCache.delete(cacheKey)
  blurredPicCache.set(cacheKey, entry
    ? { path: patch.path ?? entry.path, color: patch.color ?? entry.color }
    : { path: patch.path ?? '', color: patch.color ?? null })
  while (blurredPicCache.size > MAX_BLURRED_PIC_CACHE) {
    const oldest = blurredPicCache.keys().next()
    if (oldest.done) break
    blurredPicCache.delete(oldest.value)
  }
}

/** 同步读取已知的「已模糊背景图」本地地址；尚未解析过 / 不可用时返回 null。 */
export const getCachedBlurredPic = (uri: string | null | undefined, blurRadius: number): string | null => {
  // 纯读取 JS 内存缓存，不要求原生方法就绪（原生不可用时缓存里也不会有值）
  if (!uri || blurRadius <= 0) return null
  return blurredPicCache.get(blurredPicCacheKey(uri, blurRadius))?.path || null
}

/**
 * 同步读取已知的「已模糊背景图平均色」（#RRGGBB）；尚未解析过 / 不可用时返回 null。
 * 用途：push 转场背景色与页面首帧底色——转场期间页面内容还没画出来，容器只有一块纯色，
 * 纯白（浅色主题）与整屏模糊封面的实际背景色差明显就是「转场闪白」，用平均色代替即可消除。
 */
export const getCachedBgPicColor = (uri: string | null | undefined, blurRadius: number): string | null => {
  if (!isIOS || !uri || blurRadius <= 0) return null
  return blurredPicCache.get(blurredPicCacheKey(uri, blurRadius))?.color ?? null
}

/** 作废某张背景图的本地记录（缓存文件被删除、图片加载失败时调用），下次挂载会重新向原生索取。 */
export const invalidateBlurredPic = (uri: string | null | undefined, blurRadius: number): void => {
  if (!uri || blurRadius <= 0) return
  blurredPicCache.delete(blurredPicCacheKey(uri, blurRadius))
}

/**
 * 取「已模糊的背景图」本地地址（file://...）。
 * 背景（动态背景 = 整屏封面 / 自定义背景图）原先由 Image 的 blurRadius 在每次挂载时重算，
 * 整屏图解码 + 模糊要几十毫秒，这段时间页面只有底色（浅色主题是纯白）= 进入页面「闪一下白色」。
 * 原生按 地址 + 半径 把模糊结果缓存到 Caches/lx_bg_blur（模糊算法与 RN 的 blurRadius 完全一致，
 * 观感不变），页面改用本地文件后首帧即可绘制。
 * 失败 / 原生未就绪 / 超时一律返回 null，调用方回退到 Image 的 blurRadius，不影响可用性。
 */
export const getBlurredPic = async(uri: string, blurRadius: number): Promise<string | null> => {
  if (!isIOS || !UtilsModule?.getBlurredPic || !uri || blurRadius <= 0) return null
  const cacheKey = blurredPicCacheKey(uri, blurRadius)
  const cached = blurredPicCache.get(cacheKey)?.path
  if (cached) return cached
  // 同一张背景图可能被多个页面同时请求（Home + 详情页…），这里按 地址 + 半径 复用同一个
  // 在途 Promise，避免原生侧重复做整屏解码/模糊（内存与耗时的双重浪费）。
  const pending = blurredPicPending.get(cacheKey)
  if (pending) return pending
  const task = (async(): Promise<string | null> => {
    try {
      const result = await Promise.race([
        UtilsModule.getBlurredPic(uri, blurRadius) as Promise<string | null>,
        // 原生兜底超时：即使原生侧意外没有回调，也不让调用方一直等（超时后原生仍会继续写完缓存）
        new Promise<null>((resolve) => { setTimeout(() => { resolve(null) }, 8000) }),
      ])
      const path = typeof result == 'string' && result.length > 0 ? result : null
      if (path) rememberBlurredPic(cacheKey, { path })
      return path
    } catch {
      return null
    }
  })()
  blurredPicPending.set(cacheKey, task)
  // 在途记录只用于合并“同时挂载”的多次请求；已拿到的地址会长期留在内存缓存里，
  // 供后续页面挂载时同步取用（首帧即可绘制，不再有等待桥调用的空白帧）。
  void task.finally(() => { blurredPicPending.delete(cacheKey) })
  return task
}

/**
 * 取「已模糊背景图」的平均色（#RRGGBB），用于 push 转场背景色与页面首帧底色。
 * 调用时机有要求：必须在 getBlurredPic 已返回地址之后调用——原生侧模糊图（及同名色值文件）
 * 生成后才有色值可取，顺序反了会拿到 null 且不会自动重试。
 * 取不到（原生未就绪 / 计算失败）返回 null，调用方退回主题纯色，不影响可用性。
 */
export const getBgPicColor = async(uri: string, blurRadius: number): Promise<string | null> => {
  if (!isIOS || !UtilsModule?.getBgPicColor || !uri || blurRadius <= 0) return null
  const cacheKey = blurredPicCacheKey(uri, blurRadius)
  const cached = blurredPicCache.get(cacheKey)?.color
  if (cached) return cached
  const pending = blurredPicColorPending.get(cacheKey)
  if (pending) return pending
  const task = (async(): Promise<string | null> => {
    try {
      const result = await Promise.race([
        UtilsModule.getBgPicColor(uri, blurRadius) as Promise<string | null>,
        new Promise<null>((resolve) => { setTimeout(() => { resolve(null) }, 8000) }),
      ])
      const color = typeof result == 'string' && result.length > 0 ? result : null
      // 只记成功结果：null 表示“暂时取不到”（如模糊图还没生成），下次调用应当重试。
      if (color) rememberBlurredPic(cacheKey, { color })
      return color
    } catch {
      return null
    }
  })()
  blurredPicColorPending.set(cacheKey, task)
  void task.finally(() => { blurredPicColorPending.delete(cacheKey) })
  return task
}

export interface SafeAreaInsets {
  top: number
  bottom: number
  left: number
  right: number
}

const ZERO_INSETS: SafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 }

/**
 * 获取系统安全区 insets（单位 pt）。
 * 底部弹层/列表据此补 paddingBottom，避免最后一行被 Home 指示器
 * （刘海/灵动岛机型底部约 34pt，横屏约 21pt，iPad 约 20pt）遮挡。
 * iOS 原生实现见 AppDelegate.mm 的 UtilsModule.getSafeAreaInsets。
 * 仅在 iOS 有实现，其他平台安全降级为全 0。
 */
export const getSafeAreaInsets = async(): Promise<SafeAreaInsets> => {
  // 每次返回新对象，避免调用方误改共享常量影响后续调用
  if (!isIOS || !UtilsModule?.getSafeAreaInsets) return { ...ZERO_INSETS }
  try {
    const insets = await (UtilsModule.getSafeAreaInsets as () => Promise<SafeAreaInsets>)()
    return {
      top: Number(insets?.top) || 0,
      bottom: Number(insets?.bottom) || 0,
      left: Number(insets?.left) || 0,
      right: Number(insets?.right) || 0,
    }
  } catch {
    // 原生未就绪（如首帧 window 尚未创建）时降级为 0，避免面板首帧抖动
    return { ...ZERO_INSETS }
  }
}
