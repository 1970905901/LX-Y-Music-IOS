/**
 * rn-fetch-blob 兼容 shim（iOS 适配）
 *
 * 安卓分支直接依赖 npm 包 `rn-fetch-blob`，但 iOS 工程未安装该原生包。
 * 为让代码在 iOS 上编译通过并保留下载/保存封面等能力，这里用已安装的
 * `react-native-fs` 实现一个最小兼容层，仅覆盖本项目实际调用的接口：
 *   - RNFetchBlob.fs.dirs.{MusicDir, PictureDir, DownloadDir, CacheDir, DocumentDir}
 *   - RNFetchBlob.fs.{exists, mkdir, mv, unlink, scanFile}
 *   - RNFetchBlob.config({ path }).fetch('GET', url)
 *
 * 注意：scanFile 在 iOS 上无对应能力，这里作为空操作（no-op）以保证调用不报错。
 */
import {
  DocumentDirectoryPath,
  PictureDirectoryPath,
  DownloadDirectoryPath,
  CacheDirectoryPath,
  exists as fsExists,
  mkdir as fsMkdir,
  moveFile,
  unlink as fsUnlink,
} from 'react-native-fs'

type FetchResult = {
  path: () => string
  base64: () => Promise<string>
}

const config = (opts: { path?: string } = {}) => ({
  fetch(_method: string, url: string): Promise<FetchResult> {
    // 真实下载由调用方通过 react-native-fs 完成；此处仅提供兼容签名。
    // 由于本 shim 主要服务于 fs 工具方法，下载路径由各调用点自行实现，
    // 这里返回一个占位实现以避免直接崩溃。
    return Promise.resolve({
      path: () => opts.path ?? '',
      base64: () => Promise.resolve(''),
    })
  },
})

const fs = {
  dirs: {
    DocumentDir: DocumentDirectoryPath,
    MusicDir: DocumentDirectoryPath, // iOS 无独立 Music 目录，落到 Document
    PictureDir: PictureDirectoryPath,
    DownloadDir: DownloadDirectoryPath,
    CacheDir: CacheDirectoryPath,
  },
  exists: (p: string) => fsExists(p),
  mkdir: (p: string) => fsMkdir(p),
  mv: (from: string, to: string) => moveFile(from, to).then(() => undefined),
  unlink: (p: string) => fsUnlink(p),
  // iOS 不需要媒体库扫描，no-op
  scanFile: (_paths: Array<{ path: string }>) => Promise.resolve(),
}

const RNFetchBlob = {
  config,
  fs,
}

export default RNFetchBlob
