import { memo, useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { View, StyleSheet, TextInput, Clipboard, TouchableOpacity, Animated } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Text from '@/components/common/Text'
import Button from '../../components/Button'
import CheckBox from '@/components/common/CheckBox'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import musicSdk from '@/utils/musicSdk'
import { log, getSourceTestLogs, clearSourceTestLogs, sourceTestLog } from '@/utils/log'
import { getMusicQualityInfo } from '@/utils/musicSdk/wy/quality_detail'
import { getMusicUrl } from '@/core/music/online'
import { clearMusicUrl, storageDataPrefix } from '@/utils/data'
import { toast } from '@/utils/tools'
import LogConfirmAlert, { type LogConfirmAlertType } from '@/components/common/LogConfirmAlert'
import { SvgIcon } from '@/components/common/SvgIcon'
import settingAction from '@/store/setting/action'
import { useStatus } from '@/store/userApi'

const sources = [
  { id: 'kw', name: '酷我' },
  { id: 'kg', name: '酷狗' },
  { id: 'tx', name: 'QQ' },
  { id: 'wy', name: '网易' },
  { id: 'mg', name: '咪咕' },
]



const qualityLevels = ['master', 'atmos_plus', 'atmos', 'hires', 'flac', '320k', '128k']

const qualityPriority: Record<string, number> = {
  master: 7,
  atmos_plus: 6,
  atmos: 5,
  hires: 4,
  flac: 3,
  '320k': 2,
  '128k': 1,
  unknown: 0,
}

const parseFileSize = (sizeStr: string): number => {
  const match = sizeStr.match(/^([\d.]+)\s*(MB|KB)$/i)
  if (!match) return 0
  const num = parseFloat(match[1])
  return match[2].toUpperCase() === 'KB' ? num / 1024 : num
}

interface SourceKeywords {
  kw: string
  kg: string
  tx: string
  wy: string
  mg: string
}

interface TestResult {
  source: string
  name: string
  delay: number | null
  maxQuality: string | null
  status: 'pending' | 'testing' | 'success' | 'failed'
  message: string
  searchedSong: string
  warnings?: string[]
  encryptedWarnings?: string[]
  pluginBugIssues?: string[]
  typeDowngradeWarnings?: string[]
  permissionWarnings?: string[]
  progress?: string
}

const STORAGE_KEY = 'lx_music_source_test_keywords'
const SETTINGS_STORAGE_KEY = 'lx_music_source_test_settings'
const RATE_LIMIT_ERROR_KEYWORDS = ['请求频率超限', '频率超限', 'too many requests', 'rate limit', '请求过于频繁']

// 加密文件格式黑名单（播放器无法播放）
const ENCRYPTED_EXTENSIONS = new Set([
  'mflac', 'mflac0', 'mgg', 'mgg0', 'mgg1', 'ncm',
  'kgm', 'kgma', 'kgg', 'vpr', 'kwm', 'kwl', 'kwb',
  'kwmv', 'kwac', 'kwring', 'kwshort'
])

// 可播放文件格式白名单
const PLAYABLE_EXTENSIONS = new Set([
  'mp3', 'flac', 'ogg', 'aac', 'm4a', 'wav', 'opus', 'mpeg', 'wma'
])

const isRateLimitError = (errorMessage: string): boolean => {
  return RATE_LIMIT_ERROR_KEYWORDS.some(keyword => errorMessage.includes(keyword))
}

const isEncryptedFormat = (ext: string): boolean => {
  return ENCRYPTED_EXTENSIONS.has(ext.toLowerCase())
}

const getEncryptedQualityLabel = (quality: string): string => {
  const labels: Record<string, string> = {
    master: '母带',
    atmos_plus: 'ATMOS增强版',
    atmos: 'ATMOS',
    hires: 'Hi-Res',
    flac: 'FLAC',
    '320k': '320K',
    '128k': '128K',
  }
  return labels[quality] || quality
}

const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const loadSavedKeywords = async (): Promise<SourceKeywords> => {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return { kw: '晴天', kg: '晴天', tx: '晴天', wy: '再也没有', mg: '晴天' }
}

const saveKeywords = async (keywords: SourceKeywords) => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(keywords))
  } catch (error) {
    log.error('[源测试] 保存关键词失败:', error)
  }
}

interface TestSettings {
  intervalSeconds: string
  qualityIntervalSeconds: string
  testTimeoutSeconds: string
  qualityTimeoutSeconds: string
  showErrors: boolean
  showDowngrades: boolean
}

const loadSavedSettings = async (): Promise<TestSettings> => {
  try {
    const saved = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return {
    intervalSeconds: '0',
    qualityIntervalSeconds: '0',
    testTimeoutSeconds: '20',
    qualityTimeoutSeconds: '5',
    showErrors: true,
    showDowngrades: false,
  }
}

const saveSettings = async (settings: TestSettings) => {
  try {
    await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch (error) {
    log.error('[源测试] 保存设置失败:', error)
  }
}

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const subContainerOpacity = useSettingValue('theme.subContainerOpacity')
  const apiStatus = useStatus()  // 监听API状态变化，触发重新渲染
  const [isTesting, setIsTesting] = useState(false)
  
  // 当API状态变化时，重新计算支持的平台
  const [supportedSourcesText, setSupportedSourcesText] = useState(() => {
    return sources.filter(s => global.lx.qualityList[s.id]?.length > 0).map(s => s.name).join('、') || '无'
  })
  
  useEffect(() => {
    setSupportedSourcesText(
      sources.filter(s => global.lx.qualityList[s.id]?.length > 0).map(s => s.name).join('、') || '无'
    )
  }, [apiStatus])
  const [results, setResults] = useState<TestResult[]>([])
  const [keywords, setKeywords] = useState<SourceKeywords>({
    kw: '晴天',
    kg: '晴天',
    tx: '晴天',
    wy: '再也没有',
    mg: '晴天',
  })
  const [isLoaded, setIsLoaded] = useState(false)
  const [intervalSeconds, setIntervalSeconds] = useState('0')
  const [qualityIntervalSeconds, setQualityIntervalSeconds] = useState('0')
  const [testTimeoutSeconds, setTestTimeoutSeconds] = useState('20')
  const [qualityTimeoutSeconds, setQualityTimeoutSeconds] = useState('5')
  const [showErrors, setShowErrors] = useState(true)
  const [showDowngrades, setShowDowngrades] = useState(true)
  const [isStopRequested, setIsStopRequested] = useState(false)
  const [logText, setLogText] = useState('')
  const [testingSourceId, setTestingSourceId] = useState<string | null>(null)
  const [elapsedTime, setElapsedTime] = useState(0)
  
  const shouldContinueTesting = useRef(true)
  const logModalRef = useRef<LogConfirmAlertType>(null)
  const faqModalRef = useRef<LogConfirmAlertType>(null)
  const testStartTimeRef = useRef<number>(0)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())
  
  // 折叠展开状态
  const expandedStatus = useSettingValue('common.sectionExpandedStatus')
  const initialExpanded = expandedStatus['setting_basic_source_test'] ?? true
  const [expanded, setExpanded] = useState(initialExpanded)
  const rotateAnimRef = useRef(new Animated.Value(initialExpanded ? 0 : 1))
  const rotateInterpolate = useMemo(() => 
    rotateAnimRef.current.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '180deg'],
    }),
  []
  )
  
  useEffect(() => {
    Animated.spring(rotateAnimRef.current, {
      toValue: expanded ? 0 : 1,
      useNativeDriver: true,
      friction: 7,
      tension: 40,
    }).start()
  }, [expanded])

  useEffect(() => {
    const load = async () => {
      const [savedKeywords, savedSettings] = await Promise.all([
        loadSavedKeywords(),
        loadSavedSettings(),
      ])
      setKeywords(savedKeywords)
      setIntervalSeconds(savedSettings.intervalSeconds)
      setQualityIntervalSeconds(savedSettings.qualityIntervalSeconds)
      setTestTimeoutSeconds(savedSettings.testTimeoutSeconds)
      setQualityTimeoutSeconds(savedSettings.qualityTimeoutSeconds)
      setShowErrors(savedSettings.showErrors)
      setShowDowngrades(savedSettings.showDowngrades)
      setIsLoaded(true)
    }
    load()
  }, [])

  useEffect(() => {
    if (isLoaded) {
      saveKeywords(keywords)
    }
  }, [keywords, isLoaded])

  const handleKeywordChange = useCallback((sourceId: string, value: string) => {
    setKeywords(prev => ({ ...prev, [sourceId]: value }))
  }, [])

  useEffect(() => {
    if (isLoaded) {
      saveSettings({
        intervalSeconds,
        qualityIntervalSeconds,
        testTimeoutSeconds,
        qualityTimeoutSeconds,
        showErrors,
        showDowngrades,
      })
    }
  }, [intervalSeconds, qualityIntervalSeconds, testTimeoutSeconds, qualityTimeoutSeconds, showErrors, showDowngrades, isLoaded])

  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
  }, [])

  const handleStop = useCallback(() => {
    shouldContinueTesting.current = false
    setIsStopRequested(true)
    setIsTesting(false)
    stopElapsedTimer()
    // 终止所有正在进行的测试
    abortControllersRef.current.forEach(controller => controller.abort())
    abortControllersRef.current.clear()
    sourceTestLog.info('========== 用户请求停止测试 ==========')
  }, [stopElapsedTimer])

  const copyToClipboard = async (text: string) => {
    try {
      await Clipboard.setString(text)
      toast('复制成功')
    } catch {
      toast('复制失败')
    }
  }

  const getSourceTestLog = async () => {
    try {
      const log = await getSourceTestLogs()
      const logArr = log.split(/^----lx source test log----\n|\n----lx source test log----\n|\n----lx source test log----$/)
      logArr.reverse()
      const formattedLog = logArr
        .filter(line => line.trim())
        .join('\n\n')
        .replace(/^\n+|\n+$/, '')
      setLogText(formattedLog)
    } catch {
      setLogText('')
    }
  }

  const openLogModal = () => {
    getSourceTestLog()
    logModalRef.current?.setVisible(true)
  }

  const handleCleanLog = () => {
    void clearSourceTestLogs().then(() => {
      toast('日志已清空')
      getSourceTestLog()
    })
  }

  const handleNumericChange = useCallback((setter: React.Dispatch<React.SetStateAction<string>>) => (value: string) => {
    setter(value.replace(/[^0-9]/g, ''))
  }, [])

  const getSizeErrorMB = (): number => {
    return 0
  }

  const getQualityTestInterval = (): number => {
    const seconds = parseInt(qualityIntervalSeconds)
    return (isNaN(seconds) ? 0 : seconds) * 1000
  }

  const getTestTimeout = (): number => {
    const seconds = parseInt(testTimeoutSeconds)
    return (isNaN(seconds) || seconds <= 0 ? 20 : seconds) * 1000
  }

  const getQualityTimeout = (): number => {
    const seconds = parseInt(qualityTimeoutSeconds)
    return (isNaN(seconds) || seconds <= 0 ? 5 : seconds) * 1000
  }

  const testSource = useCallback(async (source: typeof sources[0], keyword: string, qualityIntervalMs: number, abortController?: AbortController, onProgress?: (msg: string) => void): Promise<{
    delay: number | null
    maxQuality: string | null
    message: string
    success: boolean
    searchedSong: string
  }> => {
    const totalStartTime = Date.now()
    sourceTestLog.info(`========== [${source.name}] 开始测试 ==========`)
    sourceTestLog.info(`搜索关键词: "${keyword}"`)

    try {
      const sdk = musicSdk[source.id]
      if (!sdk) {
        log.error(`[${source.name}] 错误: 未找到平台SDK`)
        throw new Error(`平台 ${source.name} SDK不存在`)
      }

      if (!sdk.musicSearch) {
        log.error(`[${source.name}] 错误: 该平台不支持搜索接口`)
        throw new Error(`${source.name} 不支持搜索接口`)
      }

      let searchResult
      try {
        searchResult = await sdk.musicSearch.search(keyword, 1, 1)
      } catch (searchError: any) {
        throw new Error(`搜索接口调用失败: ${searchError.message}`)
      }

      if (!searchResult?.list?.length) {
        throw new Error('搜索结果为空，该平台可能无此歌曲版权')
      }

      const songInfo = searchResult.list[0]
      
      const songName = songInfo.name || songInfo.songName || songInfo.title || songInfo.filename || '未知歌曲'
      const songSinger = songInfo.singer || songInfo.artist || songInfo.artists || songInfo.artistName || '未知歌手'
      const songId = songInfo.songmid || songInfo.id || songInfo.songId || songInfo.musicId || ''
      
      if (!songName) {
        throw new Error('无法解析歌曲信息')
      }

      const songDisplay = `${songName} - ${songSinger}`
      sourceTestLog.info(`[${source.name}] 找到歌曲: ${songDisplay}`)

      if (!sdk.getMusicUrl) {
        throw new Error(`${source.name} 不支持播放接口`)
      }

      const musicInfoForApi: any = {
        id: `${source.id}_${songId}`,
        name: songName,
        singer: songSinger,
        source: source.id,
        interval: songInfo.interval || '',
        alias: songInfo.alias || '',
        albumName: songInfo.albumName || songInfo.album || '',
        albumId: songInfo.albumId || '',
        img: songInfo.img || songInfo.pic || '',
        lrc: songInfo.lrc || null,
        typeUrl: songInfo.typeUrl || {},
        meta: {
          songId: songId,
          songmid: songId,
          albumName: songInfo.albumName || songInfo.album || '',
          albumId: songInfo.albumId || '',
          picUrl: songInfo.img || songInfo.pic || '',
          qualitys: songInfo.types || [],
          _qualitys: songInfo._types || {},
          fee: songInfo.fee || 0,
          noCopyrightRcmd: songInfo.noCopyrightRcmd || null,
          originCoverType: songInfo.originCoverType || 0,
          mv: songInfo.mv || 0,
          strMediaMid: songInfo.strMediaMid || '',
          albumMid: songInfo.albumMid || '',
          vid: songInfo.vid || '',
          hash: songInfo.hash || '',
          copyrightId: songInfo.copyrightId || '',
          lrcUrl: songInfo.lrcUrl || '',
          mrcUrl: songInfo.mrcUrl || '',
          trcUrl: songInfo.trcUrl || '',
          ...songInfo.meta,
        },
        artists: songInfo.artists || [],
      }

      const oldMusicInfo = {
        name: songName,
        singer: songSinger,
        songmid: songId,
        source: source.id,
        interval: songInfo.interval || '',
        albumName: songInfo.albumName || songInfo.album || '',
        img: songInfo.img || songInfo.pic || '',
        typeUrl: songInfo.typeUrl || {},
        types: songInfo.types || [],
        _types: songInfo._types || {},
        meta: musicInfoForApi.meta,
        ...songInfo,
      }

      if (source.id === 'wy') {
        try {
          const qualityInfo = getMusicQualityInfo(songId)
          const result = await qualityInfo.requestObj.promise
          if (result && Object.keys(result._types).length > 0) {
            for (const [q, info] of Object.entries(result._types)) {
              oldMusicInfo._types[q] = info
              oldMusicInfo.meta._qualitys[q] = info
              if (!oldMusicInfo.types.some((t: any) => t.type === q)) {
                oldMusicInfo.types.push({ type: q, size: (info as any).size })
                oldMusicInfo.meta.qualitys.push({ type: q, size: (info as any).size })
              }
            }
          }
        } catch {}
      }

      const qualitySizes: Record<string, string> = {}
      for (const [q, info] of Object.entries(oldMusicInfo._types || {})) {
        if (typeof info === 'object' && (info as any).size) {
          qualitySizes[q] = (info as any).size
        }
      }
      sourceTestLog.info(`[${source.name}] 元数据音质: ${JSON.stringify(qualitySizes)}`)
      sourceTestLog.info(`[${source.name}] ========== 开始测试音质 ==========`)

      let maxQuality: string | null = null
      const qualityResults: Record<string, { success: boolean; url?: string; error?: string; time: number; actualFormat?: string }> = {}
      const detectedQualities: Record<string, { url: string; time: number }> = {}
      const encryptedWarnings: string[] = []
      const permissionWarnings: string[] = []

      for (let i = 0; i < qualityLevels.length; i++) {
        if (abortController?.signal.aborted) {
          throw new Error('测试被终止')
        }
        
        const quality = qualityLevels[i]
        const qualityStartTime = Date.now()
        
        if (i > 0) {
          await sleep(qualityIntervalMs)
        }
        
        if (abortController?.signal.aborted) {
          throw new Error('测试被终止')
        }
        
        try {
          sourceTestLog.info(`[${source.name}] 尝试音质: ${quality}`)
          onProgress?.(`正在测试：${quality}`)
          
          const qualityTimeoutMs = getQualityTimeout()
          const qualityTimeoutPromise = new Promise<{ url: string }>((_, reject) => {
            setTimeout(() => reject(new Error(`音质请求超时(${qualityTimeoutMs / 1000}秒)`)), qualityTimeoutMs)
          })
          
          let result: any
          try {
            const url = await Promise.race([
              getMusicUrl({
                musicInfo: musicInfoForApi,
                quality,
                isRefresh: true,
                allowToggleSource: false,
                silent: true,
              }),
              qualityTimeoutPromise,
            ])
            result = { url, type: quality }
          } catch (apiError: any) {
            const errorMsg = apiError?.message || apiError?.toString() || JSON.stringify(apiError) || '未知错误'
            sourceTestLog.info(`[${source.name}]   [FAIL] ${quality}: API调用失败: ${errorMsg}`)
            qualityResults[quality] = { success: false, error: errorMsg, time: Date.now() - qualityStartTime }
            continue
          }
          
          const qualityEndTime = Date.now()
          const qualityTime = qualityEndTime - qualityStartTime
          
          if (!result) {
            sourceTestLog.info(`[${source.name}]   [FAIL] ${quality}: 接口返回空结果 [耗时${qualityTime}ms]`)
            qualityResults[quality] = { success: false, error: '接口返回空结果', time: qualityTime }
            continue
          }
          
          const url = result?.url
          
          const hasInvalidLevel = url && /level=(undefined|null|$|&)/i.test(url)
          const isValidUrl = url && url.length > 10 && !hasInvalidLevel
          
          if (!isValidUrl) {
            qualityResults[quality] = { success: false, error: 'URL无效', time: qualityTime }
            sourceTestLog.info(`[${source.name}]   [FAIL] ${quality}: URL无效`)
            continue
          }
          
          let actualQualityFromUrl = quality
          let actualSizeRounded: number | null = null
          const qualitySizesNum: Record<string, number> = {}
          for (const [q, info] of Object.entries(oldMusicInfo._types || {})) {
            if (typeof info === 'object' && (info as any).size) {
              qualitySizesNum[q] = parseFileSize((info as any).size)
            }
          }
          
          let contentTypeExt = ''
          let realFileName = ''
          if (Object.keys(qualitySizesNum).length > 0) {
            try {
              const headResponse = await fetch(url, { method: 'HEAD' })
              const contentLength = headResponse.headers.get('content-length')
              const contentType = headResponse.headers.get('content-type')
              
              console.log(`[源测试] [${source.name}]   HEAD请求: status=${headResponse.status}, content-length=${contentLength}, content-type=${contentType}`)
              
              // 从Content-Disposition获取真实文件名（最准确）
              const contentDisposition = headResponse.headers.get('content-disposition')
              if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename[*]?=(?:UTF-8''|")?([^";\s]+)/i)
                if (filenameMatch) {
                  realFileName = decodeURIComponent(filenameMatch[1].replace(/"/g, ''))
                }
              }
              
              // 从Content-Type获取文件类型
              const contentTypeMap: Record<string, string> = {
                'audio/mpeg': 'mp3',
                'audio/flac': 'flac',
                'audio/x-flac': 'flac',
                'audio/ogg': 'ogg',
                'audio/aac': 'aac',
                'audio/x-m4a': 'm4a',
                'audio/mp4': 'm4a',
                'audio/wav': 'wav',
                'audio/x-wav': 'wav',
                'audio/opus': 'opus',
                'audio/x-mpeg': 'mp3',
                'application/octet-stream': '',
                'audio/x-ogg': 'ogg',
              }
              contentTypeExt = contentTypeMap[contentType || ''] || ''
              
              console.log(`[源测试] [${source.name}]   Content-Disposition: ${contentDisposition || '无'}`)
              
              if (!contentLength || contentLength === '0') {
                // HEAD请求失败，可能URL过期，清除缓存并重试
                sourceTestLog.info(`[${source.name}]   [INFO] ${quality}: HEAD请求无法获取文件大小(status=${headResponse.status})`)
                sourceTestLog.info(`[${source.name}]   [URL] ${url}`)
                
                // 检测403权限错误
                if (headResponse.status === 403) {
                  permissionWarnings.push(`${getEncryptedQualityLabel(quality)} --> 403`)
                  sourceTestLog.info(`[${source.name}]   [WARN] ${quality}: 403 Forbidden - 无访问权限`)
                } else {
                  sourceTestLog.info(`[${source.name}]   [INFO] 可能URL过期，清除缓存重试...`)
                }
                
                await clearMusicUrl([`${storageDataPrefix.musicUrl}${musicInfoForApi.id}_${quality}`])
                
                // 重新请求URL
                try {
                  const newUrl = await getMusicUrl({
                    musicInfo: musicInfoForApi,
                    quality,
                    isRefresh: true,
                    allowToggleSource: false,
                    silent: true,
                  })
                  result = { url: newUrl, type: quality }
                  sourceTestLog.info(`[${source.name}]   [INFO] ${quality}: 重新获取URL成功`)
                  sourceTestLog.info(`[${source.name}]   [URL] ${newUrl}`)
                  // 重新进行HEAD请求
                  const newHeadResponse = await fetch(newUrl, { method: 'HEAD' })
                  const newContentLength = newHeadResponse.headers.get('content-length')
                  if (newContentLength && newContentLength !== '0') {
                    const actualSizeMB = parseInt(newContentLength) / (1024 * 1024)
                    actualSizeRounded = Math.round(actualSizeMB * 100) / 100
                    sourceTestLog.info(`[${source.name}]   [INFO] ${quality}: 重新获取文件大小成功: ${actualSizeRounded.toFixed(2)}MB`)
                  }
                } catch (retryError) {
                  sourceTestLog.info(`[${source.name}]   [INFO] ${quality}: 重新获取URL失败，跳过大小验证`)
                  sourceTestLog.info(`[${source.name}]   [URL] ${url}`)
                  actualQualityFromUrl = quality
                }
              } else {
                const actualSizeMB = parseInt(contentLength) / (1024 * 1024)
                actualSizeRounded = Math.round(actualSizeMB * 100) / 100
              }
              
              // 如果有文件大小信息，进行大小验证
              if (actualSizeRounded !== null) {
                let matchedQuality: string | null = null
                const errorMB = getSizeErrorMB()
                for (const [q, expectedSize] of Object.entries(qualitySizesNum)) {
                  const expectedSizeRounded = Math.round(expectedSize * 100) / 100
                  if (Math.abs(actualSizeRounded - expectedSizeRounded) <= errorMB) {
                    matchedQuality = q
                    break
                  }
                }
                
                // 更新实际音质
                if (matchedQuality) {
                  actualQualityFromUrl = matchedQuality
                }
                
                if (!matchedQuality) {
                  const urlExtTemp = contentTypeExt || (url ? url.split('?')[0].split('.').pop() : '未知')

                  if (Object.keys(qualitySizesNum).length > 0) {
                    let closestQuality: string | null = null
                    let smallestRatio = Infinity

                    for (const [q, expectedSize] of Object.entries(qualitySizesNum)) {
                      if (expectedSize > 0) {
                        const ratio = actualSizeRounded / expectedSize
                        if (ratio > 0.5 && ratio < 2.0) {
                          const diff = Math.abs(ratio - 1.0)
                          if (diff < smallestRatio) {
                            smallestRatio = diff
                            closestQuality = q
                          }
                        }
                      }
                    }

                    if (closestQuality) {
                      const expectedSizeMB = qualitySizesNum[closestQuality] ? qualitySizesNum[closestQuality].toFixed(2) : '未知'
                      sourceTestLog.info(`[${source.name}]   [URL] ${url}`)
                      sourceTestLog.info(`[${source.name}]   长度: ${url?.length || 0} | 音质: 疑似${getEncryptedQualityLabel(closestQuality)} | 类型: ${urlExtTemp} | 大小: ${actualSizeRounded.toFixed(2)}MB | 预期: ${expectedSizeMB}MB`)
                      sourceTestLog.info(`[${source.name}]   [SUSPECT] ${quality}: 格式可播放，大小最接近疑似${getEncryptedQualityLabel(closestQuality)}(偏差${(smallestRatio * 100).toFixed(1)}%)`)
                      
                      qualityResults[quality] = {
                        success: false,
                        error: `疑似${closestQuality}，实际=疑似${closestQuality}`,
                        time: qualityTime,
                        suspected: closestQuality,
                        url,
                        actualSize: actualSizeRounded,
                        expectedSize: qualitySizesNum[closestQuality],
                        actualFormat: urlExtTemp,
                      }
                      
                      if (!detectedQualities[`suspected_${closestQuality}`]) {
                        detectedQualities[`suspected_${closestQuality}`] = { url, time: qualityTime }
                      }
                      
                      // 检测加密格式并添加到警告列表
                      if (isEncryptedFormat(urlExtTemp)) {
                        encryptedWarnings.push(`${getEncryptedQualityLabel(quality)} --> ${urlExtTemp}`)
                      }
                      
                      continue
                    }
                  }

                  qualityResults[quality] = { success: false, error: `不匹配，实际=${actualQualityFromUrl}`, time: qualityTime }
                  const expectedSizeMB = qualitySizesNum[quality] ? qualitySizesNum[quality].toFixed(2) : '无'
                  sourceTestLog.info(`[${source.name}]   [URL] ${url}`)
                  sourceTestLog.info(`[${source.name}]   长度: ${url?.length || 0} | 音质: ${actualQualityFromUrl} | 类型: ${urlExtTemp} | 大小: ${actualSizeRounded.toFixed(2)}MB | 预期: ${expectedSizeMB}MB`)
                  sourceTestLog.info(`[${source.name}]   [FAIL] ${quality}: 不匹配(请求: ${quality}, 实际: ${actualQualityFromUrl}, 大小: ${actualSizeRounded.toFixed(2)}MB, 预期: ${expectedSizeMB}MB)`)
                  continue
                }
                
                actualQualityFromUrl = matchedQuality
              }
            } catch (err) {
              console.error(`[源测试] [${source.name}]   [ERROR] ${quality}:`, err)
              qualityResults[quality] = { success: false, error: '获取文件信息失败', time: qualityTime }
              sourceTestLog.info(`[${source.name}]   [FAIL] ${quality}: 获取文件信息失败`)
              sourceTestLog.info(`[${source.name}]   [URL] ${url}`)
              continue
            }
          }
          
          sourceTestLog.info(`[${source.name}]   URL: ${url}`)
          const expectedSize = qualitySizes[quality] || '未知'
          
          // 已知的音频格式列表
          const knownAudioFormats = ['mp3', 'flac', 'aac', 'm4a', 'ogg', 'wav', 'opus', 'mflac', 'mgg']
          
          // 判断类型的优先级：Content-Disposition > URL扩展名 > Content-Type
          let urlExt = ''
          
          // 1. 优先使用Content-Disposition中的文件名扩展名（最准确）
          if (realFileName) {
            const realFileExt = realFileName.split('.').pop()?.toLowerCase() || ''
            if (realFileExt && knownAudioFormats.includes(realFileExt)) {
              urlExt = realFileExt
            }
          }
          
          // 2. 如果Content-Disposition没有有效扩展名，使用URL扩展名
          if (!urlExt && url) {
            const urlWithoutQuery = url.split('?')[0]
            const urlParts = urlWithoutQuery.split('.')
            const urlExtCandidate = urlParts.length > 1 ? urlParts[urlParts.length - 1] : ''
            if (urlExtCandidate && knownAudioFormats.includes(urlExtCandidate.toLowerCase())) {
              urlExt = urlExtCandidate
            }
          }
          
          // 3. 最后使用Content-Type
          if (!urlExt && contentTypeExt) {
            urlExt = contentTypeExt
          }
          
          urlExt = urlExt || '未知'
          
          sourceTestLog.info(`[${source.name}]   长度: ${url?.length || 0} | 音质: ${actualQualityFromUrl} | 类型: ${urlExt} (文件名: ${realFileName || '无'}, URL: ${url?.split('?')[0]?.split('.').pop() || '无'}, Content-Type: ${contentTypeExt || '未知'}) | 大小: ${actualSizeRounded?.toFixed(2) || '未知'}MB | 预期: ${expectedSize}`)
          
          // 检测加密格式
          if (isEncryptedFormat(urlExt)) {
            sourceTestLog.info(`[${source.name}]   [WARN] 检测到加密格式: ${urlExt}，该文件无法播放`)
            // 记录加密格式，继续测试下一个音质
            qualityResults[quality] = { 
              success: false, 
              error: `加密格式(${urlExt})，该文件无法播放`, 
              time: qualityTime,
              encrypted: true,
              encryptedExt: urlExt,
              actualQuality: actualQualityFromUrl,
              actualFormat: urlExt,
            }
            // 添加到加密格式警告列表
            encryptedWarnings.push(`${getEncryptedQualityLabel(quality)} --> ${urlExt}`)
            continue
          }
          
          const isQualityMatch = actualQualityFromUrl === quality
          
          if (isQualityMatch) {
            qualityResults[quality] = { success: true, url: url, time: qualityTime, actualFormat: urlExt }
            maxQuality = quality
            highestPriority = qualityPriority[quality] || 0
            sourceTestLog.info(`[${source.name}]   [OK] ${quality}: 匹配`)
            break
          } else {
            qualityResults[quality] = { success: false, error: `不匹配，实际=${actualQualityFromUrl}`, time: qualityTime, actualFormat: urlExt }
            sourceTestLog.info(`[${source.name}]   [FAIL] ${quality}: 不匹配(请求: ${quality}, 实际: ${actualQualityFromUrl})`)
            // 只有当实际音质比请求音质高时，才记录到detectedQualities
            const actualPriority = qualityPriority[actualQualityFromUrl] || 0
            const requestedPriority = qualityPriority[quality] || 0
            if (actualQualityFromUrl && actualPriority > requestedPriority && !detectedQualities[actualQualityFromUrl]) {
              detectedQualities[actualQualityFromUrl] = { url: url, time: qualityTime }
            }
            continue
          }
        } catch (qualityError: any) {
          const errorMessage = qualityError.message || '未知错误'
          
          if (isRateLimitError(errorMessage)) {
            qualityResults[quality] = { success: false, error: errorMessage, time: Date.now() - qualityStartTime }
            const totalDelay = Date.now() - totalStartTime
            sourceTestLog.info(`[${source.name}]   [FAIL] ${quality}: 请求频率超限，测试终止`)
            return {
              delay: totalDelay,
              maxQuality: null,
              message: `请求频率超限，请稍后重试`,
              success: false,
              searchedSong: songDisplay,
            }
          }
          
          qualityResults[quality] = { success: false, error: errorMessage, time: Date.now() - qualityStartTime }
          sourceTestLog.info(`[${source.name}]   [FAIL] ${quality}: ${errorMessage}`)
          continue
        }
      }

      const totalDelay = Date.now() - totalStartTime

      // 统一检测管理器
      const detectionRules = {
        // 音质降级检测
        downgrade: {
          enabled: true,
          check: (requestedQuality: string, result: any) => {
            if (result.success) return null
            const actualQuality = result.error?.match(/实际[=:：]\s*疑似(\w+)/)?.[1] || 
                                  result.error?.match(/实际[=:：]\s*(\w+)/)?.[1] || 
                                  result.error?.match(/实际[:：]\s*(\w+)/)?.[1]
            const isSuspected = result.error?.includes('疑似') || false
            if (actualQuality && actualQuality !== requestedQuality) {
              const label = isSuspected ? `疑似${getEncryptedQualityLabel(actualQuality)}` : getEncryptedQualityLabel(actualQuality)
              return `${getEncryptedQualityLabel(requestedQuality)} --> ${label}`
            }
            return null
          }
        },
        // 插件bug检测
        pluginBug: {
          enabled: true,
          check: (requestedQuality: string, result: any, qualityResults: Record<string, any>) => {
            if (result.success) return null
            const actualQuality = result.error?.match(/实际[=:]\s*(\w+)/)?.[1]
            if (actualQuality && actualQuality !== requestedQuality) {
              const actualResult = qualityResults[actualQuality]
              if (actualResult && !actualResult.success) {
                const actualActualQuality = actualResult.error?.match(/实际[=:]\s*(\w+)/)?.[1]
                if (actualActualQuality && qualityPriority[actualActualQuality] < qualityPriority[actualQuality]) {
                  return `检测到请求${getEncryptedQualityLabel(requestedQuality)}返回${getEncryptedQualityLabel(actualQuality)}，但请求${getEncryptedQualityLabel(actualQuality)}返回${getEncryptedQualityLabel(actualActualQuality)}`
                }
              }
            }
            return null
          }
        },
        // 类型降级检测
        typeDowngrade: {
          enabled: true,
          standardFormats: {
            master: 'flac',
            atmos_plus: 'flac',
            atmos: 'flac',
            hires: 'flac',
            flac: 'flac',
            '320k': 'mp3',
            '128k': 'mp3',
          } as Record<string, string>,
          check: (requestedQuality: string, result: any) => {
            if (!result.actualFormat) return null
            const expectedFormat = detectionRules.typeDowngrade.standardFormats[requestedQuality]
            if (!expectedFormat) return null
            const formatLower = result.actualFormat.toLowerCase()
            if (formatLower !== expectedFormat) {
              return `${getEncryptedQualityLabel(requestedQuality)} --> ${result.actualFormat.toLowerCase()}`
            }
            return null
          }
        }
      }

      // 执行所有检测
      const runDetections = (qualityResults: Record<string, any>) => {
        const results = {
          downgradeIssues: [] as string[],
          pluginBugIssues: [] as string[],
          typeDowngradeWarnings: [] as string[],
        }

        for (const [requestedQuality, result] of Object.entries(qualityResults)) {
          if (detectionRules.downgrade.enabled) {
            const issue = detectionRules.downgrade.check(requestedQuality, result)
            if (issue) results.downgradeIssues.push(issue)
          }
          if (detectionRules.pluginBug.enabled) {
            const issue = detectionRules.pluginBug.check(requestedQuality, result, qualityResults)
            if (issue) results.pluginBugIssues.push(issue)
          }
          if (detectionRules.typeDowngrade.enabled) {
            const issue = detectionRules.typeDowngrade.check(requestedQuality, result)
            if (issue) results.typeDowngradeWarnings.push(issue)
          }
        }

        return results
      }

      const detectionResults = runDetections(qualityResults)
      const downgradeIssues = detectionResults.downgradeIssues
      const pluginBugIssues = detectionResults.pluginBugIssues
      const typeDowngradeWarnings = detectionResults.typeDowngradeWarnings
      
      if (!maxQuality && Object.keys(detectedQualities).length > 0) {
        let highestDetectedQuality: string | null = null
        let highestDetectedPriority = -1
        let isSuspected = false
        
        for (const detectedQuality of Object.keys(detectedQualities)) {
          const actualQualityName = detectedQuality.startsWith('suspected_')
            ? detectedQuality.replace('suspected_', '')
            : detectedQuality
          const priority = qualityPriority[actualQualityName] || 0
          if (priority > highestDetectedPriority) {
            highestDetectedPriority = priority
            highestDetectedQuality = actualQualityName
            isSuspected = detectedQuality.startsWith('suspected_')
          }
        }
        
        if (highestDetectedQuality) {
          maxQuality = isSuspected ? `suspected_${highestDetectedQuality}` : highestDetectedQuality
        }
      }
      
      let qualityLabel: string
      if (maxQuality?.startsWith('suspected_')) {
        const actualQuality = maxQuality.replace('suspected_', '')
        qualityLabel = `疑似${getEncryptedQualityLabel(actualQuality)}`
      } else {
        qualityLabel = maxQuality ? getQualityLabel(maxQuality) : '未知'
      }
      
      if (downgradeIssues.length > 0) {
        downgradeIssues.forEach(issue => {
          sourceTestLog.info(`[${source.name}] [WARN] ${issue}`)
        })
      }
      if (typeDowngradeWarnings.length > 0) {
        typeDowngradeWarnings.forEach(warning => {
          sourceTestLog.info(`[${source.name}] [WARN] 类型降级: ${warning}`)
        })
      }
      if (encryptedWarnings.length > 0) {
        // 优先输出"检测到最高音质"的警告
        const highestWarning = encryptedWarnings.find(w => w.includes('检测到最高音质'))
        if (highestWarning) {
          sourceTestLog.info(`[${source.name}] [WARN] ${highestWarning}`)
        }
        // 再输出其他加密格式警告
        encryptedWarnings.filter(w => !w.includes('检测到最高音质')).forEach(warning => {
          sourceTestLog.info(`[${source.name}] [WARN] ${warning}`)
        })
      }
      if (permissionWarnings.length > 0) {
        sourceTestLog.info(`[${source.name}] [WARN] 权限警告`)
        permissionWarnings.forEach(warning => {
          sourceTestLog.info(`[${source.name}] [WARN] ${warning}`)
        })
      }

      if (!maxQuality) {
        const allErrors = Object.values(qualityResults).map(r => r.error || '')
        const hasApiDown = allErrors.some(e => 
          e.includes('internal server error') || 
          e.includes('权限不足') ||
          e.includes('Key失效') ||
          e.includes('无可用音源') ||
          e.includes('音质请求超时') ||
          e === 'Error' ||
          e === '未知错误'
        )
        const hasNotSupported = allErrors.some(e => 
          e.includes('不支持音质') || 
          e.includes('API调用失败') ||
          e.includes('Cannot read property') ||
          e.includes('of undefined') ||
          e === 'source init failed'
        )
        const hasAllForbidden = allErrors.some(e => 
          e.includes('403') || 
          e.includes('Forbidden') ||
          e.includes('获取文件信息失败')
        )
        
        let errorMessage = '实际最高音质: 未知'
        if (hasNotSupported) errorMessage = '不支持该平台'
        else if (hasApiDown) errorMessage = '接口挂了'
        else if (hasAllForbidden) errorMessage = '接口返回全部数据不可用'
        
        sourceTestLog.info(`[${source.name}] ========== 测试完成: ${errorMessage} ==========`)
        
        return {
          delay: totalDelay,
          maxQuality: null,
          message: errorMessage,
          success: false,
          searchedSong: songDisplay,
          warnings: downgradeIssues.length > 0 ? downgradeIssues : undefined,
          encryptedWarnings: encryptedWarnings.length > 0 ? encryptedWarnings : undefined,
          pluginBugIssues: pluginBugIssues.length > 0 ? pluginBugIssues : undefined,
          typeDowngradeWarnings: typeDowngradeWarnings.length > 0 ? typeDowngradeWarnings : undefined,
          permissionWarnings: permissionWarnings.length > 0 ? permissionWarnings : undefined,
        }
      }

      sourceTestLog.info(`[${source.name}] ========== 测试完成: 实际最高音质 ${qualityLabel} (${maxQuality || '无'}) ==========`)

      return {
        delay: totalDelay,
        maxQuality,
        message: `实际最高音质: ${qualityLabel}`,
        success: true,
        searchedSong: songDisplay,
        warnings: downgradeIssues.length > 0 ? downgradeIssues : undefined,
        encryptedWarnings: encryptedWarnings.length > 0 ? encryptedWarnings : undefined,
        pluginBugIssues: pluginBugIssues.length > 0 ? pluginBugIssues : undefined,
        typeDowngradeWarnings: typeDowngradeWarnings.length > 0 ? typeDowngradeWarnings : undefined,
        permissionWarnings: permissionWarnings.length > 0 ? permissionWarnings : undefined,
      }
    } catch (error: any) {
      const totalDelay = Date.now() - totalStartTime
      sourceTestLog.info(`[${source.name}] ========== 测试失败: ${error.message} ==========`)

      return {
        delay: totalDelay,
        maxQuality: null,
        message: '不支持该平台',
        success: false,
        searchedSong: songDisplay,
      }
    }
  }, [])

  const handleTest = useCallback(async () => {
    shouldContinueTesting.current = true
    setIsStopRequested(false)
    setIsTesting(true)
    setElapsedTime(0)
    testStartTimeRef.current = Date.now()
    
    elapsedTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - testStartTimeRef.current) / 1000)
      setElapsedTime(elapsed)
    }, 1000)
    
    const runTest = async () => {
      setResults(sources.map(source => ({
        source: source.id,
        name: source.name,
        delay: null,
        maxQuality: null,
        status: 'pending',
        message: '',
        searchedSong: '',
        warnings: undefined,
        encryptedWarnings: undefined,
        pluginBugIssues: undefined,
      })))

      const qualityIntervalMs = getQualityTestInterval()

      sourceTestLog.info('========== 开始源测试 ==========')
      sources.forEach(s => {
        sourceTestLog.info(`[${s.name}] 关键词: "${keywords[s.id as keyof SourceKeywords]}"`)
      })

      for (let i = 0; i < sources.length; i++) {
        if (!shouldContinueTesting.current) {
          sourceTestLog.info('========== 测试被用户停止 ==========')
          setTestingSourceId(null)
          return
        }

        const source = sources[i]
        const keyword = keywords[source.id as keyof SourceKeywords]

        if (!keyword.trim()) {
          setResults(prev => prev.map(r =>
            r.source === source.id ? {
              ...r,
              status: 'failed',
              message: '关键词为空',
            } : r
          ))
          continue
        }

        setResults(prev => prev.map(r =>
          r.source === source.id ? { 
            ...r, 
            status: 'testing',
            message: '',
            searchedSong: '',
            warnings: undefined,
            encryptedWarnings: undefined,
            pluginBugIssues: undefined,
            typeDowngradeWarnings: undefined,
            permissionWarnings: undefined,
            maxQuality: null,
            progress: `正在测试 ${source.name}...`,
          } : r
        ))
        setTestingSourceId(source.id)
        const currentElapsed = Math.floor((Date.now() - testStartTimeRef.current) / 1000)

        const timeoutMs = getTestTimeout()
        const abortController = new AbortController()
        let isTimeout = false
        
        const timeoutPromise = new Promise<{ success: false }>((resolve) => {
          setTimeout(() => {
            isTimeout = true
            abortController.abort()
            resolve({ success: false })
          }, timeoutMs)
        })

        const testPromise = testSource(source, keyword, qualityIntervalMs, abortController, (msg) => {
          setResults(prev => prev.map(r =>
            r.source === source.id ? { ...r, progress: msg } : r
          ))
        })

        const result = await Promise.race([testPromise, timeoutPromise])

        if (!('success' in result) || isTimeout) {
          sourceTestLog.info(`[${source.name}] 测试超时已跳过`)
          setResults(prev => prev.map(r =>
            r.source === source.id ? {
              ...r,
              status: 'failed',
              delay: null,
              maxQuality: null,
              message: `测试超时已跳过(${timeoutMs/1000}秒)`,
              searchedSong: '',
              progress: undefined,
            } : r
          ))
          setTestingSourceId(null)
        } else {
          setResults(prev => prev.map(r =>
            r.source === source.id ? {
              ...r,
              status: result.success ? 'success' : 'failed',
              delay: result.delay,
              maxQuality: result.success ? result.maxQuality : null,
              message: result.message,
              searchedSong: result.searchedSong,
              warnings: result.warnings,
              encryptedWarnings: result.encryptedWarnings,
              pluginBugIssues: result.pluginBugIssues,
              typeDowngradeWarnings: result.typeDowngradeWarnings,
              permissionWarnings: result.permissionWarnings,
              progress: undefined,
            } : r
          ))

          setTestingSourceId(null)
        }

      if (i < sources.length - 1 && shouldContinueTesting.current) {
          const interval = parseInt(intervalSeconds) || 0
          if (interval > 0) {
            sourceTestLog.info(`========== 等待 ${interval} 秒后测试下一个源 ==========`)
            const startTime = Date.now()
            while (Date.now() - startTime < interval * 1000) {
              if (!shouldContinueTesting.current) break
              await new Promise(resolve => setTimeout(resolve, 100))
            }
          }
        }
      }

      sourceTestLog.info('========== 源测试完成 ==========')
      stopElapsedTimer()
      setIsTesting(false)
      setTestingSourceId(null)
    }

    await runTest()
  }, [testSource, keywords, intervalSeconds, qualityIntervalSeconds, testTimeoutSeconds, stopElapsedTimer])

  const handleTestSingleSource = useCallback(async (source: typeof sources[0]) => {
    const keyword = keywords[source.id as keyof SourceKeywords]
    if (!keyword.trim()) {
      toast(`请输入${source.name}搜索关键词`)
      return
    }

    setResults(prev => {
      if (prev.length === 0) {
        return sources.map(s => ({
          source: s.id,
          name: s.name,
          delay: null,
          maxQuality: null,
          status: s.id === source.id ? 'testing' : 'pending',
          message: '',
          searchedSong: '',
          warnings: undefined,
          encryptedWarnings: undefined,
          pluginBugIssues: undefined,
        }))
      }
      return prev.map(r => {
        if (r.source === source.id) {
          return { 
            ...r, 
            status: 'testing',
            message: '',
            searchedSong: '',
            maxQuality: null,
            warnings: undefined,
            encryptedWarnings: undefined,
            pluginBugIssues: undefined,
            typeDowngradeWarnings: undefined,
            permissionWarnings: undefined,
            progress: `正在测试：${source.name}...`,
          }
        }
        return r
      })
    })

    setTestingSourceId(source.id)
    const qualityIntervalMs = getQualityTestInterval()
    const timeoutMs = getTestTimeout()
    const abortController = new AbortController()
    abortControllersRef.current.set(source.id, abortController)
    let isTimeout = false
    
    const timeoutPromise = new Promise<{ success: false }>((resolve) => {
      setTimeout(() => {
        isTimeout = true
        abortController.abort()
        resolve({ success: false })
      }, timeoutMs)
    })

    const testPromise = testSource(source, keyword, qualityIntervalMs, abortController, (msg) => {
      setResults(prev => prev.map(r =>
        r.source === source.id ? { ...r, progress: msg } : r
      ))
    })

    const result = await Promise.race([testPromise, timeoutPromise])

    if (!('success' in result) || isTimeout) {
      sourceTestLog.info(`[${source.name}] 测试超时已跳过`)
      setResults(prev => prev.map(r =>
        r.source === source.id ? {
          ...r,
          status: 'failed',
          delay: null,
          maxQuality: null,
          message: `测试超时已跳过(${timeoutMs/1000}秒)`,
          searchedSong: '',
          progress: undefined,
        } : r
      ))
    } else {
      setResults(prev => prev.map(r =>
        r.source === source.id ? {
          ...r,
          status: result.success ? 'success' : 'failed',
          delay: result.delay,
          maxQuality: result.success ? result.maxQuality : null,
          message: result.message,
          searchedSong: result.searchedSong,
          warnings: result.warnings,
          encryptedWarnings: result.encryptedWarnings,
          pluginBugIssues: result.pluginBugIssues,
          typeDowngradeWarnings: result.typeDowngradeWarnings,
          permissionWarnings: result.permissionWarnings,
          progress: undefined,
        } : r
      ))
    }

    stopElapsedTimer()
    abortControllersRef.current.delete(source.id)
    setTestingSourceId(null)
  }, [isTesting, keywords, testSource, qualityIntervalSeconds, testTimeoutSeconds, stopElapsedTimer])

  const getQualityLabel = (quality: string | null) => {
    if (!quality) return '可能是(接口挂掉了/网络问题/不支持该源)'
    const labels: Record<string, string> = {
      master: '臻品母带',
      atmos_plus: 'ATMOS_PLUS',
      atmos: 'ATMOS',
      hires: 'Hi-Res',
      flac: 'FLAC',
      '320k': '320K',
      '192k': '192K',
      '128k': '128K',
    }
    return labels[quality] || quality
  }

  const getQualityColors: Record<string, string> = {
    master: '#9B59B6',
    atmos_plus: '#E74C3C',
    atmos: '#E67E22',
    hires: '#FF6B6B',
    flac: '#4ECDC4',
    '320k': '#45B7D1',
    '128k': '#95A5A6',
  }

  const statusColorMap: Record<TestResult['status'], string> = {
    pending: theme['c-font-label'],
    testing: theme['c-warning'],
    success: theme['c-success'],
    failed: theme['c-error'],
  }

  const statusTextMap: Record<TestResult['status'], string> = {
    pending: '等待测试',
    testing: '测试中...',
    success: '[OK]',
    failed: '[FAIL]',
  }

  if (!isLoaded) {
    return null
  }

  return (
    <View style={[styles.container, { backgroundColor: `rgba(255, 255, 255, ${subContainerOpacity / 100})` }]}>
      <TouchableOpacity 
        style={styles.titleRow} 
        onPress={() => {
          const newExpanded = !expanded
          setExpanded(newExpanded)
          const newStatus = { ...expandedStatus, ['setting_basic_source_test']: newExpanded }
          settingAction.updateSetting({ 'common.sectionExpandedStatus': newStatus })
        }}
        activeOpacity={0.7}
      >
        <Text style={[styles.title, { color: theme['c-font'] }]}>
          {t('setting_basic_source_test_title')}
        </Text>
        <View style={styles.iconContainer}>
          <Animated.View style={{ transform: [{ rotate: rotateInterpolate }] }}>
            <SvgIcon 
              name="collapse" 
              size={16} 
              color={theme['c-font-label']} 
            />
          </Animated.View>
        </View>
      </TouchableOpacity>

      {expanded && (
        <>
      <View style={styles.keywordsSection}>
        <Text style={[styles.sectionTitle, { color: theme['c-font-label'] }]}>
          各平台搜索关键词
        </Text>
        {sources.map(source => (
          <View key={source.id} style={styles.keywordRow}>
            <Text style={[styles.sourceLabel, { color: theme['c-font'] }]}>
              {source.name}
            </Text>
            <View style={styles.keywordContainer}>
              <TextInput
                style={[styles.keywordInput, { color: theme['c-font'], backgroundColor: theme['c-background'] }]}
                placeholder={`输入${source.name}搜索词`}
                placeholderTextColor={theme['c-font-label']}
                value={keywords[source.id as keyof SourceKeywords]}
                onChangeText={(value) => handleKeywordChange(source.id, value)}
                editable={!isTesting}
                clearButtonMode="while-editing"
              />
            </View>
            <View style={styles.singleTestBtnContainer}>
              <Button
                onPress={() => handleTestSingleSource(source)}
                disabled={testingSourceId === source.id || !keywords[source.id as keyof SourceKeywords].trim()}
                ripple={{ borderless: true, radius: 20 }}
                style={[styles.singleTestBtn, testingSourceId === source.id && styles.singleTestBtnDisabled]}
              >
                测试
              </Button>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.buttonRow}>
        <Button
          onPress={handleTest}
          disabled={isTesting || !Object.values(keywords).some(k => k.trim())}
          ripple={{ borderless: true, radius: 22 }}
          style={[styles.startTestBtn, isTesting && styles.disabledBtn]}
        >
          开始测试
        </Button>
        <Button
          onPress={handleStop}
          disabled={!isTesting}
          ripple={{ borderless: true, radius: 22 }}
          style={[styles.stopTestBtn, !isTesting && styles.disabledBtn]}
        >
          终止测试
        </Button>
        <Button
          onPress={() => faqModalRef.current?.setVisible(true)}
          ripple={{ borderless: true, radius: 18 }}
          style={styles.logBtn}
        >
          常见问题
        </Button>
      </View>

      <Text style={[styles.desc, { color: theme['c-font-label'], fontSize: 12 }]}>
        当前音源支持平台: {supportedSourcesText}
      </Text>

      <View style={styles.settingsRow}>
        <Text style={styles.settingsLabel}>
          测试超时(秒):
        </Text>
        <TextInput
          style={[styles.settingsInput, { color: theme['c-font'], backgroundColor: theme['c-background'] }]}
          placeholder="20"
          placeholderTextColor={theme['c-font-label']}
          value={testTimeoutSeconds}
          onChangeText={handleNumericChange(setTestTimeoutSeconds)}
          keyboardType="number-pad"
          maxLength={5}
          editable={!isTesting}
          />
      </View>

      <View style={styles.settingsRow}>
        <Text style={styles.settingsLabel}>
          音质测试超时(秒):
        </Text>
        <TextInput
          style={[styles.settingsInput, { color: theme['c-font'], backgroundColor: theme['c-background'] }]}
          placeholder="5"
          placeholderTextColor={theme['c-font-label']}
          value={qualityTimeoutSeconds}
          onChangeText={handleNumericChange(setQualityTimeoutSeconds)}
          keyboardType="number-pad"
          maxLength={5}
          editable={!isTesting}
          />
      </View>

      <View style={styles.settingsRow}>
        <Text style={styles.settingsLabel}>
          平台测试间隔(秒):
        </Text>
        <TextInput
          style={[styles.settingsInput, { color: theme['c-font'], backgroundColor: theme['c-background'] }]}
          placeholder="0"
          placeholderTextColor={theme['c-font-label']}
          value={intervalSeconds}
          onChangeText={handleNumericChange(setIntervalSeconds)}
          keyboardType="number-pad"
          maxLength={5}
          editable={!isTesting}
          />
      </View>

      <View style={styles.settingsRow}>
        <Text style={styles.settingsLabel}>
          音质测试间隔(秒):
        </Text>
        <TextInput
          style={[styles.settingsInput, { color: theme['c-font'], backgroundColor: theme['c-background'] }]}
          placeholder="0"
          placeholderTextColor={theme['c-font-label']}
          value={qualityIntervalSeconds}
          onChangeText={handleNumericChange(setQualityIntervalSeconds)}
          keyboardType="number-pad"
          maxLength={5}
          editable={!isTesting}
          />
      </View>

      <View style={styles.checkboxRow}>
        <CheckBox
          check={showErrors}
          onChange={setShowErrors}
          label="显示警告"
          disabled={isTesting}
          size={0.8}
        />
        <CheckBox
          check={showDowngrades}
          onChange={setShowDowngrades}
          label="显示降级"
          disabled={isTesting}
          size={0.8}
        />
        <Button
          onPress={openLogModal}
          ripple={{ borderless: true, radius: 18 }}
          style={styles.logBtn}
        >
          测试日志
        </Button>
      </View>

      {results.length > 0 && (
        <View style={styles.resultSection}>
          <View style={styles.resultHeaderRow}>
            <Text style={[styles.sectionTitle, { color: theme['c-font-label'] }]}>
              {t('setting_basic_source_test_result_title')}
            </Text>
            <Button
              onPress={() => setResults([])}
              style={styles.clearResultBtn}
            >
              清空
            </Button>
          </View>
          {isTesting && (
            <Text style={[styles.elapsedTimeText, { color: theme['c-font-label'] }]}>
              总耗时: {elapsedTime}s
            </Text>
          )}
          <View style={styles.resultList}>
            {results.map((result) => (
              <View key={result.source} style={styles.resultItem}>
                <View style={styles.resultHeader}>
                  <Text style={[styles.resultName, { color: theme['c-font'] }]}>
                    {result.name}
                  </Text>
                  <Text style={[styles.resultStatus, { color: statusColorMap[result.status] }]}>
                    {statusTextMap[result.status]}
                  </Text>
                </View>
                {result.status === 'testing' && (
                  <View style={styles.testingContainer}>
                    <Text style={[styles.testingText, { color: theme['c-warning'] }]}>
                      {result.progress || `正在测试 ${result.name}...`}
                    </Text>
                  </View>
                )}
                {result.searchedSong && (
                  <Text style={[styles.resultSong, { color: theme['c-font-label'] }]}>
                    找到: {result.searchedSong}
                  </Text>
                )}
                {result.status === 'failed' ? (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>
                      {result.message || '不支持该平台'}
                    </Text>
                  </View>
                ) : result.message ? (
                  <Text style={[styles.resultMessage, { color: statusColorMap[result.status] }]}>
                    {result.message}
                  </Text>
                ) : null}
                {result.status === 'success' && result.maxQuality && (() => {
                  const displayQuality = result.maxQuality.startsWith('suspected_')
                    ? result.maxQuality.replace('suspected_', '')
                    : result.maxQuality
                  const isSuspected = result.maxQuality.startsWith('suspected_')
                  return (
                    <View style={[styles.qualityBadge, { backgroundColor: getQualityColors[displayQuality] || '#ccc' }]}>
                      <Text style={styles.qualityBadgeText}>{isSuspected ? `疑似${getEncryptedQualityLabel(displayQuality)}` : getQualityLabel(displayQuality)}</Text>
                    </View>
                  )
                })()}
                {showErrors && result.encryptedWarnings && result.encryptedWarnings.length > 0 && (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>[WARN] 加密警告</Text>
                    {(() => {
                      const highestWarning = result.encryptedWarnings.find((w: string) => w.includes('检测到最高音质'))
                      const otherWarnings = result.encryptedWarnings.filter((w: string) => !w.includes('检测到最高音质'))
                      return (
                        <>
                          {highestWarning && (
                            <Text style={styles.errorText}>[WARN] {highestWarning}</Text>
                          )}
                          {otherWarnings.map((warning: string, index: number) => (
                            <Text key={`enc-${index}`} style={styles.errorText}>
                              [WARN] {warning}
                            </Text>
                          ))}
                        </>
                      )
                    })()}
                  </View>
                )}
                {showErrors && result.pluginBugIssues && result.pluginBugIssues.length > 0 && (
                  <View style={styles.errorContainer}>
                    {result.pluginBugIssues.map((warning, index) => (
                      <Text key={`bug-${index}`} style={styles.errorText}>
                        [WARN] {warning}
                      </Text>
                    ))}
                  </View>
                )}
                {showDowngrades && result.warnings && result.warnings.length > 0 && (
                  <View style={styles.warningContainer}>
                    <Text style={styles.warningText}>[WARN] 音质降级</Text>
                    {result.warnings.map((warning, index) => (
                      <Text key={index} style={styles.warningText}>
                        [WARN] {warning}
                      </Text>
                    ))}
                  </View>
                )}
                {showDowngrades && result.typeDowngradeWarnings && result.typeDowngradeWarnings.length > 0 && (
                  <View style={styles.warningContainer}>
                    <Text style={styles.warningText}>[WARN] 类型降级</Text>
                    {result.typeDowngradeWarnings.map((warning, index) => (
                      <Text key={index} style={styles.warningText}>
                        [WARN] {warning}
                      </Text>
                    ))}
                  </View>
                )}
                {showErrors && result.permissionWarnings && result.permissionWarnings.length > 0 && (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>[WARN] 权限警告</Text>
                    {result.permissionWarnings.map((warning, index) => (
                      <Text key={`perm-${index}`} style={styles.errorText}>
                        [WARN] {warning}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>
      )}

      <LogConfirmAlert
        ref={logModalRef}
        cancelText="关闭"
        confirmText="清空日志"
        onConfirm={handleCleanLog}
        showConfirm={!!logText}
        reverseBtn={true}
        middleText="复制全部"
        onMiddle={() => copyToClipboard(logText)}
        showMiddle={!!logText}
      >
        <View style={styles.logContent} onStartShouldSetResponder={() => true}>
          {logText ? (
            <Text selectable={true} style={{ fontSize: 13, lineHeight: 18 }}>
              {logText}
            </Text>
          ) : (
            <Text size={13}>暂无日志</Text>
          )}
        </View>
      </LogConfirmAlert>

      <LogConfirmAlert
        ref={faqModalRef}
        cancelText="关闭"
        showConfirm={false}
      >
        <View style={styles.logContent} onStartShouldSetResponder={() => true}>
          <Text style={{ fontSize: 14, lineHeight: 22, marginBottom: 12 }}>
            本功能在开发阶段经过大量测试，准确率高达90%+
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 22, fontWeight: '600', marginBottom: 8 }}>
            常见问题：
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 22, marginBottom: 12 }}>
            为什么音源元数据标注支持母带级音质，但实际仅能获取FLAC甚至更低规格音频
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 22, fontWeight: '600', marginBottom: 8 }}>
            最终测试结果受多重客观因素约束，具体如下：
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 22, marginBottom: 8 }}>
            1. 音源服务稳定性不足（普遍现象）：多数音源底层集成多套请求接口、多组鉴权账号池，不同接口/账号的会员、资源下发权限存在差异；音源服务端随机调度链路，客户端无法控制本次请求使用的接口与账号，因此同一音源短时间内两次测试，返回的最高可用音质存在明显波动。
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 22, marginBottom: 8 }}>
            2. 目标歌曲版权库未开放对应高音质资源权限，不支持该档位音频分发。
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 22, marginBottom: 8 }}>
            3. 音源接口BUG：部分音源存在资源档位错配Bug，典型表现为请求master臻品母带返回atmos杜比全景声资源，请求atmos档位却下发flac无损音频，规格标识与实际音频文件不匹配。
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 22, marginBottom: 8 }}>
            4. 时效问题：今日上午、当前其他设备均可正常获取 master 母带资源，仅当前使用设备、在当前时段无法拉取高音质音频；该场景成因多为音频播放临时 URL 失效、临时鉴权权限受限导致测试失败
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 22, marginTop: 12, fontWeight: '600' }}>
            解决方式：进入软件设置 - 其他设置页面，清除本地缓存后重新执行音质测试。
          </Text>
        </View>
      </LogConfirmAlert>
        </>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.3,
    flex: 1,
  },
  iconContainer: {
    paddingHorizontal: 8,
  },
  desc: {
    fontSize: 13,
    opacity: 0.6,
    marginBottom: 16,
    lineHeight: 18,
  },
  keywordsSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    marginBottom: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  keywordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: 'rgba(128, 128, 128, 0.05)',
    borderRadius: 10,
    padding: 6,
    flexWrap: 'nowrap',
  },

  sourceLabel: {
    width: 42,
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 0,
  },

  keywordContainer: {
    flex: 1,
    minWidth: 0,
    marginRight: 6,
    zIndex: 1,
  },

  keywordInput: {
    width: '100%',
    height: 40,
    paddingHorizontal: 4,
    fontSize: 14,
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128, 128, 128, 0.3)',
    zIndex: 2,
  },

  singleTestBtnContainer: {
    flexShrink: 0,
    zIndex: 1,
  },

  singleTestBtn: {
    paddingHorizontal: 10,
    height: 30,
    backgroundColor: '#4A90D9',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },

  singleTestBtnDisabled: {
    opacity: 0.5,
  },

  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },

  startTestBtn: {
    flex: 1,
    height: 44,
    backgroundColor: '#4A90D9',
    borderRadius: 10,
    overflow: 'hidden',
  },

  stopTestBtn: {
    flex: 1,
    height: 44,
    backgroundColor: '#E74C3C',
    borderRadius: 10,
    overflow: 'hidden',
  },

  disabledBtn: {
    opacity: 0.5,
  },

  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },

  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    flexWrap: 'nowrap',
  },

  settingsLabel: {
    fontSize: 13,
    color: '#666666',
    width: 104,
  },

  settingsInput: {
    width: 70,
    height: 36,
    paddingHorizontal: 4,
    fontSize: 14,
    textAlign: 'left',
    textAlignVertical: 'center',
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128, 128, 128, 0.3)',
    alignSelf: 'center',
  },

  logBtn: {
    height: 36,
    paddingHorizontal: 14,
    backgroundColor: '#7F8C8D',
    borderRadius: 10,
    overflow: 'hidden',
  },
  progressContainer: {
    padding: 10,
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    borderRadius: 6,
    marginBottom: 12,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressText: {
    fontSize: 13,
  },
  elapsedTimeText: {
    fontSize: 12,
    opacity: 0.6,
  },
  resultSection: {
    marginTop: 24,
  },
  resultHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  clearResultBtn: {
    height: 28,
    paddingHorizontal: 12,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#E74C3C',
    borderRadius: 4,
  },
  resultList: {
    backgroundColor: 'rgba(128, 128, 128, 0.05)',
    borderRadius: 10,
    padding: 10,
  },
  resultItem: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128, 128, 128, 0.12)',
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '600',
  },
  resultStatus: {
    fontSize: 14,
    fontWeight: '700',
  },
  resultSong: {
    fontSize: 12,
    marginBottom: 3,
    opacity: 0.65,
  },
  resultMessage: {
    fontSize: 13,
    marginBottom: 6,
  },
  qualityBadge: {
    display: 'inline-block',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  qualityBadgeText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  warningContainer: {
    marginTop: 8,
    padding: 10,
    backgroundColor: 'rgba(255, 193, 7, 0.12)',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#F39C12',
  },
  warningText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#D35400',
  },
  errorContainer: {
    marginTop: 8,
    padding: 10,
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#E74C3C',
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#C0392B',
  },
  testingContainer: {
    marginTop: 8,
    padding: 10,
    backgroundColor: 'rgba(255, 193, 7, 0.12)',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#F39C12',
  },
  testingText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#D35400',
  },
  logContent: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'column',
  },
})