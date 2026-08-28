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
  spaceHeight = 0

  constructor(defaultHeight = 54) {
    this.defaultHeight = defaultHeight
  }

  reset() {
    this.lineHeights = []
    this.cumulativeOffsets = []
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
    if (this.lineHeights[lineNum] === height) return
    this.lineHeights[lineNum] = height
    // 行高变化后累计偏移失效，需要重建
    this.cumulativeOffsets = []
  }

  getLineHeight(lineNum: number): number {
    return this.lineHeights[lineNum] ?? this.defaultHeight
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

  private ensureCumulativeOffsets(untilLine: number) {
    if (this.cumulativeOffsets.length > untilLine) return
    const oldLen = this.cumulativeOffsets.length
    if (oldLen === 0) {
      this.cumulativeOffsets[0] = 0
    }
    for (let i = Math.max(oldLen, 1); i <= untilLine; i++) {
      const prevHeight = this.lineHeights[i - 1] ?? this.defaultHeight
      this.cumulativeOffsets[i] = this.cumulativeOffsets[i - 1] + prevHeight
    }
  }
}
