import { NativeModules, Platform } from 'react-native'

const { CacheModule } = NativeModules
const isIOS = Platform.OS === 'ios'

// iOS 无 CacheModule 原生实现（缓存清理由 JS 层 react-native-fs 处理），安全降级。
export const getAppCacheSize = async (): Promise<number> => {
  if (isIOS || !CacheModule) return 0
  return CacheModule.getAppCacheSize().then((size: number) => Math.trunc(size))
}
export const clearAppCache = isIOS || !CacheModule
  ? (): Promise<void> => Promise.resolve()
  : (CacheModule.clearAppCache as () => Promise<void>)
