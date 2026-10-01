import { memo, useCallback } from 'react'
import { downloadMusic } from '@/core/download'
import playerState from '@/store/player/state'
import Btn from './Btn'

export default memo(() => {
  const handleDownloadPress = useCallback(() => {
    const info = playerState.playMusicInfo.musicInfo
    if (!info) return
    const musicInfo = 'progress' in info ? info.metadata.musicInfo : info
    // 不再用 download.enable 预判短路：关掉下载开关时 downloadMusic 会给出提示，
    // 静默 return 会让用户以为「点了没反应」（用户反馈的播放页下载无反馈）。
    downloadMusic(musicInfo)
  }, [])

  return <Btn icon="download-2" onPress={handleDownloadPress} />
})
