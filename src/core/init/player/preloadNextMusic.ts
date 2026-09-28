import { getMusicUrlInfo } from '@/core/music'
import { getNextPlayMusicInfo, resetRandomNextMusicInfo } from '@/core/player/player'
import { checkUrl } from '@/utils/request'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { isCached } from '@/plugins/player/utils'
import { prefetchNativeFlacPlayback } from '@/plugins/player/nativeFlac'


const preloadMusicInfo = {
  isLoading: false,
  preProgress: 0,
  // 竞态保护（对齐上游 usePreloadNextMusic 的 requestId）：每次发起预加载递增，
  // 异步各步回来后校验——期间切歌/失效时旧结果全部作废，不会把旧歌的 info 挂进来
  requestId: 0,
  info: null as LX.Player.PlayMusicInfo | null,
}
const resetPreloadInfo = () => {
  // request 递增而非归零：让所有在途异步结果因 id 不匹配而作废（含归零后的旧请求）
  preloadMusicInfo.requestId++
  preloadMusicInfo.preProgress = 0
  preloadMusicInfo.info = null
  preloadMusicInfo.isLoading = false
}
const warmPreloadUrl = async(musicInfo: LX.Player.PlayMusic, url: string, quality?: LX.Quality | null) => {
  if (await prefetchNativeFlacPlayback(musicInfo, url, quality)) return

  const [cached, available] = await Promise.all([
    isCached(url),
    checkUrl(url).then(() => true).catch(() => false),
  ])
  if (!cached && !available) throw new Error('preload unavailable')
}
const preloadNextMusicUrl = async(curTime: number) => {
  if (preloadMusicInfo.isLoading || curTime - preloadMusicInfo.preProgress < 2) return
  const currentMusicId = playerState.musicInfo.id
  if (!currentMusicId) return

  // 对齐上游：预加载受「音频预加载」开关控制（设置里关闭后不再预取下一首）
  if (!settingState.setting['player.isEnableAudioPreload']) return

  preloadMusicInfo.isLoading = true
  const requestId = ++preloadMusicInfo.requestId
  preloadMusicInfo.preProgress = curTime
  console.log('preload next music url')
  const info = await getNextPlayMusicInfo().catch(() => null)
  if (!info || requestId !== preloadMusicInfo.requestId || playerState.musicInfo.id !== currentMusicId) {
    if (requestId === preloadMusicInfo.requestId) preloadMusicInfo.isLoading = false
    return
  }

  preloadMusicInfo.info = info
  const urlInfo = await getMusicUrlInfo({ musicInfo: info.musicInfo }).catch(() => null)
  if (urlInfo?.url) {
    console.log('preload url', urlInfo.url)
    try {
      if (requestId !== preloadMusicInfo.requestId) return
      await warmPreloadUrl(info.musicInfo, urlInfo.url, urlInfo.quality)
    } catch {
      const refreshedUrlInfo = await getMusicUrlInfo({ musicInfo: info.musicInfo, isRefresh: true }).catch(() => null)
      console.log('preload url refresh', refreshedUrlInfo?.url ?? '')
      if (requestId !== preloadMusicInfo.requestId) return
      if (refreshedUrlInfo?.url) {
        await warmPreloadUrl(info.musicInfo, refreshedUrlInfo.url, refreshedUrlInfo.quality).catch(() => {})
      }
    }
  }
  if (requestId === preloadMusicInfo.requestId) preloadMusicInfo.isLoading = false
}

export default () => {
  const setProgress = (time: number) => {
    if (!playerState.musicInfo.id) return
    preloadMusicInfo.preProgress = time
  }

  const handleSetPlayInfo = () => {
    resetPreloadInfo()
  }

  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys, _settings) => {
    if (!keys.includes('player.togglePlayMethod')) return
    if (!preloadMusicInfo.info || preloadMusicInfo.info.isTempPlay) return
    resetRandomNextMusicInfo()
    preloadMusicInfo.info = null
    preloadMusicInfo.preProgress = playerState.progress.nowPlayTime
  }

  const handlePlayProgressChanged: typeof global.state_event.playProgressChanged = (progress) => {
    const duration = progress.maxPlayTime
    // 对齐上游触发阈值：剩余 < 20s（且总长 > 10s）时开始预取下一首——
    // 为 URL 获取 + 可用性探测（含失败刷新重试）留足时间
    if (duration > 10 && duration - progress.nowPlayTime < 20 && !preloadMusicInfo.info) {
      void preloadNextMusicUrl(progress.nowPlayTime)
    }
  }

  global.app_event.on('setProgress', setProgress)
  global.app_event.on('musicToggled', handleSetPlayInfo)
  global.state_event.on('configUpdated', handleConfigUpdated)
  global.state_event.on('playProgressChanged', handlePlayProgressChanged)
}
