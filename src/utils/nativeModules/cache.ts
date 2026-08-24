import { NativeModules, Platform } from 'react-native'

const { CacheModule } = NativeModules
const isIOS = Platform.OS === 'ios'

// CacheModule 在 iOS/Android 均有原生实现（iOS 遍历 Caches/Tmp 目录）。
// 以下导出对缺失情况做兜底降级。
export const getAppCacheSize = async (): Promise<number> => {
  if (isIOS || !CacheModule) return 0
  return CacheModule.getAppCacheSize().then((size: number) => Math.trunc(size))
}
export const clearAppCache = isIOS || !CacheModule
  ? (): Promise<void> => Promise.resolve()
  : (CacheModule.clearAppCache as () => Promise<void>)
