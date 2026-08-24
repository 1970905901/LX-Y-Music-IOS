import RNFetchBlob from '@/utils/rnFetchBlob'
import { getFileExtensionFromUrl } from '@/screens/Home/Views/Mylist/MusicList/download/utils'
import { requestStoragePermission, toast } from '@/utils/tools'

const sanitizeFileName = (name: string) =>
  (name.trim() || 'image').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)

export const saveImageToPictures = async (url: string, name: string = 'image') => {
  const isGranted = await requestStoragePermission()
  if (isGranted !== true) {
    toast('没有存储权限，无法保存图片', 'short')
    return null
  }

  const extension = getFileExtensionFromUrl(url)
  const picBaseDir = RNFetchBlob.fs.dirs.PictureDir || RNFetchBlob.fs.dirs.DownloadDir
  const saveDir = `${picBaseDir}/LX-X-Music`
  const fileName = `${sanitizeFileName(name)}_${Date.now()}.${extension}`
  const filePath = `${saveDir}/${fileName}`

  if (!(await RNFetchBlob.fs.exists(saveDir))) {
    try {
      await RNFetchBlob.fs.mkdir(saveDir)
    } catch (err) {
      // Fallback to the base pictures/download directory below.
    }
  }

  const targetPath = (await RNFetchBlob.fs.exists(saveDir))
    ? filePath
    : `${picBaseDir}/${fileName}`

  await RNFetchBlob.config({ path: targetPath }).fetch('GET', url)
  await RNFetchBlob.fs.scanFile([{ path: targetPath }])
  return targetPath
}
