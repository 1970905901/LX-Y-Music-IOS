import { Alert } from 'react-native'
import { Navigation } from 'react-native-navigation'
import musicRecognition, { startRecognitionListener, stopRecognitionListener, type RecognitionResult } from '@/utils/nativeModules/musicRecognition'
import { confirmDialog, toast } from '@/utils/tools'
import { navigations } from '@/navigation'
import commonState from '@/store/common/state'
import commonAction from '@/store/common/action'
import { addListMusics } from '@/core/list'
import { getListMusicSync } from '@/utils/listManage'
import { playList } from '@/core/player/player'
import { LIST_IDS, COMPONENT_IDS } from '@/config/constant'
import settingState from '@/store/setting/state'

let isListening = false

export const startMusicRecognition = async () => {
  if (!musicRecognition.isAvailable()) {
    Alert.alert(
      '需要重新编译',
      '听歌识曲功能需要重新编译原生代码才能使用，请在 Android Studio 中重新构建应用。',
      [{ text: '知道了' }]
    )
    return
  }

  try {
    await musicRecognition.checkOverlayPermission()
  } catch (e) {
    try {
      const confirmed = await confirmDialog({
        title: '需要悬浮窗权限',
        message: '听歌识曲功能需要悬浮窗权限才能在后台运行，是否前往设置开启？',
        confirmButtonText: '去设置',
      })

      if (confirmed) {
        await musicRecognition.openOverlayPermissionActivity()
        toast('请在设置中开启悬浮窗权限后返回')
      }
    } catch (dialogErr) {
      // user cancelled
    }
    return
  }

  musicRecognition.showFloatingButton()

  if (!isListening) {
    isListening = true
    startRecognitionListener(handleRecognitionEvent)
  }
}

export const stopMusicRecognition = () => {
  musicRecognition.hideFloatingButton()
  stopRecognitionListener()
  isListening = false
}

const handleRecognitionEvent = (event: RecognitionResult) => {
  console.log('[MusicRecognition] event:', event)
  if (event.action === 'play') {
    console.log('[MusicRecognition] play event details:', JSON.stringify(event))
    playRecognizedSong(event)
  }
}

const playRecognizedSong = async (info: RecognitionResult) => {
  try {
    const songId = info.hash || info.songId || `kg_${Date.now()}`
    const coverUrl = info.cover ? info.cover.replace(/\{size\}/g, '400') : null
    console.log('[MusicRecognition] 构建音乐信息: hash=' + info.hash + ' | songId=' + info.songId + ' | albumId=' + info.albumId + ' | cover=' + coverUrl)

    const musicInfo = {
      id: songId,
      name: info.songname || '未知歌曲',
      singer: info.singername || '未知歌手',
      source: 'kg' as const,
      albumName: info.album || '',
      interval: info.duration ? formatDuration(Number(info.duration)) : null,
      _interval: info.duration ? Number(info.duration) : 0,
      img: coverUrl,
      lrc: null,
      otherSource: null,
      hash: info.hash || '',
      types: [],
      _types: {},
      typeUrl: {},
      meta: {
        songId: info.songId || info.hash || '',
        albumName: info.album || '',
        albumId: info.albumId || '',
        picUrl: coverUrl,
        qualitys: [],
        _qualitys: {},
        hash: info.hash || '',
      },
    }

    console.log('[MusicRecognition] playing:', musicInfo.name, '- hash:', musicInfo.hash)

    await addListMusics(
      LIST_IDS.DEFAULT,
      [musicInfo as any],
      settingState.setting['list.addMusicLocationType']
    )

    const list = getListMusicSync(LIST_IDS.DEFAULT)
    const index = list.findIndex((m: any) => m.id === musicInfo.id)

    if (index >= 0) {
      await playList(LIST_IDS.DEFAULT, index)
      console.log('[MusicRecognition] playList called, index:', index)

      const existingPlayDetail = commonState.componentIds.find(c => c.name === COMPONENT_IDS.playDetail)
      if (existingPlayDetail) {
        try {
          await Navigation.pop(existingPlayDetail.id)
          commonAction.removeComponentId(existingPlayDetail.id)
          console.log('[MusicRecognition] 已关闭上一个 PlayDetail')
        } catch (e) {
          console.log('[MusicRecognition] pop previous PlayDetail failed:', e)
        }
      }

      const componentId = commonState.componentIds[commonState.componentIds.length - 1]?.id
      if (componentId) {
        navigations.pushPlayDetailScreen(componentId)
      }
    } else {
      console.log('[MusicRecognition] song not found in list after adding')
      toast('添加播放列表失败')
    }
  } catch (e: any) {
    console.log('[MusicRecognition] play error:', e?.message || e)
    toast('播放失败: ' + (e?.message || '未知错误'))
  }
}

const formatDuration = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
