import { useEffect, useRef, useState } from 'react'
import Lyric, { type Lines } from 'lrc-file-parser'
import { getPosition } from '@/plugins/player'
// import { getStore, subscribe } from '@/store'
export type Line = Lines[number]
type PlayHook = (line: number, text: string) => void
type SetLyricHook = (lines: Lines) => void

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

export const setLyric = (lyric: string, translation?: string, romalrc?: string) => {
  // 记录重设歌词前是否处于播放态；歌词就绪后立即用【引擎实时位置】重锚时钟，
  // 避免“进度条已跳到记忆位置、歌词却停在顶部/第 0 行”的错位
  // （尤其“杀死后台再点击播放”的记忆恢复场景：歌词异步加载后才就绪）。
  // 必须用 getPosition() 实时值，绝不能改用 store 的 nowPlayTime——后者在切歌/恢复瞬间
  // 常残留上一首或旧进度，会把歌词锚到错误位置（高亮行整体错位，回归 bug）。
  const wasPlaying = lrcTools.isPlay
  lrcTools.isPlay = false
  lrcTools.lyricText = lyric
  lrcTools.translationText = translation
  lrcTools.romaText = romalrc
  lrcTools.setLyric()
  if (wasPlaying) {
    void getPosition()
      .then((position) => {
        // 切歌/恢复瞬间用【引擎实时位置】纯镜像重锚（不启动 ticker），
        // 避免歌词时钟先于音频自行走字导致高亮行错位。
        try { syncToTime((position || 0) * 1000, true) } catch {}
      })
      .catch(() => {
        lrcTools.isPlay = true
      })
  }
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
 * 仅按传入时间（ms）设置当前歌词行，不启动内部 ticker。
 * 用于音频暂停/seek 等需要“歌词位置跟上播放头但不自动走字”的场景。
 * 直接根据 currentLines 查找当前行，避免调用 play() 启动 ticker 导致暂停态歌词自行前进。
 */
export const setPlayTime = (time: number) => {
  const lines = lrcTools.currentLines
  if (!lines.length) {
    if (lrcTools.currentLineData.line !== -1) {
      lrcTools.currentLineData.line = -1
      lrcTools.currentLineData.text = ''
      lrcTools.onPlay(-1, '')
    }
    return
  }
  let lineIndex = lines.length - 1
  for (let i = 0; i < lines.length; i++) {
    if (time <= lines[i].time) {
      lineIndex = i === 0 ? 0 : i - 1
      break
    }
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
