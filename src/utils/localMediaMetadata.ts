import {temporaryDirectoryPath, readDir, unlink, extname, privateStorageDirectoryPath} from '@/utils/fs'
import { readPic as _readPic } from 'react-native-local-media-metadata'
export {
  type MusicMetadata,
  type MusicMetadataFull,
  readMetadata,
  writeMetadata,
  writePic,
  readLyric,
  writeLyric,
} from 'react-native-local-media-metadata'

let cleared = false
export const picCachePath = privateStorageDirectoryPath + '/local-media-covers';

export const getPicCachePath = () => picCachePath;

export const scanAudioFiles = async (dirPath: string) => {
  console.log(`[扫描音频] 扫描目录: ${dirPath}`)
  const files = await readDir(dirPath)
  console.log(`[扫描音频] 找到 ${files.length} 个文件`)
  
  const supportedAudioExts = [
    '.mp3', '.m4a', '.flac', '.wav', '.ogg', '.aac', '.wma', '.m4b', '.mp4', '.opus'
  ]
  
  const audioFiles = files
    .filter((file) => {
      if (file.mimeType?.startsWith('audio/')) return true
      const fileExt = extname(file?.name ?? '').toLowerCase()
      if (supportedAudioExts.includes(fileExt)) return true
      return false
    })
    .map((file) => file)
  
  console.log(`[扫描音频] 过滤后音频文件: ${audioFiles.length} 个`)
  if (audioFiles.length > 0) {
    audioFiles.forEach((f, i) => {
      console.log(`[扫描音频]   ${i + 1}. ${f.name} - mimeType: ${f.mimeType || '未知'}`)
    })
  }
  
  return audioFiles
}

const clearPicCache = async () => {
  await unlink(picCachePath)
  cleared = true
}

export const readPic = async (filePath: string): Promise<string> => {
  const processedPath = filePath.includes('#')
    ? filePath.replace(/#/g, '%23')
    : filePath;
  let path = await _readPic(processedPath, picCachePath);

  if (path && !path.startsWith('file://') && path.startsWith('/')) {
    path = `file://${path}`;
  }
  return path;
}
