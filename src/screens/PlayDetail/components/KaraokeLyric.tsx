import { memo, useEffect, useRef, useState } from 'react'
import { type TextStyle } from 'react-native'
import Text from '@/components/common/Text'
import KaraokeLine from './KaraokeLine'
import { audioClock } from '@/core/player/audioClock'
import { getWordState, type LxLyricWord } from '@/plugins/lyric'

// 逐字歌词渲染：自带 rAF 循环，根据 audioClock 外推时钟实时计算当前字索引与进度，
// 仅重渲染本组件（不触发整张歌词列表重渲染）。务必与音频绝对同步：时间来自 audioClock，
// 因此快进/快退/拖动进度条后，当前字的高亮会立即跟随音频真实位置。
const KaraokeLyric = memo(({
  words,
  lineTime,
  size,
  playedColor,
  inactiveColor,
  style,
}: {
  words: LxLyricWord[]
  lineTime: number
  size: number
  playedColor: string
  inactiveColor: string
  style?: TextStyle
}) => {
  const [state, setState] = useState({ index: -1, progress: 0 })
  const stateRef = useRef(state)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      // audioClock 返回秒，歌词时间为毫秒
      const t = audioClock.getTime() * 1000
      const s = getWordState(words, t - lineTime)
      const prev = stateRef.current
      // 量化到 2% 步长 + 跨字才更新，过滤掉无视觉差异的逐帧重渲染，降低 Bridge 开销。
      if (prev.index !== s.index || Math.abs(prev.progress - s.progress) >= 0.02) {
        stateRef.current = s
        setState(s)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [words, lineTime])

  return (
    <Text style={style}>
      <KaraokeLine
        words={words}
        activeWordIndex={state.index}
        activeWordProgress={state.progress}
        size={size}
        playedColor={playedColor}
        inactiveColor={inactiveColor}
      />
    </Text>
  )
})

export default KaraokeLyric
