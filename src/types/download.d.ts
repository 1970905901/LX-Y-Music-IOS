declare namespace LX {
  namespace Download {
    interface DownloadTask {
      id: string
      musicInfo: LX.Music.MusicInfo
      /** 实际下载到的音质（请求音质不支持时会降级，例如 hires → flac）；旧任务无此字段 */
      actualQuality?: LX.Quality
      quality: LX.Quality
      status: 'waiting' | 'downloading' | 'paused' | 'completed' | 'error'
      progress: {
        percent: number
        speed: string
        downloaded: number
        total: number
      }
      metadataStatus: {
        cover: 'pending' | 'success' | 'fail'
        lyric: 'pending' | 'success' | 'fail'
        tags: 'pending' | 'success' | 'fail'
      }
      errorMsg?: string
      createdAt: number
      filePath: string
      fileName: string
      isForceCookie?: boolean
      isRemoteSynced?: boolean
    }
  }
}
