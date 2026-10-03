import RNFetchBlob from '@/utils/rnFetchBlob'
import { getFileExtensionFromUrl } from '@/screens/Home/Views/Mylist/MusicList/download/utils'
import { saveImageToPhotosLibrary } from '@/utils/nativeModules/utils'
import { defaultHeaders } from '@/components/common/Image'

const sanitizeFileName = (name: string) =>
  (name.trim() || 'image').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)

/**
 * 保存图片到系统相册（iOS）。
 *
 * 【2026-10-03 修复】此前实现把图写进 App 沙盒的 Pictures 目录、再 toast 出沙盒路径 ——
 * 沙盒目录用户与「文件」App 都看不到，相册里更没有，功能等于无效（与播放详情页
 * 「下载封面无效」同源）。现在：下载到 Cache 临时文件 → 写进系统相册
 * （原生 PHPhotoLibrary「仅新增」权限，见 Info.plist 的 NSPhotoLibraryAddUsageDescription）
 * → 删除临时文件。
 *
 * @param url 远程 http(s) 地址，或本地路径 / file:// URL（本地时 shim 内部走 copyFile）
 * @returns 写入相册成功返回 true（失败抛错，由调用方 toast）
 */
export const saveImageToPictures = async(url: string, name: string = 'image') => {
  if (!url) throw new Error('图片地址为空')

  const extension = getFileExtensionFromUrl(url) || 'jpg'
  const fileName = `${sanitizeFileName(name)}.${extension}`
  const tempPath = `${RNFetchBlob.fs.dirs.CacheDir}/${Date.now()}_${fileName}`

  try {
    await RNFetchBlob.config({ path: tempPath, headers: defaultHeaders }).fetch('GET', url)
    await saveImageToPhotosLibrary(tempPath)
    return true
  } finally {
    void RNFetchBlob.fs.unlink(tempPath).catch(() => {})
  }
}
