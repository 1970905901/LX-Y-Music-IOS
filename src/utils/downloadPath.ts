import { Platform } from 'react-native'
import RNFS from 'react-native-fs'
import RNFetchBlob from '@/utils/rnFetchBlob'

/**
 * 返回默认下载目录。
 *
 * iOS：落在应用沙盒 Documents 下的「本地」文件夹（文件 App 中显示为
 *      "LX-Y Music/本地"），下载文件与主题图片等其他数据保持隔离。
 *
 * Android：沿用外部 Music 目录下的 LX-Y Music 子目录，与其他文件保持隔离。
 */
export const getDefaultDownloadPath = (): string => {
  if (Platform.OS === 'ios') {
    return `${RNFS.DocumentDirectoryPath}/本地`
  }
  return `${RNFetchBlob.fs.dirs.MusicDir}/LX-Y Music`
}
