import { type FlatListProps } from 'react-native'

/**
 * 为歌词 FlatList 提供缓存化的行高与累计偏移计算。
 * 长歌词列表如果每次滚动都从头累加所有行高，会随着歌曲进度变成 O(n²) 开销。
 * 这里维护一份 lineHeights 数组，并缓存 cumulativeOffsets，使滚动定位保持 O(1)。
 */
export class LyricScrollLayout {
  private lineHeights: number[] = []
  private cumulativeOffsets: number[] = []
  private defaultHeight: number
  private measuredCount = 0
  private measuredSum = 0
  spaceHeight = 0

  constructor(defaultHeight = 54) {
    this.defaultHeight = defaultHeight
  }

  reset() {
    this.lineHeights = []
    this.cumulativeOffsets = []
    this.measuredCount = 0
    this.measuredSum = 0
    this.spaceHeight = 0
  }

  setSpaceHeight(height: number) {
    this.spaceHeight = height
  }

  /** 返回 PlayLine 兼容的布局信息对象 */
  getLayoutInfo() {
    return { spaceHeight: this.spaceHeight, lineHeights: this.lineHeights }
  }

  setDefaultHeight(defaultHeight: number) {
    this.defaultHeight = defaultHeight
  }

  updateLineHeight(lineNum: number, height: number) {
    const prev = this.lineHeights[lineNum]
    if (prev === height) return
    this.lineHeights[lineNum] = height
    if (prev === undefined) {
      this.measuredCount++
      this.measuredSum += height
    } else {
      this.measuredSum += height - prev
    }
    // 行高变化后累计偏移失效，需要重建
    this.cumulativeOffsets = []
  }

  /** 该行是否已被真实测量过（用于判断累计偏移是否发生变化） */
  isMeasured(lineNum: number): boolean {
    return this.lineHeights[lineNum] !== undefined
  }

  getLineHeight(lineNum: number): number {
    const measured = this.lineHeights[lineNum]
    if (measured !== undefined) return measured
    // 未测量的行用“已测量行的平均高度”估算：跳到歌曲中段/尾段时，
    // 固定 defaultHeight 会与真实行高累计出很大偏差，导致高亮行持续偏离中心。
    return this.measuredCount > 0 ? this.measuredSum / this.measuredCount : this.defaultHeight
  }

  getCumulativeOffset(lineNum: number): number {
    if (lineNum <= 0) return 0
    this.ensureCumulativeOffsets(lineNum)
    return this.cumulativeOffsets[lineNum] ?? 0
  }

  getItemLayout: NonNullable<FlatListProps<unknown>['getItemLayout']> = (_data, index) => {
    const length = this.getLineHeight(index)
    const offset = this.getCumulativeOffset(index)
    return { length, offset, index }
  }

  /**
   * 计算让第 index 行落在视口指定位置的 offset。
   * @param index 歌词行索引
   * @param listHeight 列表可视高度
   * @param viewPosition 0 表示顶部，0.5 表示居中，1 表示底部
   * @param paddingV 上下额外留白
   */
  getTargetOffset(index: number, listHeight: number, viewPosition = 0.5, paddingV = 0): number {
    if (index <= 0) return 0
    const itemTop = this.getCumulativeOffset(index)
    const itemHeight = this.getLineHeight(index)
    const target = paddingV + itemTop + itemHeight * viewPosition - listHeight * viewPosition
    return Math.max(0, target)
  }

  /**
   * 精确计算目标偏移：已测量行用真实行高，未测量行用「是否有翻译」分档估算。
   * 相比 getTargetOffset 用全局平均高度估算，这里对翻译行/无翻译行区分高度，
   * 可显著降低「从封面页切到歌词页 / 跳到中后段」时（FlatList 虚拟化导致当前行
   * 之前的行未渲染未测量）累计偏移的估算误差，避免高亮行偶发不居中。
   * @param lines 歌词行（含 extendedLyrics 判断是否有翻译）
   */
  getTargetOffsetPrecise(
    index: number,
    listHeight: number,
    lines: { extendedLyrics?: unknown[] }[],
    viewPosition = 0.5,
    paddingV = 0,
  ): number {
    if (index <= 0) return 0
    // 有翻译的行多渲染一行翻译，行高约为无翻译行的 1.55 倍（实测大屏 54→84 附近）。
    const translationFactor = 1.55
    let offset = 0
    for (let i = 0; i < index; i++) {
      const measured = this.lineHeights[i]
      if (measured !== undefined) {
        offset += measured
      } else {
        const hasTranslation = (lines[i]?.extendedLyrics?.length ?? 0) > 0
        offset += hasTranslation ? this.defaultHeight * translationFactor : this.defaultHeight
      }
    }
    const itemHeight = this.getLineHeight(index)
    const target = paddingV + offset + itemHeight * viewPosition - listHeight * viewPosition
    return Math.max(0, target)
  }

  private ensureCumulativeOffsets(untilLine: number) {
    if (this.cumulativeOffsets.length > untilLine) return
    const oldLen = this.cumulativeOffsets.length
    if (oldLen === 0) {
      this.cumulativeOffsets[0] = 0
    }
    for (let i = Math.max(oldLen, 1); i <= untilLine; i++) {
      const prevHeight = this.getLineHeight(i - 1)
      this.cumulativeOffsets[i] = this.cumulativeOffsets[i - 1] + prevHeight
    }
  }
}
