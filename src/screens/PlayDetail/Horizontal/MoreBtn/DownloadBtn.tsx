import { memo, useCallback } from 'react'
import { downloadMusic } from '@/core/download'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import Btn from './Btn'

export default memo(() => {
  const handleDownloadPress = useCallback(() => {
    const info = playerState.playMusicInfo.musicInfo
    if (!info) return
    const musicInfo = 'progress' in info ? info.metadata.musicInfo : info
    if (settingState.setting['download.enable']) {
      downloadMusic(musicInfo)
    }
  }, [])

  return <Btn icon="download-2" onPress={handleDownloadPress} />
})
