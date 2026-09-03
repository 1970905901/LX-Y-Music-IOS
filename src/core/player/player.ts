import { isInitialized, initial as playerInitial, isEmpty, setPause, setPlay, setResource, setStop, initTrackInfo, getPosition } from '@/plugins/player'
import {
  setStatusText,
} from '@/core/player/playStatus'
import { setProgress as updatePlayProgress } from '@/core/player/progress'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import {
  getList,
  setPlayMusicInfo,
  setMusicInfo,
  setPlayListId,
} from '@/core/player/playInfo'
import {
  clearPlayedList,
  addPlayedList,
  removePlayedList,
} from '@/core/player/playedList'
import {
  clearTempPlayeList,
  removeTempPlayList,
} from '@/core/player/tempPlayList'
import { getMusicUrlInfo, getPicPath, getLyricInfo } from '@/core/music'
import { getOtherSource, QUALITY_RANK, tryUserDefinedSourceToggle } from '@/core/music/utils'
import { requestMsg } from '@/utils/message'
import { getRandom } from '@/utils/common'
import { filterList } from './utils'
import BackgroundTimer from 'react-native-background-timer'
import { checkIgnoringBatteryOptimization, checkNotificationPermission, debounceBackgroundTimer } from '@/utils/tools'
import { LIST_IDS } from '@/config/constant'
import { addListMusics, removeListMusics } from '@/core/list'
import { addDislikeInfo } from '@/core/dislikeList'
import { markTimeoutExitInteraction } from './timeoutExit'

// import { checkMusicFileAvailable } from '@renderer/utils/music'

// 播放失败「切换平台」策略的平台尝试顺序：企鹅(tx) → 网易(wy) → 酷狗(kg) → 酷我(kw) → 咪咕(mg)
// 仅作用于 executeFailureStrategy 的 togglePlatform 分支，不影响侧边栏/搜索等 UI 的平台顺序。
const FAILURE_TOGGLE_PLATFORM_PRIORITY: Record<string, number> = {
  tx: 0,
  wy: 1,
  kg: 2,
  kw: 3,
  mg: 4,
}

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/flac': 'flac',
  'audio/opus': 'opus',
  'audio/x-mpeg': 'mp3',
  'audio/x-ogg': 'ogg',
}

const ENCRYPTED_EXTENSIONS = new Set([
  'mflac', 'mflac0', 'mgg', 'mgg0', 'mgg1', 'ncm',
  'kgm', 'kgma', 'kgg', 'vpr', 'kwm', 'kwl', 'kwb',
  'kwmv', 'kwac', 'kwring', 'kwshort',
])

// 锁屏/弱网下 RN 的 fetch 默认没有超时，可能永久 pending，把整条取链链挂死，
// 表现为「播完当前歌，下一首取不到链接、停在暂停态不跳歌」。这里强制给一个上限，
// 超时后 abort，走 catch 的「放行」分支（校验只是尽力而为的过滤，不作为硬性门槛）。
const AUDIO_URL_CHECK_TIMEOUT = 5000

const validateAudioUrl = async (url: string): Promise<boolean> => {
  const controller = new AbortController()
  const timeoutId = BackgroundTimer.setTimeout(() => controller.abort(), AUDIO_URL_CHECK_TIMEOUT)
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal,
    })
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
  } finally {
    BackgroundTimer.clearTimeout(timeoutId)
  }
}

type FailureStrategy = 'togglePlatform' | 'lowerQuality' | 'toggleSource' | 'playNext'

export const executeFailureStrategy = async (
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem,
  isRefresh: boolean,
  error: any,
  triedUrls?: Set<string>,
  startIndex = 0
): Promise<{ url: string; quality?: LX.Quality | null; index: number } | null> => {
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
          let otherSources = await getOtherSource(musicInfo)
          // 按目标顺序重排切换平台尝试顺序：企鹅 → 网易 → 酷狗 → 酷我 → 咪咕
          otherSources = [...otherSources].sort((a, b) => {
            const pa = FAILURE_TOGGLE_PLATFORM_PRIORITY[a.source] ?? Number.MAX_SAFE_INTEGER
            const pb = FAILURE_TOGGLE_PLATFORM_PRIORITY[b.source] ?? Number.MAX_SAFE_INTEGER
            return pa - pb
          })
          console.log('[播放策略] [切换平台] 可用其他平台(已按优先级排序):', otherSources.map((s) => s.source))
          for (const source of otherSources) {
            if (global.lx.isPlayedStop || currentMusicInfo?.id != playerState.playMusicInfo.musicInfo?.id) {
              console.log('[播放策略] [切换平台] 播放已停止或歌曲已切换，终止')
              return null
            }
            try {
              setStatusText(`尝试切换平台 ${source.source}`)
              console.log('[播放策略] [切换平台] >>> 正在尝试平台:', source.source, '| 歌曲:', source.name, '| 歌手:', source.singer)
              const playUrlInfo = await getMusicUrlInfo({
                musicInfo: source,
                isRefresh,
                allowToggleSource: false,
              })
              if (playUrlInfo?.url && !triedUrls!.has(playUrlInfo.url)) {
                const isValid = await validateAudioUrl(playUrlInfo.url)
                if (!isValid) {
                  console.log('[播放策略] [切换平台]', source.source, 'URL不可播放，跳过')
                  triedUrls!.add(playUrlInfo.url)
                  continue
                }
                triedUrls!.add(playUrlInfo.url)
                console.log('[播放策略] [切换平台] 成功! 平台:', source.source)
                setStatusText(`切换到 ${source.source} 成功`)
                return { url: playUrlInfo.url, quality: playUrlInfo.quality, index: i }
              }
              if (playUrlInfo?.url) {
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
              const playUrlInfo = await getMusicUrlInfo({
                musicInfo,
                quality,
                isRefresh,
                allowToggleSource: false,
              })
              if (playUrlInfo?.url && !triedUrls!.has(playUrlInfo.url)) {
                const isValid = await validateAudioUrl(playUrlInfo.url)
                if (!isValid) {
                  console.log(`[播放策略] [降低音质] ${quality} URL不可播放，跳过`)
                  triedUrls!.add(playUrlInfo.url)
                  continue
                }
                triedUrls!.add(playUrlInfo.url)
                console.log(`[播放策略] [降低音质] 成功! 降级到: ${quality}`)
                setStatusText(`降级到 ${quality} 成功`)
                return { url: playUrlInfo.url, quality: playUrlInfo.quality, index: i }
              }
              if (playUrlInfo?.url) {
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
          // 设置项在输入框里被清空时会存成空字符串（''），直接拿来比较会被当成 0，
          // 导致 `triedCount >= maxRetry` 首轮即成立、一次换源都不尝试。
          // 这里统一归一化：非正数 / NaN 一律回落到默认 5 次。
          const rawMaxRetry = Number(settingState.setting['player.toggleSourceMaxRetry'])
          const maxRetry = Number.isFinite(rawMaxRetry) && rawMaxRetry > 0 ? Math.trunc(rawMaxRetry) : 5
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
            return { url: result.url, quality: result.quality, index: i }
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
    // console.log(this.timeout)
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
const { addDelayNextTimeout: addLoadTimeout, clearDelayNextTimeout: clearLoadTimeout } = createDelayNextTimeout(100000)

const createGettingUrlId = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem) => {
  const tInfo = 'progress' in musicInfo ? musicInfo.metadata.musicInfo.meta.toggleMusicInfo : musicInfo.meta.toggleMusicInfo
  return `${musicInfo.id}_${tInfo?.id ?? ''}`
}

interface PlayUrlInfo {
  url: string
  quality: LX.Quality | null
}
const currentStreamInfo = {
  musicId: null as string | null,
  url: '',
  quality: null as LX.Quality | null,
}
/**
 * 检查音乐信息是否已更改
 */
const diffCurrentMusicInfo = (curMusicInfo: LX.Music.MusicInfo | LX.Download.ListItem): boolean => {
  // return curMusicInfo !== playerState.playMusicInfo.musicInfo || playerState.isPlay
  return createGettingUrlId(curMusicInfo) != global.lx.gettingUrlId || curMusicInfo.id != playerState.playMusicInfo.musicInfo?.id || playerState.isPlay
}

let cancelDelayRetry: (() => void) | null = null
const delayRetry = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false): Promise<PlayUrlInfo | null> => {
  // if (cancelDelayRetry) cancelDelayRetry()
  return new Promise<PlayUrlInfo | null>((resolve, reject) => {
    const time = getRandom(2, 6)
    setStatusText(global.i18n.t('player__getting_url_delay_retry', { time }))
    const tiemout = setTimeout(() => {
      getMusicPlayUrl(musicInfo, isRefresh, true).then((result) => {
        cancelDelayRetry = null
        resolve(result)
      }).catch(async(err: any) => {
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
const getMusicPlayUrl = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false, isRetryed = false): Promise<PlayUrlInfo | null> => {
  // this.musicInfo.url = await getMusicPlayUrl(targetSong, type)
  setStatusText(global.i18n.t('player__getting_url'))
  addLoadTimeout()

  // const type = getPlayType(settingState.setting['player.isPlayHighQuality'], musicInfo)
  let toggleMusicInfo = ('progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo).meta.toggleMusicInfo

  return (toggleMusicInfo ? getMusicUrlInfo({
    musicInfo: toggleMusicInfo,
    isRefresh,
    allowToggleSource: false,
  }) : Promise.reject(new Error('not found'))).catch(async() => {
    return getMusicUrlInfo({
      musicInfo,
      isRefresh,
      onToggleSource(mInfo) {
        if (diffCurrentMusicInfo(musicInfo)) return
        setStatusText(global.i18n.t('toggle_source_try'))
      },
    })
  }).then(url => {
    if (global.lx.isPlayedStop || diffCurrentMusicInfo(musicInfo)) return null

    return url
  }).catch(async err => {
    // console.log('err', err.message)
    if (global.lx.isPlayedStop ||
      diffCurrentMusicInfo(musicInfo) ||
      err.message == requestMsg.cancelRequest) return null

    if (err.message == requestMsg.tooManyRequests) return delayRetry(musicInfo, isRefresh)

    if (!isRetryed) return getMusicPlayUrl(musicInfo, isRefresh, true)

    throw err
  })
}

export const setMusicUrl = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh?: boolean) => {
  // addLoadTimeout()
  if (!diffCurrentMusicInfo(musicInfo)) return
  if (cancelDelayRetry) cancelDelayRetry()
  global.lx.gettingUrlId = createGettingUrlId(musicInfo)
  const currentTimePromise = isRefresh
    ? getPosition().catch(() => playerState.progress.nowPlayTime)
    : Promise.resolve(playerState.progress.nowPlayTime)
  void getMusicPlayUrl(musicInfo, isRefresh).then(async(result) => {
    if (!result) return
    const currentTime = await currentTimePromise
    currentStreamInfo.musicId = musicInfo.id
    currentStreamInfo.url = result.url
    currentStreamInfo.quality = result.quality
    setResource(musicInfo, result.url, currentTime, result.quality)
  }).catch((err: any) => {
    setStatusText(err.message as string)
    global.app_event.error()
    addDelayNextTimeout()
  }).finally(() => {
    if (musicInfo === playerState.playMusicInfo.musicInfo) {
      global.lx.gettingUrlId = ''
      clearLoadTimeout()
    }
  })
}

// 恢复上次播放的状态
const handleRestorePlay = async(restorePlayInfo: LX.Player.SavedPlayInfo) => {
  const musicInfo = playerState.playMusicInfo.musicInfo
  if (!musicInfo) return

  // Avoid seeking the 2-second placeholder track during startup restore.
  const restoreTime = settingState.setting['player.isSavePlayTime'] ? restorePlayInfo.time : 0
  updatePlayProgress(restoreTime, restorePlayInfo.maxTime)
  global.app_event.seekLyric(restoreTime)

  const playMusicInfo = playerState.playMusicInfo

  void initTrackInfo(musicInfo, playerState.musicInfo)

  void getPicPath({ musicInfo, listId: playMusicInfo.listId }).then((url: string) => {
    if (
      musicInfo.id != playMusicInfo.musicInfo?.id ||
      playerState.musicInfo.pic == url ||
      playerState.loadErrorPicUrl == url
    ) return
    setMusicInfo({ pic: url })
    global.app_event.picUpdated()
  })

  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    global.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (musicInfo.id != playMusicInfo.musicInfo?.id) return
    setStatusText(global.i18n.t('lyric__load_error'))
  })

  if (settingState.setting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList(playMusicInfo as LX.Player.PlayMusicInfo)
}


const debouncePlay = debounceBackgroundTimer((musicInfo: LX.Player.PlayMusic) => {
  setMusicUrl(musicInfo)

  void getPicPath({ musicInfo, listId: playerState.playMusicInfo.listId }).then((url: string) => {
    if (
      musicInfo.id != playerState.playMusicInfo.musicInfo?.id ||
      playerState.musicInfo.pic == url ||
      playerState.loadErrorPicUrl == url) return
    setMusicInfo({ pic: url })
    global.app_event.picUpdated()
  })

  void getLyricInfo({ musicInfo }).then((lyricInfo) => {
    if (musicInfo.id != playerState.playMusicInfo.musicInfo?.id) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    global.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (musicInfo.id != playerState.playMusicInfo.musicInfo?.id) return
    setStatusText(global.i18n.t('lyric__load_error'))
  })
}, 200)

// 处理音乐播放
const handlePlay = async() => {
  if (!isInitialized()) {
    await checkNotificationPermission()
    void checkIgnoringBatteryOptimization()
    await playerInitial({
      volume: settingState.setting['player.volume'],
      playRate: settingState.setting['player.playbackRate'],
      cacheSize: settingState.setting['player.cacheSize'] ? parseInt(settingState.setting['player.cacheSize']) : 0,
      isHandleAudioFocus: settingState.setting['player.isHandleAudioFocus'],
      isEnableAudioOffload: settingState.setting['player.isEnableAudioOffload'],
    })
  }

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


  if (settingState.setting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList(playMusicInfo as LX.Player.PlayMusicInfo)

  debouncePlay(musicInfo)
}

/**
 * 播放列表内歌曲
 * @param listId 列表id
 * @param id 歌曲id
 */
export const playListById = async(listId: string, id: string) => {
  const prevListId = playerState.playInfo.playerListId
  setPlayListId(listId)
  const musicInfo = getList(listId).find(m => m.id == id)
  if (!musicInfo) return
  setPlayMusicInfo(listId, musicInfo)
  if (settingState.setting['player.isAutoCleanPlayedList'] || prevListId != listId) clearPlayedList()
  clearTempPlayeList()
  await handlePlay()
}

/**
 * 播放列表内歌曲
 * @param listId 列表id
 * @param index 播放的歌曲位置
 */
export const playList = async(listId: string, index: number) => {
  const prevListId = playerState.playInfo.playerListId
  setPlayListId(listId)
  setPlayMusicInfo(listId, getList(listId)[index])
  if (settingState.setting['player.isAutoCleanPlayedList'] || prevListId != listId) clearPlayedList()
  clearTempPlayeList()
  await handlePlay()
}

const handleToggleStop = async() => {
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

export const getNextPlayMusicInfo = async(): Promise<LX.Player.PlayMusicInfo | null> => {
  if (playerState.tempPlayList.length) { // 如果稍后播放列表存在歌曲则直接播放改列表的歌曲
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
  if (playedList.length) { // 移除已播放列表内不存在原列表的歌曲
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo!.id
    }
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) + 1; index < playedList.length; index++) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) return playedList[index]
  }
  // const isCheckFile = findNum > 2 // 针对下载列表，如果超过两次都碰到无效歌曲，则过滤整个列表内的无效歌曲
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
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

const handlePlayNext = async(playMusicInfo: LX.Player.PlayMusicInfo) => {
  setPlayMusicInfo(playMusicInfo.listId, playMusicInfo.musicInfo, playMusicInfo.isTempPlay)
  await handlePlay()
}
/**
 * 下一曲
 * @param isAutoToggle 是否自动切换
 * @returns
 */
export const playNext = async(isAutoToggle = false): Promise<void> => {
  if (!isAutoToggle) markTimeoutExitInteraction()
  if (playerState.tempPlayList.length) { // 如果稍后播放列表存在歌曲则直接播放改列表的歌曲
    const playMusicInfo = playerState.tempPlayList[0]
    removeTempPlayList(0)
    await handlePlayNext(playMusicInfo)
    return
  }

  const playMusicInfo = playerState.playMusicInfo
  const playInfo = playerState.playInfo
  if (playMusicInfo.musicInfo == null) return handleToggleStop()

  // console.log(playInfo.playerListId)
  const currentListId = playInfo.playerListId
  if (!currentListId) return handleToggleStop()
  const currentList = getList(currentListId)

  const playedList = playerState.playedList

  if (playedList.length) { // 移除已播放列表内不存在原列表的歌曲
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) + 1; index < playedList.length; index++) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
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
  // const isCheckFile = findNum > 2 // 针对下载列表，如果超过两次都碰到无效歌曲，则过滤整个列表内的无效歌曲
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: true,
  })

  if (!filteredList.length) return handleToggleStop()
  // let currentIndex: number = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex

  let togglePlayMethod = settingState.setting['player.togglePlayMethod']
  if (!isAutoToggle) {
    switch (togglePlayMethod) {
      case 'list':
      case 'singleLoop':
      case 'none':
        togglePlayMethod = 'listLoop'
    }
  }
  switch (togglePlayMethod) {
    case 'listLoop':
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
 * 上一曲
 */
export const playPrev = async(isAutoToggle = false): Promise<void> => {
  if (!isAutoToggle) markTimeoutExitInteraction()
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
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) - 1; index > -1; index--) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
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

  // const isCheckFile = findNum > 2
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
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
          togglePlayMethod = 'listLoop'
      }
    }
    switch (togglePlayMethod) {
      case 'random':
        nextIndex = getRandom(0, filteredList.length)
        break
      case 'listLoop':
      case 'list':
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
 * 恢复播放
 */
export const play = () => {
  if (playerState.playMusicInfo.musicInfo == null) return
  if (isEmpty()) {
    if (createGettingUrlId(playerState.playMusicInfo.musicInfo) != global.lx.gettingUrlId) setMusicUrl(playerState.playMusicInfo.musicInfo)
    return
  }
  void setPlay()
}

/**
 * 暂停播放
 */
export const pause = async() => {
  await setPause()
}

/**
 * 停止播放
 */
export const stop = async() => {
  await setStop()
  setTimeout(() => {
    global.app_event.stop()
  })
}

/**
 * 播放、暂停播放切换
 */
export const togglePlay = () => {
  markTimeoutExitInteraction()
  global.lx.isPlayedStop &&= false
  if (playerState.isPlay) {
    void pause()
  } else {
    play()
  }
}

/**
 * 收藏当前播放的歌曲
 */
export const collectMusic = () => {
  if (!playerState.playMusicInfo.musicInfo) return
  void addListMusics(LIST_IDS.LOVE, [
    'progress' in playerState.playMusicInfo.musicInfo
      ? playerState.playMusicInfo.musicInfo.metadata.musicInfo
      : playerState.playMusicInfo.musicInfo,
  ], settingState.setting['list.addMusicLocationType'])
}

/**
 * 取消收藏当前播放的歌曲
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
 * 不喜欢当前播放的歌曲
 */
export const dislikeMusic = async() => {
  if (!playerState.playMusicInfo.musicInfo) return
  const minfo = 'progress' in playerState.playMusicInfo.musicInfo ? playerState.playMusicInfo.musicInfo.metadata.musicInfo : playerState.playMusicInfo.musicInfo
  await addDislikeInfo([{ name: minfo.name, singer: minfo.singer }])
  await playNext(true)
}

