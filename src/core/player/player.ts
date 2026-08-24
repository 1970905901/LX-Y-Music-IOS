import {
  isInitialized,
  initial as playerInitial,
  isEmpty,
  setPause,
  setPlay,
  setResource,
  setStop, initTrackInfo,
} from '@/plugins/player'
import { setStatusText } from '@/core/player/playStatus'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { getList, setPlayMusicInfo, setMusicInfo, setPlayListId } from '@/core/player/playInfo'
import { clearPlayedList, addPlayedList, removePlayedList } from '@/core/player/playedList'
import { clearTempPlayeList, removeTempPlayList } from '@/core/player/tempPlayList'
import { getMusicUrl, getPicPath, getLyricInfo } from '@/core/music'
import { getOtherSource, getPlayQuality, QUALITY_RANK, tryUserDefinedSourceToggle } from '@/core/music/utils'
import { requestMsg } from '@/utils/message'
import { getRandom } from '@/utils/common'
import { filterList } from './utils'
import { startPreload } from './preload'
import { preloadLog } from '@/utils/preloadLog'
import BackgroundTimer from 'react-native-background-timer'
import {
  checkIgnoringBatteryOptimization,
  checkNotificationPermission,
  debounceBackgroundTimer,
} from '@/utils/tools'

const createGettingUrlId = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem) => {
  const tInfo =
    'progress' in musicInfo
      ? musicInfo.metadata.musicInfo.meta.toggleMusicInfo
      : musicInfo.meta.toggleMusicInfo
  return `${musicInfo.id}_${tInfo?.id ?? ''}`
}

const diffCurrentMusicInfo = (curMusicInfo: LX.Music.MusicInfo | LX.Download.ListItem): boolean => {
  return (
    createGettingUrlId(curMusicInfo) != global.lx.gettingUrlId ||
    curMusicInfo.id != playerState.playMusicInfo.musicInfo?.id ||
    playerState.isPlay
  )
}

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/opus': 'opus',
  'audio/x-mpeg': 'mp3',
  'audio/x-ogg': 'ogg',
}

const ENCRYPTED_EXTENSIONS = new Set([
  'mflac', 'mflac0', 'mgg', 'mgg0', 'mgg1', 'ncm',
  'kgm', 'kgma', 'kgg', 'vpr', 'kwm', 'kwl', 'kwb',
  'kwmv', 'kwac', 'kwring', 'kwshort',
])

const validateAudioUrl = async (url: string): Promise<boolean> => {
  try {
    const resp = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!resp.ok) return false
    const cl = resp.headers.get('content-length')
    if (cl && parseInt(cl) === 0) return false
    const ct = (resp.headers.get('content-type') || '').toLowerCase()
    if (ct) {
      const format = Object.keys(AUDIO_CONTENT_TYPES).find(t => ct.includes(t))
      if (!format) return false
      return true
    }
    const pathname = new URL(url).pathname.toLowerCase()
    const ext = pathname.split('.').pop() || ''
    if (ENCRYPTED_EXTENSIONS.has(ext)) return false
    return true
  } catch {
    return true
  }
}

type FailureStrategy = 'togglePlatform' | 'lowerQuality' | 'toggleSource' | 'playNext'

export const executeFailureStrategy = async (
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem,
  isRefresh: boolean,
  error: any,
  triedUrls?: Set<string>,
  startIndex = 0
): Promise<{ url: string; index: number } | null> => {
  if (!triedUrls) triedUrls = new Set()
  const strategies = (settingState.setting['player.failureStrategy'] ?? []) as FailureStrategy[]
  const currentMusicInfo = 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
  const isOnline =
    currentMusicInfo &&
    'meta' in currentMusicInfo &&
    '_qualitys' in ((currentMusicInfo as any).meta ?? {})

  const 播放策略名称: Record<string, string> = {
    togglePlatform: '切换平台',
    lowerQuality: '降低音质',
    toggleSource: '切换音源',
    playNext: '播放下一首',
  }

  console.log('[播放策略] ====== 播放失败，开始执行失败策略 ======')
  console.log('[播放策略] 原始设置值:', JSON.stringify(settingState.setting['player.failureStrategy']))
  console.log('[播放策略] 解析后策略队列:', strategies.map(s => 播放策略名称[s] || s))
  console.log('[播放策略] 当前音质偏好:', settingState.setting['player.playQuality'])
  console.log('[播放策略] 自动换音源:', settingState.setting['player.enableAutoToggleSource'] ? '开启' : '关闭', '| 最大尝试次数:', settingState.setting['player.toggleSourceMaxRetry'])
  console.log('[播放策略] 歌曲:', (currentMusicInfo as any)?.name, '| 当前音源:', (currentMusicInfo as any)?.source, '| 是否在线:', isOnline ? '是' : '否')
  console.log('[播放策略] 错误信息:', error?.message ?? error)

  for (let i = startIndex; i < strategies.length; i++) {
    const strategy = strategies[i]
    if (global.lx.isPlayedStop || currentMusicInfo?.id != playerState.playMusicInfo.musicInfo?.id) {
      console.log('[播放策略] 播放已停止或歌曲已切换，终止策略执行')
      return null
    }

    console.log(`[播放策略] ---- 执行策略 ${i + 1}/${strategies.length}: ${播放策略名称[strategy] || strategy} ----`)

    switch (strategy) {
      case 'togglePlatform': {
        if (!isOnline) {
          console.log('[播放策略] [切换平台] 非在线歌曲，跳过')
          break
        }
        try {
          setStatusText('尝试切换平台...')
          const otherSources = await getOtherSource(musicInfo)
          console.log('[播放策略] [切换平台] 可用其他平台:', otherSources.map((s: any) => s.source))
          for (const source of otherSources) {
            if (global.lx.isPlayedStop || currentMusicInfo?.id != playerState.playMusicInfo.musicInfo?.id) {
              console.log('[播放策略] [切换平台] 播放已停止或歌曲已切换，终止')
              return null
            }
            try {
              setStatusText(`尝试切换平台 ${source.source}`)
              console.log('[播放策略] [切换平台] >>> 正在尝试平台:', source.source, '| 歌曲:', source.name, '| 歌手:', source.singer)
              const url = await getMusicUrl({
                musicInfo: source,
                isRefresh,
                allowToggleSource: false,
              })
              if (url && !triedUrls!.has(url)) {
                const isValid = await validateAudioUrl(url)
                if (!isValid) {
                  console.log('[播放策略] [切换平台]', source.source, 'URL不可播放，跳过')
                  triedUrls!.add(url)
                  continue
                }
                triedUrls!.add(url)
                console.log('[播放策略] [切换平台] 成功! 平台:', source.source)
                setStatusText(`切换到 ${source.source} 成功`)
                return { url, index: i }
              }
              if (url) {
                console.log('[播放策略] [切换平台]', source.source, '返回已尝试URL，跳过')
              }
            } catch (e: any) {
              console.log('[播放策略] [切换平台]', source.source, '失败:', e?.message)
            }
          }
          console.log('[播放策略] [切换平台] 所有平台均失败，继续下一个策略')
        } catch (e: any) {
          console.log('[播放策略] [切换平台] 失败:', e?.message)
        }
        break
      }
      case 'lowerQuality': {
        if (!isOnline) {
          console.log('[播放策略] [降低音质] 非在线歌曲，跳过')
          break
        }
        try {
          const onlineInfo = currentMusicInfo as LX.Music.MusicInfoOnline
          const preferredQuality = settingState.setting['player.playQuality']
          const availableQualities = Object.keys(onlineInfo.meta._qualitys ?? {}) as LX.Quality[]
          const sortedQualities = availableQualities
            .filter((q) => QUALITY_RANK.includes(q))
            .sort((a, b) => QUALITY_RANK.indexOf(a) - QUALITY_RANK.indexOf(b))
          const preferredIndex = QUALITY_RANK.indexOf(preferredQuality)
          const lowerQualities = sortedQualities.filter((q) => {
            const idx = QUALITY_RANK.indexOf(q)
            return preferredIndex >= 0 ? idx > preferredIndex : true
          })

          console.log('[播放策略] [降低音质] 当前音质:', preferredQuality, '| 可降级:', lowerQualities)

          for (const quality of lowerQualities) {
            if (global.lx.isPlayedStop || currentMusicInfo?.id != playerState.playMusicInfo.musicInfo?.id) {
              console.log('[播放策略] [降低音质] 播放已停止，终止')
              return null
            }
            try {
              setStatusText(`尝试降级音质 ${quality}`)
              const url = await getMusicUrl({
                musicInfo,
                quality,
                isRefresh,
                allowToggleSource: false,
              })
              if (url && !triedUrls!.has(url)) {
                const isValid = await validateAudioUrl(url)
                if (!isValid) {
                  console.log(`[播放策略] [降低音质] ${quality} URL不可播放，跳过`)
                  triedUrls!.add(url)
                  continue
                }
                triedUrls!.add(url)
                console.log(`[播放策略] [降低音质] 成功! 降级到: ${quality}`)
                setStatusText(`降级到 ${quality} 成功`)
                return { url, index: i }
              }
              if (url) {
                console.log(`[播放策略] [降低音质] ${quality} 返回已尝试URL，跳过`)
              }
            } catch {
              console.log(`[播放策略] [降低音质] ${quality} 失败，尝试下一个`)
              continue
            }
          }
          console.log('[播放策略] [降低音质] 所有可降级音质均失败')
        } catch (e: any) {
          console.log('[播放策略] [降低音质] 异常:', e?.message)
        }
        break
      }
      case 'toggleSource': {
        if (!isOnline) {
          console.log('[播放策略] [切换音源] 非在线歌曲，跳过')
          break
        }
        if (!settingState.setting['player.enableAutoToggleSource']) {
          console.log('[播放策略] [切换音源] 自动换音源已关闭，跳过')
          break
        }
        try {
          setStatusText('尝试切换音源...')
          const maxRetry = settingState.setting['player.toggleSourceMaxRetry'] ?? 5
          console.log('[播放策略] [切换音源] 最大尝试次数:', maxRetry)
          const result = await tryUserDefinedSourceToggle({
            musicInfo: currentMusicInfo as LX.Music.MusicInfoOnline,
            isRefresh,
            maxRetry,
            onToggleSource: (mInfo) => {
              if (currentMusicInfo?.id != playerState.playMusicInfo.musicInfo?.id) return
              console.log('[播放策略] [切换音源] >>> 正在尝试插件:', mInfo?.source, '| 歌曲:', mInfo?.name)
              setStatusText(`尝试切换音源 ${mInfo?.source || ''}`)
            },
          })
          if (result.url) {
            triedUrls!.add(result.url)
            console.log('[播放策略] [切换音源] 成功! 插件:', (result.musicInfo as any)?.source)
            setStatusText(`切换音源成功`)
            return { url: result.url, index: i }
          }
          console.log('[播放策略] [切换音源] 所有插件均失败，继续下一个策略')
        } catch (e: any) {
          console.log('[播放策略] [切换音源] 失败:', e?.message)
        }
        break
      }
      case 'playNext': {
        console.log('[播放策略] [播放下一首] 执行播放下一首')
        setStatusText('播放下一首...')
        void playNext(true)
        return null
      }
    }
  }

  console.log('[播放策略] ====== 所有策略执行完毕，均未成功 ======')
  throw error
}

const createDelayNextTimeout = (delay: number) => {
  let timeout: number | null
  const clearDelayNextTimeout = () => {
    if (timeout) {
      BackgroundTimer.clearTimeout(timeout)
      timeout = null
    }
  }

  const addDelayNextTimeout = () => {
    clearDelayNextTimeout()
    timeout = BackgroundTimer.setTimeout(() => {
      timeout = null
      if (global.lx.isPlayedStop) return
      void playNext(true)
    }, delay)
  }

  return {
    clearDelayNextTimeout,
    addDelayNextTimeout,
  }
}
const { addDelayNextTimeout, clearDelayNextTimeout } = createDelayNextTimeout(5000)
const { addDelayNextTimeout: addLoadTimeout, clearDelayNextTimeout: clearLoadTimeout } =
  createDelayNextTimeout(30000)

let cancelDelayRetry: (() => void) | null = null
const delayRetry = async (
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem,
  isRefresh = false
): Promise<string | null> => {
  return new Promise<string | null>((resolve, reject) => {
    const time = getRandom(2, 6)
    setStatusText(global.i18n.t('player__getting_url_delay_retry', { time }))
    const tiemout = setTimeout(() => {
      getMusicPlayUrl(musicInfo, isRefresh, true)
        .then((result) => {
          cancelDelayRetry = null
          setStatusText('')
          resolve(result)
        })
        .catch(async (err: any) => {
          cancelDelayRetry = null
          reject(err)
        })
    }, time * 1000)
    cancelDelayRetry = () => {
      clearTimeout(tiemout)
      cancelDelayRetry = null
      resolve(null)
    }
  })
}

const getMusicPlayUrl = async (
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem,
  isRefresh = false,
  isRetryed = false
): Promise<string | null> => {
  // this.musicInfo.url = await getMusicPlayUrl(targetSong, type)
  setStatusText(global.i18n.t('player__getting_url'))
  addLoadTimeout()

  const currentMusicInfo = 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
  const isWebDAVMusic = 'webdav' in currentMusicInfo.meta && (currentMusicInfo.meta as any).webdav === true
  
  if (isWebDAVMusic) {
    const webdavPath = settingState.setting['webdav.downloadPath']
    let configuredDownloadDir = ''
    if (webdavPath && typeof webdavPath === 'string' && webdavPath.trim()) {
      configuredDownloadDir = webdavPath.trim()
    } else {
      const { getWebDAVPrivateDirectory } = await import('@/utils/fs')
      configuredDownloadDir = getWebDAVPrivateDirectory()
    }
    const fileName = currentMusicInfo.meta.fileName
    
    const existingFilePath = currentMusicInfo.meta.filePath
    let filePathToCheck = existingFilePath || `${configuredDownloadDir}/${fileName}`
    
    const { existsFile } = await import('@/utils/fs')
    let fileExists = await existsFile(filePathToCheck)
    
    if (!fileExists && existingFilePath) {
      const alternativePath = `${configuredDownloadDir}/${fileName}`
      filePathToCheck = alternativePath
      fileExists = await existsFile(filePathToCheck)
    }
    
    if (!fileExists) {
      setStatusText('正在下载歌曲...')
      webDAVLog?.info('getMusicPlayUrl: WebDAV file not found, starting download', { musicId: currentMusicInfo.id, expectedPath: filePathToCheck })
    }
  }

  // const type = getPlayType(settingState.setting['player.isPlayHighQuality'], musicInfo)
  let toggleMusicInfo = currentMusicInfo.meta.toggleMusicInfo

  return (
    toggleMusicInfo
      ? getMusicUrl({
          musicInfo: toggleMusicInfo,
          isRefresh,
          allowToggleSource: false,
        })
      : Promise.reject(new Error('not found'))
  )
    .catch(async () => {
      return getMusicUrl({
        musicInfo,
        isRefresh,
        onToggleSource(mInfo) {
          if (diffCurrentMusicInfo(musicInfo)) return
          setStatusText(global.i18n.t('toggle_source_try'))
        },
      })
    })
    .then((url) => {
      if (global.lx.isPlayedStop || diffCurrentMusicInfo(musicInfo)) return null

      return url
    })
    .catch(async (err) => {
      if (
        global.lx.isPlayedStop ||
        diffCurrentMusicInfo(musicInfo) ||
        err.message == requestMsg.cancelRequest
      )
        return null

      if (err.message == requestMsg.tooManyRequests) return delayRetry(musicInfo, isRefresh)

      return executeFailureStrategy(musicInfo, isRefresh, err)
    })
}

export const setMusicUrl = (
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem,
  isRefresh?: boolean
) => {
  // addLoadTimeout()
  if (!diffCurrentMusicInfo(musicInfo)) return
  if (cancelDelayRetry) cancelDelayRetry()
  global.lx.gettingUrlId = createGettingUrlId(musicInfo)
  void getMusicPlayUrl(musicInfo, isRefresh)
    .then((url) => {
      if (!url) return
      const currentMusicInfo = playerState.playMusicInfo.musicInfo
      if (musicInfo.id === currentMusicInfo?.id) {
        global.lx.gettingUrlId = ''
        clearLoadTimeout()
        setStatusText('')
        
        const isWebDAVMusic = 'webdav' in currentMusicInfo.meta && (currentMusicInfo.meta as any).webdav === true
        if (isWebDAVMusic) {
          void setStop().then(() => {
            setResource(currentMusicInfo, url, playerState.progress.nowPlayTime)
          })
        } else {
          setResource(currentMusicInfo, url, playerState.progress.nowPlayTime)
        }
        
        preloadLog.info(`Current song URL ready, triggering preload`)
        startPreload()
      } else {
        setStatusText('')
      }
    })
    .catch((err: any) => {
      console.log(err)
      setStatusText(err.message as string)
      global.app_event.error()
      void playNext(true)
    })
    .finally(() => {
      if (musicInfo.id === playerState.playMusicInfo.musicInfo?.id && global.lx.gettingUrlId) {
        global.lx.gettingUrlId = ''
        clearLoadTimeout()
      }
    })
}

const handleRestorePlay = async (restorePlayInfo: LX.Player.SavedPlayInfo) => {
  const musicInfo = playerState.playMusicInfo.musicInfo
  if (!musicInfo) return

  setTimeout(() => {
    global.app_event.setProgress(
      settingState.setting['player.isSavePlayTime'] ? restorePlayInfo.time : 0,
      restorePlayInfo.maxTime
    )
  })

  const playMusicInfo = playerState.playMusicInfo

  void initTrackInfo(musicInfo, playerState.musicInfo)

  void getPicPath({ musicInfo, listId: playMusicInfo.listId }).then((url: string) => {
    if (
      musicInfo.id != playMusicInfo.musicInfo?.id ||
      playerState.musicInfo.pic == url ||
      playerState.loadErrorPicUrl == url
    )
      return
    setMusicInfo({ pic: url })
    global.app_event.picUpdated()
  })

  void getLyricInfo({ musicInfo })
    .then((lyricInfo) => {
      if (musicInfo.id != playMusicInfo.musicInfo?.id) return
      setMusicInfo({
        lrc: lyricInfo.lyric,
        tlrc: lyricInfo.tlyric,
        lxlrc: lyricInfo.lxlyric,
        rlrc: lyricInfo.rlyric,
        rawlrc: lyricInfo.rawlrcInfo.lyric,
      })
      global.app_event.lyricUpdated()
    })
    .catch((err) => {
      console.log(err)
      if (musicInfo.id != playMusicInfo.musicInfo?.id) return
      setStatusText(global.i18n.t('lyric__load_error'))
    })

  if (settingState.setting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay)
    addPlayedList(playMusicInfo as LX.Player.PlayMusicInfo)
}

const debouncePlay = debounceBackgroundTimer((musicInfo: LX.Player.PlayMusic) => {
  setMusicUrl(musicInfo)

  void getPicPath({ musicInfo, listId: playerState.playMusicInfo.listId }).then((url: string) => {
    if (
      musicInfo.id != playerState.playMusicInfo.musicInfo?.id ||
      playerState.musicInfo.pic == url ||
      playerState.loadErrorPicUrl == url
    )
      return
    setMusicInfo({ pic: url })
    global.app_event.picUpdated()
  })

  void getLyricInfo({ musicInfo })
    .then((lyricInfo) => {
      if (musicInfo.id != playerState.playMusicInfo.musicInfo?.id) return
      setMusicInfo({
        lrc: lyricInfo.lyric,
        tlrc: lyricInfo.tlyric,
        lxlrc: lyricInfo.lxlyric,
        rlrc: lyricInfo.rlyric,
        rawlrc: lyricInfo.rawlrcInfo.lyric,
      })
      global.app_event.lyricUpdated()
    })
    .catch((err) => {
      console.log(err)
      if (musicInfo.id != playerState.playMusicInfo.musicInfo?.id) return
      setStatusText(global.i18n.t('lyric__load_error'))
    })
}, 200)

export const handlePlay = async () => {
  if (!isInitialized()) {
    await checkNotificationPermission()
    void checkIgnoringBatteryOptimization()
    await playerInitial({
      volume: settingState.setting['player.volume'],
      playRate: settingState.setting['player.playbackRate'],
      cacheSize: settingState.setting['player.cacheSize']
        ? parseInt(settingState.setting['player.cacheSize'])
        : 0,
      isHandleAudioFocus: settingState.setting['player.isHandleAudioFocus'],
      isEnableAudioOffload: settingState.setting['player.isEnableAudioOffload'],
    })
  }

  global.lx.playerError = false
  global.lx.isPlayedStop &&= false
  resetRandomNextMusicInfo()

  if (global.lx.restorePlayInfo) {
    void handleRestorePlay(global.lx.restorePlayInfo)
    global.lx.restorePlayInfo = null
    return
  }

  const playMusicInfo = playerState.playMusicInfo
  const musicInfo = playMusicInfo.musicInfo

  if (!musicInfo) return

  await setStop()
  global.app_event.pause()

  clearDelayNextTimeout()
  clearLoadTimeout()

  if (settingState.setting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay)
    addPlayedList(playMusicInfo as LX.Player.PlayMusicInfo)

  debouncePlay(musicInfo)
}

/**
 * Play song in list
 * @param listId list id
 * @param index song position to play
 */
export const playList = async (listId: string, index: number) => {
  const prevListId = playerState.playInfo.playerListId
  setPlayListId(listId)
  setPlayMusicInfo(listId, getList(listId)[index])
  if (settingState.setting['player.isAutoCleanPlayedList'] || prevListId != listId)
    clearPlayedList()
  clearTempPlayeList()
  await handlePlay()
}

const handleToggleStop = async () => {
  await stop()
  setTimeout(() => {
    setPlayMusicInfo(null, null)
  })
}

const randomNextMusicInfo = {
  info: null as LX.Player.PlayMusicInfo | null,
  // index: -1,
}
export const resetRandomNextMusicInfo = () => {
  if (randomNextMusicInfo.info) {
    randomNextMusicInfo.info = null
    // randomNextMusicInfo.index = -1
  }
}

export const getNextPlayMusicInfo = async (): Promise<LX.Player.PlayMusicInfo | null> => {
  if (playerState.tempPlayList.length) {
  const playMusicInfo = playerState.tempPlayList[0]
  return playMusicInfo
  }

  if (playerState.playMusicInfo.musicInfo == null) return null

  if (randomNextMusicInfo.info) return randomNextMusicInfo.info

  const playMusicInfo = playerState.playMusicInfo
  const playInfo = playerState.playInfo
  // console.log(playInfo.playerListId)
  const currentListId = playInfo.playerListId
  if (!currentListId) return null
  const currentList = getList(currentListId)

  const playedList = playerState.playedList
  if (playedList.length) {
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo!.id
    }
    let index
    for (
      index = playedList.findIndex((m) => m.musicInfo.id === currentId) + 1;
      index < playedList.length;
      index++
    ) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some((m) => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) return playedList[index]
  }
  let { filteredList, playerIndex } = await filterList({
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: true,
  })

  if (!filteredList.length) return null
  // let currentIndex: number = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex

  let togglePlayMethod = settingState.setting['player.togglePlayMethod']
  switch (togglePlayMethod) {
    case 'listLoop':
    case 'heartbeat':
      nextIndex = playerIndex === filteredList.length - 1 ? 0 : playerIndex + 1
      break
    case 'random':
      nextIndex = getRandom(0, filteredList.length)
      break
    case 'list':
      nextIndex = playerIndex === filteredList.length - 1 ? -1 : playerIndex + 1
      break
    case 'singleLoop':
      break
    default:
      return null
  }
  if (nextIndex < 0) return null

  const nextPlayMusicInfo = {
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  }

  if (togglePlayMethod == 'random') {
    randomNextMusicInfo.info = nextPlayMusicInfo
    // randomNextMusicInfo.index = nextIndex
  }
  return nextPlayMusicInfo
}

const handlePlayNext = async (playMusicInfo: LX.Player.PlayMusicInfo) => {
  setPlayMusicInfo(playMusicInfo.listId, playMusicInfo.musicInfo, playMusicInfo.isTempPlay)
  await handlePlay()
}
/**
 * Play next song
 * @param isAutoToggle whether auto toggle
 * @returns
 */
export const playNext = async (isAutoToggle = false): Promise<void> => {
  if (playerState.tempPlayList.length) {
    const playMusicInfo = playerState.tempPlayList[0]
    removeTempPlayList(0)
    await handlePlayNext(playMusicInfo)
    return
  }

  if (playerState.playMusicInfo.musicInfo == null) return null

  if (randomNextMusicInfo.info) {
    const randomInfo = randomNextMusicInfo.info
    randomNextMusicInfo.info = null
    await handlePlayNext(randomInfo)
    return
  }

  const playMusicInfo = playerState.playMusicInfo
  const playInfo = playerState.playInfo
  const currentListId = playInfo.playerListId
  if (!currentListId) return handleToggleStop()
  const currentList = getList(currentListId)

  const playedList = playerState.playedList

  if (playedList.length) {
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    let index
    for (
      index = playedList.findIndex((m) => m.musicInfo.id === currentId) + 1;
      index < playedList.length;
      index++
    ) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some((m) => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) {
      await handlePlayNext(playedList[index])
      return
    }
  }
  if (randomNextMusicInfo.info) {
    await handlePlayNext(randomNextMusicInfo.info)
    return
  }
  let { filteredList, playerIndex } = await filterList({
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: true,
  })

  if (!filteredList.length) {
    if (currentList.length > 0) {
      const nextIndex = (playInfo.playerPlayIndex + 1) % currentList.length
      await handlePlayNext({
        musicInfo: currentList[nextIndex],
        listId: currentListId,
        isTempPlay: false,
      })
      return
    }
    return handleToggleStop()
  }
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex

  let togglePlayMethod = settingState.setting['player.togglePlayMethod']
  if (!isAutoToggle) {
    switch (togglePlayMethod) {
      case 'list':
      case 'singleLoop':
      case 'none':
      case 'heartbeat':
        togglePlayMethod = 'listLoop' as any
    }
  }
  switch (togglePlayMethod) {
    case 'listLoop':
    case 'heartbeat':
      nextIndex = playerIndex === filteredList.length - 1 ? 0 : playerIndex + 1
      break
    case 'random':
      nextIndex = getRandom(0, filteredList.length)
      break
    case 'list':
      nextIndex = playerIndex === filteredList.length - 1 ? -1 : playerIndex + 1
      break
    case 'singleLoop':
      break
    default:
      nextIndex = -1
      return
  }
  if (nextIndex < 0) return

  await handlePlayNext({
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  })
}

/**
 * Play previous song
 */
export const playPrev = async (isAutoToggle = false): Promise<void> => {
  const playMusicInfo = playerState.playMusicInfo
  if (playMusicInfo.musicInfo == null) return handleToggleStop()
  const playInfo = playerState.playInfo

  const currentListId = playInfo.playerListId
  if (!currentListId) return handleToggleStop()
  const currentList = getList(currentListId)

  const playedList = playerState.playedList
  if (playedList.length) {
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    let index
    for (
      index = playedList.findIndex((m) => m.musicInfo.id === currentId) - 1;
      index > -1;
      index--
    ) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some((m) => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index > -1) {
      await handlePlayNext(playedList[index])
      return
    }
  }

  let { filteredList, playerIndex } = await filterList({
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: false,
  })
  if (!filteredList.length) return handleToggleStop()

  // let currentIndex = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex
  if (!playMusicInfo.isTempPlay) {
    let togglePlayMethod = settingState.setting['player.togglePlayMethod']
    if (!isAutoToggle) {
      switch (togglePlayMethod) {
        case 'list':
        case 'singleLoop':
        case 'none':
        case 'heartbeat':
          togglePlayMethod = 'listLoop' as any
      }
    }
    switch (togglePlayMethod) {
      case 'random':
        nextIndex = getRandom(0, filteredList.length)
        break
      case 'listLoop':
      case 'list':
      case 'heartbeat':
        nextIndex = playerIndex === 0 ? filteredList.length - 1 : playerIndex - 1
        break
      case 'singleLoop':
        break
      default:
        nextIndex = -1
        return
    }
    if (nextIndex < 0) return
  }

  await handlePlayNext({
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  })
}

/**
 * Resume playback
 */
export const play = () => {
  if (playerState.playMusicInfo.musicInfo == null) return
  
  const currentMusicInfo = playerState.playMusicInfo.musicInfo
  const currentId = 'progress' in currentMusicInfo 
    ? currentMusicInfo.metadata.musicInfo.id 
    : currentMusicInfo.id
  
  const loadedTrackId = global.lx.playerTrackId || ''
  const isTrackMismatch = !isEmpty() && !loadedTrackId.startsWith(currentId)
  
  if (isEmpty() || isTrackMismatch) {
    if (createGettingUrlId(currentMusicInfo) != global.lx.gettingUrlId)
      setMusicUrl(currentMusicInfo)
    return
  }
  setStatusText('')
  void setPlay()
}

/**
 * Pause playback
 */
export const pause = async () => {
  await setPause()
}

/**
 * Stop playback
 */
export const stop = async () => {
  await setStop()
  setTimeout(() => {
    global.app_event.stop()
  })
}

/**
 * Toggle play/pause
 */
export const togglePlay = () => {
  global.lx.isPlayedStop &&= false
  if (playerState.isPlay) {
    void pause()
  } else {
    play()
  }
}

/**
 * Collect current playing song
 */
export const collectMusic = () => {
  if (!playerState.playMusicInfo.musicInfo) return
  void addListMusics(
    LIST_IDS.LOVE,
    [
      'progress' in playerState.playMusicInfo.musicInfo
        ? playerState.playMusicInfo.musicInfo.metadata.musicInfo
        : playerState.playMusicInfo.musicInfo,
    ],
    settingState.setting['list.addMusicLocationType']
  )
}

/**
 * Uncollect current playing song
 */
export const uncollectMusic = () => {
  if (!playerState.playMusicInfo.musicInfo) return
  void removeListMusics(LIST_IDS.LOVE, [
    'progress' in playerState.playMusicInfo.musicInfo
      ? playerState.playMusicInfo.musicInfo.metadata.musicInfo.id
      : playerState.playMusicInfo.musicInfo.id,
  ])
}

/**
 * Dislike current playing song
 */
export const dislikeMusic = async () => {
  if (!playerState.playMusicInfo.musicInfo) return
  const minfo =
    'progress' in playerState.playMusicInfo.musicInfo
      ? playerState.playMusicInfo.musicInfo.metadata.musicInfo
      : playerState.playMusicInfo.musicInfo
  await addDislikeInfo([{ name: minfo.name, singer: minfo.singer }])
  await playNext(true)
}

/**
 * Headless playlist switch - state update only, no TrackPlayer calls
 * Used by WebViewSyncManager to switch tracks without triggering native audio chain
 */
export const playListHeadlessServer = (listId: string, index: number) => {
  setPlayListId(listId)
  setPlayMusicInfo(listId, getList(listId)[index])
  if (settingState.setting['player.isAutoCleanPlayedList'])
    clearPlayedList()
  clearTempPlayeList()
}
