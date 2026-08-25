import { Platform } from 'react-native'
import RNFS from 'react-native-fs'
import RNFetchBlob from '@/utils/rnFetchBlob'

/**
 * 返回默认下载目录。
 *
 * iOS：直接落在应用沙盒 Documents 根目录。该目录在「文件」App 中显示为应用名
 *      "LX-Y Music"，因此下载的文件会直接在文件 App 中可见，避免 Documents 下
 *      再嵌套一层同名 LX-Y Music 子目录导致的"目录为空"困惑。
 *
 * Android：沿用外部 Music 目录下的 LX-Y Music 子目录，与其他文件保持隔离。
 */
export const getDefaultDownloadPath = (): string => {
  if (Platform.OS === 'ios') {
    return RNFS.DocumentDirectoryPath
  }
  return `${RNFetchBlob.fs.dirs.MusicDir}/LX-Y Music`
}
