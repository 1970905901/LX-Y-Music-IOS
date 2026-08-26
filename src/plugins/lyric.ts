import { useEffect, useState } from 'react'
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

export const init = async () => {
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
        try { lrcTools.lrc!.play((position || 0) * 1000) } catch {}
        lrcTools.isPlay = true
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
  // app_event.play() 多为无参触发（播放开始事件）。原始语义：从 lrc 当前时钟
  // （新歌 setLyric 后为 0）起步，由逐秒 tick（playProgress.ts 用 getPosition() 实时
  // 位置）持续重锚到真实音频位置。
  // 不可默认用 nowPlayTime——残留上一首进度时歌词会被锚到错误位置 → 高亮行整体错位。
  const playTime = (time ?? 0) * 1000
  lrcTools.isPlay = true
  lrcTools.lrc!.play(playTime)
}
export const pause = () => {
  // console.log('pause')
  lrcTools.isPlay = false
  lrcTools.lrc!.pause()
}

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
  useEffect(() => {
    if (!autoUpdate) return
    const setLrcCallback: SetLyricHook = () => {
      setLrcInfo({ line: 0, text: '' })
    }
    const playCallback: PlayHook = (line, text) => {
      // 每次歌词行变化都生成新对象，确保 React 重新渲染高亮行。
      // （lrc-file-parser 的 onPlay 只在跨行边界时回调，所以这里不会频繁触发。）
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
