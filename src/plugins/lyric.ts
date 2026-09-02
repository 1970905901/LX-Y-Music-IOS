import { useEffect, useRef, useState } from 'react'
import Lyric, { type Lines } from 'lrc-file-parser'
import { getPosition } from '@/plugins/player'
import LxLyricPlayer, { type LxLyricWord } from '@/plugins/lxLyricPlayer'
// import { getStore, subscribe } from '@/store'
export type Line = Lines[number]
type PlayHook = (line: number, text: string) => void
type SetLyricHook = (lines: Lines) => void

// 逐字歌词（lxlyric）解析器：仅用于把 lxlyric 解析成「逐字时间轴」数组，
// 不依赖它内部的 ticker（项目统一由 audioClock 外推时钟驱动，保证与音频绝对同步）。
const lxLyricParser = new LxLyricPlayer()

// 逐字映射就绪钩子：setLyric 解析完逐字后触发，让组件侧刷新逐字快照（独立于行级 onSetLyric）。
const wordMapHooks: (() => void)[] = []

const lrcTools = {
  isInited: false,
  lrc: null as Lyric | null,
  currentLineData: { line: 0, text: '' },
  currentLines: [] as Lines,
  playHooks: [] as PlayHook[],
  setLyricHooks: [] as SetLyricHook[],
  isPlay: false,
  isShowTranslation: false,
  isShowRoma: false,
  lyricText: '',
  translationText: '' as string | null | undefined,
  romaText: '' as string | null | undefined,
  // 与 currentLines 同序：第 i 项为第 i 行歌词的逐字时间轴；无逐字（纯 LRC）为 null。
  // 用「索引对齐」而非「时间相等」匹配，以容忍 lrc-file-parser 与 lxlyric 在 offset 处理上的微小差异。
  currentWordsByIndex: [] as (LxLyricWord[] | null)[],
  init() {
    if (this.isInited) return
    this.isInited = true
    this.lrc = new Lyric({
      onPlay: this.onPlay.bind(this),
      onSetLyric: this.onSetLyric.bind(this),
      offset: 100, // offset time(ms), default is 150 ms
    })
  },
  onPlay(line: number, text: string) {
    this.currentLineData.line = line
    // console.log(line)
    this.currentLineData.text = text
    for (const hook of this.playHooks) hook(line, text)
  },
  onSetLyric(lines: Lines) {
    this.currentLines = lines
    this.currentLineData.line = 0
    this.currentLineData.text = ''
    for (const hook of this.playHooks) hook(-1, '')
    for (const hook of this.setLyricHooks) hook(lines)
  },
  addPlayHook(hook: PlayHook) {
    this.playHooks.push(hook)
    hook(this.currentLineData.line, this.currentLineData.text)
  },
  removePlayHook(hook: PlayHook) {
    this.playHooks.splice(this.playHooks.indexOf(hook), 1)
  },
  addSetLyricHook(hook: SetLyricHook) {
    this.setLyricHooks.push(hook)
    hook(this.currentLines)
  },
  removeSetLyricHook(hook: SetLyricHook) {
    this.setLyricHooks.splice(this.setLyricHooks.indexOf(hook), 1)
  },
  setLyric() {
    const extendedLyrics = [] as string[]
    if (this.isShowTranslation && this.translationText) extendedLyrics.push(this.translationText)
    if (this.isShowRoma && this.romaText) extendedLyrics.push(this.romaText)
    this.lrc!.setLyric(this.lyricText, extendedLyrics)
  },
}

export const init = async() => {
  lrcTools.init()
}

// 把 lxlyric（逐字歌词）解析成与 currentLines 同序的「逐字时间轴」数组。
// 仅做纯解析，不启动 LxLyricPlayer 内部 ticker（时钟由 audioClock 统一外推）。
// 采用「时间就近匹配」对齐到 lrc-file-parser 的当前行，容忍两者在 offset 处理上的微小差异。
const buildWordsMap = (lxlrc?: string | null) => {
  const arr: (LxLyricWord[] | null)[] = []
  const lyricLines = lrcTools.currentLines
  if (lxlrc && lyricLines.length) {
    try {
      lxLyricParser.setLyric(lxlrc)
      const lxLines = lxLyricParser.lines
      const used = new Array(lxLines.length).fill(false)
      for (let i = 0; i < lyricLines.length; i++) {
        const t = lyricLines[i].time
        let best = -1
        let bestDiff = Infinity
        for (let j = 0; j < lxLines.length; j++) {
          if (used[j]) continue
          const diff = Math.abs(lxLines[j].time - t)
          if (diff < bestDiff) { bestDiff = diff; best = j }
        }
        if (best >= 0 && bestDiff <= 300 && lxLines[best].words?.length) {
          used[best] = true
          arr[i] = lxLines[best].words
        } else {
          arr[i] = null
        }
      }
    } catch {}
  }
  lrcTools.currentWordsByIndex = arr
  // 通知组件侧刷新逐字快照（独立于行级 onSetLyric，便于控制触发时机）。
  for (const hook of wordMapHooks) hook()
}

/**
 * 计算某行在某「相对行起点的已播放毫秒」下的逐字高亮状态。
 * 返回当前正演唱的字索引与进度（0~1）。无逐字时返回 { index: -1, progress: 0 }。
 */
export const getWordState = (
  words: LxLyricWord[] | undefined,
  elapsed: number,
): { index: number; progress: number } => {
  if (!words || !words.length) return { index: -1, progress: 0 }
  if (elapsed < 0) return { index: -1, progress: 0 }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (elapsed < w.startTime) return { index: Math.max(i - 1, -1), progress: 1 }
    if (elapsed <= w.startTime + w.duration) {
      const progress = w.duration > 0 ? Math.min(Math.max((elapsed - w.startTime) / w.duration, 0), 1) : 1
      return { index: i, progress }
    }
  }
  return { index: words.length - 1, progress: 1 }
}

export const setLyric = (lyric: string, translation?: string, romalrc?: string, lxLyric?: string | null) => {
  // 歌词就绪后立即用【引擎实时位置】重锚时钟，避免“进度条已跳到记忆位置、
  // 歌词却停在顶部/第 0 行”的错位（尤其“杀死后台再点击播放”的记忆恢复场景：
  // 歌词异步加载后才就绪）。
  // 必须用 getPosition() 实时值，绝不能改用 store 的 nowPlayTime——后者在切歌/恢复瞬间
  // 常残留上一首或旧进度，会把歌词锚到错误位置（高亮行整体错位，回归 bug）。
  // 无论暂停还是播放都重锚：暂停态下用户也可能刚切歌/seek，歌词仍需立即对齐。
  const wasPlaying = lrcTools.isPlay
  lrcTools.isPlay = false
  lrcTools.lyricText = lyric
  lrcTools.translationText = translation
  lrcTools.romaText = romalrc
  // 先让 lrc-file-parser 解析出行（写入 currentLines），再据此把逐字时间轴按索引对齐，
  // 最后触发逐字钩子刷新组件侧快照。
  lrcTools.setLyric()
  buildWordsMap(lxLyric)
  void getPosition()
    .then((position) => {
      // 切歌/恢复瞬间用【引擎实时位置】纯镜像重锚（不启动 ticker），
      // 避免歌词时钟先于音频自行走字导致高亮行错位。
      try { syncToTime((position || 0) * 1000, wasPlaying) } catch {}
    })
    .catch(() => {
      lrcTools.isPlay = wasPlaying
    })
}
export const setPlaybackRate = (playbackRate: number) => {
  lrcTools.lrc!.setPlaybackRate(playbackRate)
}
export const toggleTranslation = (isShow: boolean) => {
  lrcTools.isShowTranslation = isShow
  if (!lrcTools.lyricText) return
  lrcTools.setLyric()
}
export const toggleRoma = (isShow: boolean) => {
  lrcTools.isShowRoma = isShow
  if (!lrcTools.lyricText) return
  lrcTools.setLyric()
}
export const play = (time?: number) => {
  // 调用方统一传入【毫秒】（lrc-file-parser 的语义）。
  // 改为【纯镜像】语义：仅把当前行锚到指定音频位置，不再启动 lrc-file-parser
  // 内部 ticker——避免歌词时钟脱离音频真实位置自行走字（缓冲/卡顿/JS 线程繁忙
  // 时 ticker 与音频脱节，表现为“歌词跑在音频前面”）。真正的前进由 playProgress
  // 的 250ms 重锚循环驱动，歌词行永远等于音频真实位置（⑩ 绝对同步）。
  syncToTime(time ?? 0, true)
}
export const pause = () => {
  // console.log('pause')
  lrcTools.isPlay = false
  lrcTools.lrc!.pause()
}

/**
 * 二分查找当前时间（ms）对应的歌词行索引。
 * 返回「最后一个 time <= 当前时间」的行：
 * - 时间恰为某行起点时，立即亮起该行（不再滞后一行）；
 * - 早于首行返回 0，晚于末行返回最后一行，空列表返回 -1。
 * 相较原线性扫描，把 80ms 重锚热路径从 O(n) 降为 O(log n)，
 * 并修复原 `time <= lines[i].time 减一` 导致的整拍边界高亮滞后问题。
 * lines 需按 time 升序（lrc-file-parser 已保证）。
 */
export const findLineIndexByTime = (lines: Lines, time: number): number => {
  const length = lines.length
  if (!length) return -1
  if (time <= lines[0].time) return 0
  let low = 0
  let high = length - 1
  while (low < high) {
    const mid = (low + high) >>> 1
    if (lines[mid].time <= time) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return lines[low].time > time ? low - 1 : low
}

/**
 * 根据时间（ms）获取当前应高亮的歌词行文本。
 * 用于后台定时器在 JS 歌词 ticker 被节流时继续刷新 NowPlaying 歌词。
 */
export const getLyricLineTextByTime = (time: number): string => {
  const lines = lrcTools.currentLines
  if (!lines.length) return ''
  const index = findLineIndexByTime(lines, time)
  if (index < 0) return ''
  return lines[index]?.text ?? ''
}

/**
 * 仅按传入时间（ms）设置当前歌词行，不启动内部 ticker。
 * 用于音频暂停/seek 等需要“歌词位置跟上播放头但不自动走字”的场景。
 * 直接根据 currentLines 查找当前行，避免调用 play() 启动 ticker 导致暂停态歌词自行前进。
 */
export const setPlayTime = (time: number) => {
  const lines = lrcTools.currentLines
  const lineIndex = findLineIndexByTime(lines, time)
  if (lineIndex < 0) {
    if (lrcTools.currentLineData.line !== -1) {
      lrcTools.currentLineData.line = -1
      lrcTools.currentLineData.text = ''
      lrcTools.onPlay(-1, '')
    }
    return
  }
  const line = lines[lineIndex]
  if (lrcTools.currentLineData.line === lineIndex && lrcTools.currentLineData.text === line.text) return
  lrcTools.currentLineData.line = lineIndex
  lrcTools.currentLineData.text = line.text
  lrcTools.onPlay(lineIndex, line.text)
}

/**
 * 把歌词当前行【纯镜像】到给定音频位置（ms），不启动任何独立 ticker。
 * isPlaying 同步写入 lrcTools.isPlay，供切歌时 setLyric 判断 wasPlaying 正确重锚。
 * 这是“音频与歌词绝对同步”的核心：歌词行永远由音频真实位置推导，不会自行漂移。
 */
export const syncToTime = (time: number, isPlaying: boolean) => {
  lrcTools.isPlay = isPlaying
  setPlayTime(time)
}

// 逐行歌词 play hook：iOS 无原生 LyricModule，蓝牙歌词 / 网络歌词改用此 JS 引擎钩子驱动。
export const addPlayHook = (hook: PlayHook) => lrcTools.addPlayHook(hook)
export const removePlayHook = (hook: PlayHook) => lrcTools.removePlayHook(hook)

// on lyric play hook
export const useLrcPlay = (autoUpdate = true) => {
  // 注意：初值必须是 currentLineData 的【副本】，绝不能直接引用这个可变对象。
  // 因为 lrcTools.onPlay 会先改写 currentLineData.line/text 再回调 playCallback，
  // 若 lrcInfo 初值就是该共享对象，prev 永远等 line，setLrcInfo 返回同一引用会导致
  // React 跳过重渲染，表现为歌词高亮整段卡死（播放不前进、点击不跟随）。
  const [lrcInfo, setLrcInfo] = useState(() => ({
    line: lrcTools.currentLineData.line,
    text: lrcTools.currentLineData.text,
  }))
  // 进度重锚会以 250ms 节拍高频回弹 onPlay（即使行未变），用 ref 记录上次值，
  // 行/文案未变时跳过重渲染，避免歌词 FlatList 空转。
  const lastLrcRef = useRef({ line: -1, text: '' })
  useEffect(() => {
    if (!autoUpdate) return
    const setLrcCallback: SetLyricHook = () => {
      lastLrcRef.current = { line: -1, text: '' }
      setLrcInfo({ line: 0, text: '' })
    }
    const playCallback: PlayHook = (line, text) => {
      // 行未变化（仅进度重锚回弹）时跳过，避免每拍重渲染整张歌词列表。
      if (lastLrcRef.current.line === line && lastLrcRef.current.text === text) return
      lastLrcRef.current = { line, text }
      // 生成新对象，确保 React 在跨行时重新渲染高亮行。
      setLrcInfo({ line, text })
    }
    lrcTools.addSetLyricHook(setLrcCallback)
    lrcTools.addPlayHook(playCallback)
    setLrcInfo({
      line: lrcTools.currentLineData.line,
      text: lrcTools.currentLineData.text,
    })
    return () => {
      lrcTools.removeSetLyricHook(setLrcCallback)
      lrcTools.removePlayHook(playCallback)
    }
  }, [autoUpdate])

  return lrcInfo
}

// on lyric set hook
export const useLrcSet = () => {
  const [lines, setLines] = useState<Lines>(lrcTools.currentLines)
  useEffect(() => {
    const callback = (lines: Lines) => {
      setLines(lines)
    }
    lrcTools.addSetLyricHook(callback)
    return () => {
      lrcTools.removeSetLyricHook(callback)
    }
  }, [])

  return lines
}

// 逐字映射 hook：歌词（含逐字）就绪时返回最新「与行同序的逐字数组」快照。
export const useLrcWordsMap = () => {
  const [wordsByIndex, setWordsByIndex] = useState<readonly (LxLyricWord[] | null)[]>(lrcTools.currentWordsByIndex)
  useEffect(() => {
    const callback = () => {
      setWordsByIndex(lrcTools.currentWordsByIndex)
    }
    wordMapHooks.push(callback)
    return () => {
      const idx = wordMapHooks.indexOf(callback)
      if (idx >= 0) wordMapHooks.splice(idx, 1)
    }
  }, [])

  return wordsByIndex
}
