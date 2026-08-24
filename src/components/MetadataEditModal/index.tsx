import { useRef, useImperativeHandle, forwardRef, useState } from 'react'
import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Text from '@/components/common/Text'
import { View } from 'react-native'
import { TEMP_FILE_PATH, createStyle, toast } from '@/utils/tools'
import {
  readMetadata,
  readPic,
  readLyric,
  writeMetadata,
  writePic,
  writeLyric,
} from '@/utils/localMediaMetadata'
import { useUnmounted } from '@/utils/hooks'
import MetadataForm, { defaultData, type Metadata, type MetadataFormType } from './MetadataForm'
import { log } from '@/utils/log'
import { formatPlayTime2 } from '@/utils'
import { unlink, rename, existsFile, readDir, stat } from '@/utils/fs'
import { saveEditedLyric } from '@/utils/data'

export type { Metadata }

export interface MetadataEditType {
  show: (filePath: string, musicInfo?: LX.Music.MusicInfo) => void
}
export interface MetadataEditProps {
  onUpdate: (info: Metadata) => void
}

export default forwardRef<MetadataEditType, MetadataEditProps>((props, ref) => {
  const alertRef = useRef<ConfirmAlertType>(null)
  const metadataFormRef = useRef<MetadataFormType>(null)
  const filePath = useRef<string>('')
  const metadata = useRef<Metadata>({ ...defaultData })
  const [visible, setVisible] = useState(false)
  const [processing, setProcessing] = useState(false)
  const isUnmounted = useUnmounted()
  const musicInfoRef = useRef<LX.Music.MusicInfo | null>(null)

  const handleShow = (filePath: string, musicInfo?: LX.Music.MusicInfo) => {
    musicInfoRef.current = musicInfo || null
    alertRef.current?.setVisible(true)
    console.log(`[编辑标签] 开始读取元数据: ${filePath}`)
    void Promise.all([
      readMetadata(filePath),
      readPic(filePath).catch(() => ''),
      readLyric(filePath, false).catch(() => ''),
    ]).then(async ([_metadata, pic, lyric]) => {
      console.log(`[编辑标签] 读取结果: metadata=${JSON.stringify(_metadata)}, pic=${pic ? '有' : '无'}, lyric=${lyric ? '有' : '无'}`)
      if (!_metadata) {
        console.log(`[编辑标签] 警告: 未能读取到元数据，使用文件名作为歌名`)
        // 尝试从文件名提取歌名
        const fileName = filePath.split('/').pop() || ''
        const nameWithoutExt = fileName.replace(/\.[^.]+$/, '')
        metadata.current = {
          name: nameWithoutExt,
          singer: '',
          albumName: '',
          pic,
          interval: '',
          lyric,
        }
      } else {
        metadata.current = {
          name: _metadata.name,
          singer: _metadata.singer,
          albumName: _metadata.albumName,
          pic,
          interval: formatPlayTime2(_metadata.interval),
          lyric,
        }
      }
      requestAnimationFrame(() => {
        metadataFormRef.current?.setForm(filePath, metadata.current)
      })
    })
  }
  useImperativeHandle(ref, () => ({
    show(path, musicInfo) {
      filePath.current = path
      if (visible) handleShow(path, musicInfo)
      else {
        setVisible(true)
        requestAnimationFrame(() => {
          handleShow(path, musicInfo)
        })
      }
    },
  }))

  const handleUpdate = async () => {
    if (!metadataFormRef.current) return
    let _metadata = metadataFormRef.current.getForm() as Metadata & { fileName?: string; originalFileName?: string }
    if (!_metadata.name) {
      toast(global.i18n.t('metadata_edit_modal_tip'), 'long')
      return
    }
    console.log(`[编辑标签] ========== 开始保存 ==========`)
    console.log(`[编辑标签] 文件路径: ${filePath.current}`)
    console.log(`[编辑标签] 歌名: ${_metadata.name}`)
    console.log(`[编辑标签] 歌手: ${_metadata.singer || '空'}`)
    console.log(`[编辑标签] 专辑: ${_metadata.albumName || '空'}`)
    console.log(`[编辑标签] 原始歌名: ${metadata.current.name || '空'}`)
    console.log(`[编辑标签] fileName: ${_metadata.fileName || '空'}`)
    console.log(`[编辑标签] originalFileName: ${_metadata.originalFileName || '空'}`)
    
    // 检查文件是否存在
    const fileExists = await existsFile(filePath.current)
    console.log(`[编辑标签] 文件是否存在: ${fileExists}`)
    
    // 读取目录内容，检查实际文件名
    const dirPath = filePath.current.substring(0, filePath.current.lastIndexOf('/'))
    const dirFiles = await readDir(dirPath).catch(() => [])
    const matchingFiles = dirFiles.filter(f => f.name.includes('向远端') || f.name.includes('5caa25ca'))
    console.log(`[编辑标签] 目录中的匹配文件: ${JSON.stringify(matchingFiles.map(f => f.name))}`)
    
    setProcessing(true)
    let isUpdated = false
    try {
      // 重命名文件
      if (_metadata.fileName && _metadata.originalFileName && _metadata.fileName !== _metadata.originalFileName) {
        console.log(`[编辑标签] 重命名文件: ${_metadata.originalFileName} -> ${_metadata.fileName}`)
        const lastSlashIndex = filePath.current.lastIndexOf('/')
        const newFilePath = filePath.current.substring(0, lastSlashIndex + 1) + _metadata.fileName
        await rename(filePath.current, newFilePath)
        filePath.current = newFilePath
        console.log(`[编辑标签] 新文件路径: ${filePath.current}`)
        isUpdated ||= true
      }

      // 写入元数据
      if (
        _metadata.name != metadata.current.name ||
        _metadata.singer != metadata.current.singer ||
        _metadata.albumName != metadata.current.albumName
      ) {
        console.log(`[编辑标签] 写入元数据: name=${_metadata.name}, singer=${_metadata.singer}, album=${_metadata.albumName}`)
        console.log(`[编辑标签] 使用的文件路径: ${filePath.current}`)
        isUpdated ||= true
        
        // 检查文件状态
        try {
          const fileStat = await stat(filePath.current)
          console.log(`[编辑标签] 文件状态: ${JSON.stringify(fileStat)}`)
        } catch (err) {
          console.log(`[编辑标签] 无法获取文件状态: ${err}`)
        }
        
        await writeMetadata(filePath.current, {
          name: _metadata.name,
          singer: _metadata.singer,
          albumName: _metadata.albumName,
        })
        console.log(`[编辑标签] 元数据写入成功`)
      }
      
      // 写入封面
      if (_metadata.pic != metadata.current.pic) {
        console.log(`[编辑标签] 写入封面`)
        isUpdated ||= true
        await writePic(filePath.current, _metadata.pic)
        if (_metadata.pic.startsWith(TEMP_FILE_PATH)) void unlink(_metadata.pic)
        console.log(`[编辑标签] 封面写入成功`)
      }
      
      // 写入歌词
      if (_metadata.lyric != metadata.current.lyric) {
        console.log(`[编辑标签] 写入歌词`)
        isUpdated ||= true
        await writeLyric(filePath.current, _metadata.lyric)
        const lyricMusicInfo: any = musicInfoRef.current || {
          id: filePath.current,
          name: _metadata.name,
          singer: _metadata.singer,
          source: 'local',
        }
        void saveEditedLyric(lyricMusicInfo, { lyric: _metadata.lyric, tlyric: '', rlyric: '', lxlyric: '' })
        console.log(`[编辑标签] 歌词写入成功`)
      }
      
      console.log(`[编辑标签] ========== 保存完成 ==========`)
    } catch (err: any) {
      console.error(`[编辑标签] ========== 保存失败 ==========`)
      console.error(`[编辑标签] 错误信息: ${err.message}`)
      console.error(`[编辑标签] 错误堆栈: ${err.stack || '无'}`)
      console.error(`[编辑标签] 文件路径: ${filePath.current}`)
      log.error(`save (${filePath.current}) metadata failed: \n${err.message}`)
      toast(global.i18n.t('metadata_edit_modal_failed'), 'long')
      return
    } finally {
      setProcessing(false)
    }
    if (isUpdated) toast(global.i18n.t('metadata_edit_modal_success'), 'long')
    alertRef.current?.setVisible(false)
    props.onUpdate(_metadata)
  }

  return visible ? (
    <ConfirmAlert
      ref={alertRef}
      onConfirm={handleUpdate}
      confirmText={
        processing
          ? global.i18n.t('metadata_edit_modal_processing')
          : global.i18n.t('metadata_edit_modal_confirm')
      }
      disabledConfirm={processing}
    >
      <View style={styles.renameContent} onStartShouldSetResponder={() => true}>
        <Text style={styles.title}>{global.i18n.t('metadata_edit_modal_title')}</Text>
        <MetadataForm ref={metadataFormRef} />
      </View>
    </ConfirmAlert>
  ) : null
})

const styles = createStyle({
  renameContent: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'column',
  },
  title: {
    marginBottom: 20,
    textAlign: 'center',
  },
})
