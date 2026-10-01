import { memo, useEffect, useRef, useState } from 'react'
import { type TextStyle } from 'react-native'
import Text from '@/components/common/Text'
import KaraokeLine from './KaraokeLine'
import { audioClock } from '@/core/player/audioClock'
import { getWordState } from '@/plugins/lyric'
import type { LxLyricWord } from '@/plugins/lxLyricPlayer'
import { useAppActive, usePlayDetailCovered } from '@/store/common/hook'

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
  isActive,
}: {
  words: LxLyricWord[]
  lineTime: number
  size: number
  playedColor: string
  inactiveColor: string
  style?: TextStyle
  isActive: boolean
}) => {
  const [state, setState] = useState({ index: -1, progress: 0 })
  const stateRef = useRef(state)
  // 不可见即停（前台省电）：播放详情被压栈页覆盖、或 App 退到后台时，本组件不再逐帧
  // 取音频时钟重算当前字（每帧一次 bridge/JS 计算 + 命中步长时的 setState 重渲染）。
  // 只对激活行生效——非激活行本来就不跑 rAF。
  const covered = usePlayDetailCovered()
  const appActive = useAppActive()
  const canTick = isActive && !covered && appActive

  useEffect(() => {
    // 非激活行静态渲染：停掉 rAF、进度归零（全部字用未播放颜色）。
    // 激活/非激活共用同一渲染器是为了让行的换行布局恒定——若激活时才切换渲染器，
    // 嵌套 Text 与纯文本的换行断点不同，行高会在切行瞬间突变（抖动 + 居中偏移）。
    if (!isActive) {
      stateRef.current = { index: -1, progress: 0 }
      setState(stateRef.current)
      return
    }
    // 不可见：停掉 rAF 但**保留**当前进度，返回时首帧立即回到正确高亮，不会闪回未播放态。
    if (!canTick) return
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
    return () => { cancelAnimationFrame(raf) }
  }, [words, lineTime, isActive, canTick])

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
