import { NativeModules, Platform } from 'react-native'
import { readDir, unlink, existsFile, temporaryDirectoryPath } from '@/utils/fs'

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

// 云盘播放缓存目录（位于 Caches，可被系统回收，不参与 iCloud 备份）。
// 与 getWebDAVPrivateDirectory（Documents，用户手动下载）区分开。
const cloudCacheDirs = [
  `${temporaryDirectoryPath}/BaiduPan`,
  `${temporaryDirectoryPath}/WebDAV/music`,
  `${temporaryDirectoryPath}/WebDAV/covers`,
]

// 递归统计目录大小（字节）
const getDirSizeRecursively = async (dir: string): Promise<number> => {
  if (!(await existsFile(dir))) return 0
  let total = 0
  try {
    const list = await readDir(dir)
    for (const item of list) {
      if (item.isDirectory) total += await getDirSizeRecursively(item.path)
      else total += item.size
    }
  } catch {}
  return total
}

// 递归清理目录内容（保留目录本身）
const clearDirRecursively = async (dir: string) => {
  if (!(await existsFile(dir))) return
  try {
    const list = await readDir(dir)
    for (const item of list) {
      await unlink(item.path).catch(() => {})
    }
  } catch {}
}

// 统计云盘播放缓存（百度网盘 / WebDAV 的流式播放预下载缓存）
export const getCloudCacheSize = async (): Promise<number> => {
  let total = 0
  for (const dir of cloudCacheDirs) {
    total += await getDirSizeRecursively(dir)
  }
  return total
}

// 清理云盘播放缓存
export const clearCloudCache = async () => {
  for (const dir of cloudCacheDirs) {
    await clearDirRecursively(dir)
  }
}

interface CloudCacheFile {
  path: string
  size: number
  lastModified: number
}

// 递归收集云盘缓存文件（含 lastModified，用于 LRU 清理）
const collectCloudCacheFiles = async (dir: string, files: CloudCacheFile[] = []): Promise<CloudCacheFile[]> => {
  if (!(await existsFile(dir))) return files
  try {
    const list = await readDir(dir)
    for (const item of list) {
      if (item.isDirectory) {
        await collectCloudCacheFiles(item.path, files)
      } else {
        files.push({ path: item.path, size: item.size, lastModified: item.lastModified })
      }
    }
  } catch {}
  return files
}

// 按缓存大小上限清理云盘缓存（LRU：删除最旧的文件，直到总大小 <= limitBytes）。
// limitBytes 为字节数，<= 0 表示不限制。
export const enforceCloudCacheLimit = async (limitBytes: number) => {
  if (limitBytes <= 0) return
  const files: CloudCacheFile[] = []
  for (const dir of cloudCacheDirs) {
    await collectCloudCacheFiles(dir, files)
  }
  let total = files.reduce((sum, f) => sum + f.size, 0)
  if (total <= limitBytes) return
  // 最旧在前，优先删除最久未使用的缓存
  files.sort((a, b) => a.lastModified - b.lastModified)
  for (const file of files) {
    if (total <= limitBytes) break
    await unlink(file.path).catch(() => {})
    total -= file.size
  }
}
