import { memo, useMemo } from 'react'
import { type StyleProp, type TextStyle, TouchableOpacity, View } from 'react-native'
import { useLrcPlay, useLrcSet } from '@/plugins/lyric'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import { useWindowSize } from '@/utils/hooks'

// 迷你歌词显示「上一行 / 当前行 / 下一行」三行，字号比原先明显放大。
// 相邻行只做弱化显示（保持整体高度稳定，不因首/末行缺行而抖动）。
//
// 小屏（winHeight < 700，与 SongInfo / FeatureBtns 的判定阈值一致）空间不足：
// 封面 + 完整歌曲信息已几乎占满封面页容器，三行放大歌词必然溢出（信息块被挤出容器
// 底、压到下方控制条）。故小屏降级为「只显示当前行」，但字号仍比原先放大。
const NEIGHBOR_LINE_COUNT = 1
const SMALL_WINDOW_HEIGHT = 700
// 行与行之间的额外间距。放大字号后原值 2pt 过于紧凑，三行挤在一起可读性差，故加大到 8pt；
// 小屏行数少、空间紧张，用较小的 6pt。
//
// ⚠️ 这份间距必须挂在**间隙下边那一行**上（current / 翻译 / next 各挂一份，prev 不挂）。
// 历史 bug（2026-09-30 修）：原本只挂在 prev / 翻译 / next 上 —— prev 那份落在**整个块的
// 顶部**（被 paddingVertical 吃掉），于是 prev ↔ current 之间是 **0pt**、current ↔ next 之间
// 是 8pt。用户截图实测两处墨迹间距 6.2pt vs 14.1pt，差 7.9pt ≈ 一份 marginTop，正是这个。
const LINE_GAP_NORMAL = 8
const LINE_GAP_SMALL = 6

const FONT = {
  normal: { current: 20, neighbor: 16, translation: 15 },
  small: { current: 17, neighbor: 15, translation: 14 },
}

const MiniLyric = ({ onPress, style }: { onPress?: () => void, style?: any }) => {
  const theme = useTheme()
  const { line: activeLine } = useLrcPlay()
  const lyricLines = useLrcSet()
  const textAlign = useSettingValue('playDetail.style.miniLyricAlign')
  const { height: winHeight } = useWindowSize()
  const isSmallWindow = winHeight < SMALL_WINDOW_HEIGHT
  const font = isSmallWindow ? FONT.small : FONT.normal
  const showNeighbor = !isSmallWindow

  const { prevLine, currentLine, translationLine, nextLine } = useMemo(() => {
    if (activeLine < 0 || lyricLines.length <= activeLine) {
      return { prevLine: null, currentLine: null, translationLine: null, nextLine: null }
    }
    const line = lyricLines[activeLine]
    const prevIndex = activeLine - NEIGHBOR_LINE_COUNT
    const nextIndex = activeLine + NEIGHBOR_LINE_COUNT
    return {
      prevLine: prevIndex >= 0 ? (lyricLines[prevIndex]?.text || null) : null,
      currentLine: line.text,
      translationLine: line.extendedLyrics.length > 0 ? line.extendedLyrics[0] : null,
      nextLine: nextIndex < lyricLines.length ? (lyricLines[nextIndex]?.text || null) : null,
    }
  }, [activeLine, lyricLines])

  const activeColor = theme.isDark ? theme['c-font'] : theme['c-primary']
  const inactiveColor = theme['c-font-label']
  const lineGap = isSmallWindow ? LINE_GAP_SMALL : LINE_GAP_NORMAL
  // 容器与行内样式用 useMemo 缓存，避免每次渲染生成新对象（对齐项目样式规范）。
  // prev 行**不带** marginTop；current / 翻译 / next 各带一份 ⇒ 两个间隙各得一份（见文件头说明）。
  const prevStyle = useMemo<StyleProp<TextStyle>>(() => ({ textAlign }), [textAlign])
  const contentStyle = useMemo<StyleProp<TextStyle>>(() => ({ textAlign, marginTop: lineGap }), [textAlign, lineGap])
  const subLineStyle = useMemo<StyleProp<TextStyle>>(() => ({ textAlign, marginTop: lineGap }), [textAlign, lineGap])
  // 空占位必须用不换行空格：RN 里空字符串的 <Text> 高度为 0，起不到占位作用。
  const BLANK = '\u00A0'

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.container, style]}
      accessibilityRole="button"
      accessibilityLabel={currentLine ?? undefined}
    >
      {currentLine ? (
        <View>
          {showNeighbor && (
            <Text
              size={font.neighbor}
              color={inactiveColor}
              style={prevStyle}
              numberOfLines={1}
            >
              {prevLine ?? BLANK}
            </Text>
          )}
          {/* 当前行：字号最大、用主色高亮；行距挂在这一行上（见文件头说明） */}
          <Text
            size={font.current}
            color={activeColor}
            style={contentStyle}
            numberOfLines={1}
          >
            {currentLine}
          </Text>
          {translationLine && (
            <Text
              size={font.translation}
              color={activeColor}
              style={subLineStyle}
              numberOfLines={1}
            >
              {translationLine}
            </Text>
          )}
          {showNeighbor && (
            <Text
              size={font.neighbor}
              color={inactiveColor}
              style={subLineStyle}
              numberOfLines={1}
            >
              {nextLine ?? BLANK}
            </Text>
          )}
        </View>
      ) : (
        // 无歌词/尚未定位到行时，仍按「有歌词」的结构占位，避免信息块高度突变
        // 导致封面页整体布局在进页面瞬间跳动（space-between 下中缝会跟着变）。
        <View>
          {showNeighbor && (
            <Text size={font.neighbor} color={inactiveColor} style={prevStyle} numberOfLines={1}>
              {BLANK}
            </Text>
          )}
          <Text size={font.current} color={theme['c-font-label']} style={contentStyle} numberOfLines={1}>
            ...
          </Text>
          {showNeighbor && (
            <Text size={font.neighbor} color={inactiveColor} style={subLineStyle} numberOfLines={1}>
              {BLANK}
            </Text>
          )}
        </View>
      )}
    </TouchableOpacity>
  )
}

const styles = createStyle({
  container: {
    // 由 1 行扩到 3 行后行距本身已提供呼吸感，纵向内边距相应收紧，
    // 避免整块过高把歌曲信息往上顶、挤压下方歌词页/控制条。
    paddingVertical: 4,
    paddingLeft: 20,
    paddingRight: 20,
    alignItems: 'stretch',
  },
})

export default memo(MiniLyric)
