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
  PicturesDirectoryPath,
  DownloadDirectoryPath,
  CachesDirectoryPath,
  exists as fsExists,
  mkdir as fsMkdir,
  moveFile,
  unlink as fsUnlink,
  readFile as fsReadFile,
} from 'react-native-fs'
import { copyFile as fsCopyFile, downloadFile as fsDownloadFile } from '@/utils/fs'

interface FetchResult {
  path: () => string
  base64: () => Promise<string>
}

interface FetchConfigOptions {
  path?: string
  headers?: Record<string, string>
}

const config = (opts: FetchConfigOptions = {}) => ({
  /**
   * 真实下载到 opts.path（未指定时落 Cache 目录）。
   *
   * 【2026-10-03 修复】此前这里是**占位实现**：不请求网络、不落盘，却直接 resolve ——
   * 于是「播放详情页长按封面 → 下载封面」与图片预览的「保存」全都提示成功，但磁盘/相册里
   * 什么都没有（用户实锤「下载封面无效」）。现在：
   *   - http(s)：走项目已有下载器（@/utils/fs 的 downloadFile，自带 UA 与 250ms 进度限流）
   *   - file:// 或本地路径：copyFile 直接复制
   * 目标路径已存在时先删除：iOS 侧下载器内部用 moveItemAtURL 落盘，目标存在会失败。
   */
  async fetch(_method: string, url: string): Promise<FetchResult> {
    const target = opts.path ?? `${CachesDirectoryPath}/rnfetchblob_${Date.now()}`
    await fsUnlink(target).catch(() => {})

    if (/^https?:/i.test(url)) {
      const { promise } = fsDownloadFile(url, target, { headers: opts.headers })
      const result = await promise
      if (result.statusCode >= 400) {
        await fsUnlink(target).catch(() => {})
        throw new Error(`HTTP ${result.statusCode}`)
      }
      return {
        path: () => target,
        base64: async() => fsReadFile(target, 'base64'),
      }
    }

    const source = url.startsWith('file://') ? decodeURIComponent(url.replace(/^file:\/\//, '')) : url
    await fsCopyFile(source, target)
    return {
      path: () => target,
      base64: async() => fsReadFile(target, 'base64'),
    }
  },
})

const fs = {
  dirs: {
    DocumentDir: DocumentDirectoryPath,
    MusicDir: DocumentDirectoryPath, // iOS 无独立 Music 目录，落到 Document
    PictureDir: PicturesDirectoryPath,
    DownloadDir: DownloadDirectoryPath,
    CacheDir: CachesDirectoryPath,
  },
  exists: async(p: string) => fsExists(p),
  mkdir: async(p: string) => fsMkdir(p),
  mv: async(from: string, to: string) => moveFile(from, to).then(() => undefined),
  unlink: async(p: string) => fsUnlink(p),
  // iOS 不需要媒体库扫描，no-op
  scanFile: async(_paths: Array<{ path: string }>) => Promise.resolve(),
}

const RNFetchBlob = {
  config,
  fs,
}

export default RNFetchBlob
