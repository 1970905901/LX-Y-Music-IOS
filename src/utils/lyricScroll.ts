import { type FlatListProps } from 'react-native'

/**
 * 为歌词 FlatList 提供缓存化的行高与累计偏移计算。
 * 长歌词列表如果每次滚动都从头累加所有行高，会随着歌曲进度变成 O(n²) 开销。
 * 这里维护一份 lineHeights 数组，并缓存 cumulativeOffsets，使滚动定位保持 O(1)。
 */
export class LyricScrollLayout {
  private lineHeights: number[] = []
  /**
   * 行处于「激活态」时测得的高度。激活行会放大字号并加粗，可能把原本单行的文字挤成两行。
   * 该高度仅用于定位当前行自身，**不参与其后面行的累计偏移**：
   * 若计入累计偏移，则每切一次行，前一行「激活→非激活」的高度回落会让整段偏移突跳，
   * 表现为逐行滚动一卡一顿（仅在该行文字被挤成两行时明显，单行文字因高度不变而无感）。
   */
  private activeLineHeights: number[] = []
  private cumulativeOffsets: number[] = []
  // 基于 lines 引用缓存的「前 index 行累计偏移」：行高或歌词不变时每帧复用，摊销 O(1)（原每帧 O(n) × 2）。
  private preciseOffsets: number[] = []
  private preciseLinesRef: unknown = null
  // 横屏：已播放/当前行用 bold（更宽，可能多换行、更高）。连续滚动时「当前行之前」全为已播放行，
  // 故累计偏移应统一用「bold 档」高度估算；一次性定位未播放区域仍用下方 normal 档。两档各自维护
  // 真实高度与平均，互不污染。
  private playedLineHeights: number[] = []
  private precisePlayedOffsets: number[] = []
  private precisePlayedLinesRef: unknown = null
  private defaultHeight: number
  private measuredCount = 0
  private measuredSum = 0
  // 未测量行估算需区分「无翻译 / 有翻译」两类真实平均高度，否则混合平均会被翻译行抬高，
  // 反而比固定 defaultHeight 更不准（无翻译行被高估）。按首次测量记录每行归属，翻译状态不会变更。
  private measuredPlainSum = 0
  private measuredPlainCount = 0
  private measuredTransSum = 0
  private measuredTransCount = 0
  private lineBucket: number[] = [] // 0=无翻译, 1=有翻译
  // bold 档（已播放/当前行）的实测高度与平均，单独成档。
  private playedPlainSum = 0
  private playedPlainCount = 0
  private playedTransSum = 0
  private playedTransCount = 0
  private playedBucket: number[] = []
  spaceHeight = 0

  // 有翻译行约是无翻译行的 1.55 倍（实测大屏 54→84 附近）。无翻译行测量不足时回退到 defaultHeight，
  // 有翻译行测量不足时回退为「无翻译平均 × 该系数」。
  static readonly TRANSLATION_FACTOR = 1.55

  constructor(defaultHeight = 54) {
    this.defaultHeight = defaultHeight
  }

  reset() {
    this.lineHeights = []
    this.activeLineHeights = []
    this.cumulativeOffsets = []
    this.preciseOffsets = []
    this.preciseLinesRef = null
    this.playedLineHeights = []
    this.precisePlayedOffsets = []
    this.precisePlayedLinesRef = null
    this.measuredCount = 0
    this.measuredSum = 0
    this.measuredPlainSum = 0
    this.measuredPlainCount = 0
    this.measuredTransSum = 0
    this.measuredTransCount = 0
    this.lineBucket = []
    this.playedPlainSum = 0
    this.playedPlainCount = 0
    this.playedTransSum = 0
    this.playedTransCount = 0
    this.playedBucket = []
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

  // isPlayed：横屏里已播放/当前行都用 bold（更宽、可能更高）。同一行在 normal→bold 切换时高度会变，
  // 故 bold 高度单独成档（playedLineHeights/played 桶），与 normal 档（lineHeights/measured 桶）互不影响；
  // 竖屏不传此参数（默认 false），行为与改动前一致。
  updateLineHeight(lineNum: number, height: number, hasTranslation?: boolean, isActive = false, isPlayed = false) {
    // 激活态高度只影响该行自身的居中定位，不影响后续行的累计偏移，故无需重建缓存。
    if (isActive) {
      this.activeLineHeights[lineNum] = height
      return
    }
    const isBold = isPlayed
    const target = isBold ? this.playedLineHeights : this.lineHeights
    const prev = target[lineNum]
    if (prev === height) return
    if (prev === undefined) {
      if (isBold) {
        const bucket = hasTranslation ? 1 : 0
        this.playedBucket[lineNum] = bucket
        if (bucket === 1) this.playedTransSum += height
        else this.playedPlainSum += height
        this.playedPlainCount += hasTranslation ? 0 : 1
        this.playedTransCount += hasTranslation ? 1 : 0
      } else {
        this.measuredCount++
        this.measuredSum += height
        const bucket = hasTranslation ? 1 : 0
        this.lineBucket[lineNum] = bucket
        if (bucket === 1) {
          this.measuredTransSum += height
          this.measuredTransCount++
        } else {
          this.measuredPlainSum += height
          this.measuredPlainCount++
        }
      }
    } else {
      if (isBold) {
        const bucket = this.playedBucket[lineNum] ?? (hasTranslation ? 1 : 0)
        if (bucket === 1) this.playedTransSum += height - prev
        else this.playedPlainSum += height - prev
      } else {
        this.measuredSum += height - prev
        // 翻译状态不会变，用首次记录的分桶；极少数二次测量未带 hasTranslation 时沿用原分桶。
        const bucket = this.lineBucket[lineNum] ?? (hasTranslation ? 1 : 0)
        if (bucket === 1) this.measuredTransSum += height - prev
        else this.measuredPlainSum += height - prev
      }
    }
    target[lineNum] = height
    // 已播放（bold）行的真实高度也同步给 lineHeights，供 PlayLine 进度线定位使用，
    // 但不计入 normal 平均桶（避免污染未播放区的高度估算）。
    if (isBold) this.lineHeights[lineNum] = height
    // 行高变化后对应累计偏移失效，需要重建；精确偏移缓存同样失效。
    if (isBold) this.precisePlayedOffsets = []
    else {
      this.cumulativeOffsets = []
      this.preciseOffsets = []
    }
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

  /** 当前行（激活态）的实际高度，未测得时回退到非激活高度 */
  getActiveLineHeight(lineNum: number): number {
    return this.activeLineHeights[lineNum] ?? this.getLineHeight(lineNum)
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
    const itemHeight = this.getActiveLineHeight(index)
    const target = paddingV + itemTop + itemHeight * viewPosition - listHeight * viewPosition
    return Math.max(0, target)
  }

  /**
   * 构建/复用「前 index 行累计偏移」缓存（对应 getTargetOffsetPrecise 的循环）。
   * 以 lines 引用作为失效 key：同一份歌词（引用不变）且行高无变化时，缓存长期有效，
   * 使每秒数十次的连续滚动位置计算摊销为 O(1)；切歌导致 lines 变化、或某行被真实测量
   * （updateLineHeight 已清空 preciseOffsets）时自动重建。
   */
  private ensurePreciseOffsets(index: number, lines: { extendedLyrics?: unknown[] }[], usePlayed: boolean) {
    const heights = usePlayed ? this.playedLineHeights : this.lineHeights
    const cache = usePlayed ? this.precisePlayedOffsets : this.preciseOffsets
    const ref = usePlayed ? this.precisePlayedLinesRef : this.preciseLinesRef
    if (ref !== lines) {
      cache.length = 0
      if (usePlayed) this.precisePlayedLinesRef = lines
      else this.preciseLinesRef = lines
    }
    if (cache.length > index) return
    // 按「是否 played 档」选对应分桶平均：当前行之前全为已播放行（横屏 bold）时，必须用 bold 平均，
    // 否则用 normal 平均（竖屏/未播放区）。两类平均各自随用户字号自动修正。
    const plainAvg = usePlayed
      ? (this.playedPlainCount > 0 ? this.playedPlainSum / this.playedPlainCount : this.defaultHeight)
      : (this.measuredPlainCount > 0 ? this.measuredPlainSum / this.measuredPlainCount : this.defaultHeight)
    const transAvg = usePlayed
      ? (this.playedTransCount > 0
        ? this.playedTransSum / this.playedTransCount
        : plainAvg * LyricScrollLayout.TRANSLATION_FACTOR)
      : (this.measuredTransCount > 0
        ? this.measuredTransSum / this.measuredTransCount
        : plainAvg * LyricScrollLayout.TRANSLATION_FACTOR)
    const oldLen = cache.length
    if (oldLen === 0) cache[0] = 0
    for (let i = Math.max(oldLen, 1); i <= index; i++) {
      const measured = heights[i - 1]
      const h = measured !== undefined
        ? measured
        : ((lines[i - 1]?.extendedLyrics?.length ?? 0) > 0 ? transAvg : plainAvg)
      cache[i] = cache[i - 1] + h
    }
  }

  /**
   * 精确计算目标偏移：已测量行用真实行高，未测量行用「是否有翻译」分档估算。
   * 相比 getTargetOffset 用全局平均高度估算，这里对翻译行/无翻译行区分高度，
   * 可显著降低「从封面页切到歌词页 / 跳到中后段」时（FlatList 虚拟化导致当前行
   * 之前的行未渲染未测量）累计偏移的估算误差，避免高亮行偶发不居中。
   * @param lines 歌词行（含 extendedLyrics 判断是否有翻译）
   * @param useActiveHeight 该行自身是否按激活态高度计算。连续滚动传 false：
   *   下一行的激活高度在它真正激活前测不到，若起点/终点分别用「已测得/未测得」的高度，
   *   切行瞬间会出现一次突跳；统一用非激活高度可让插值严格连续（居中偏差恒定且极小），
   *   而点击歌词、切歌、回正等一次性定位传 true 以取得最准确的居中位置。
   */
  getTargetOffsetPrecise(
    index: number,
    listHeight: number,
    lines: { extendedLyrics?: unknown[] }[],
    viewPosition = 0.5,
    paddingV = 0,
    spaceHeight = 0,
    useActiveHeight = true,
    usePlayed = false,
  ): number {
    if (index <= 0) return 0
    // 复用基于 lines 引用的累计偏移缓存：同一份歌词、行高无变化时每帧复用，摊销 O(1)
    // （原实现每帧对前 index 行做一次 O(n) 循环，连续滚动每秒约 120 次调用）。
    this.ensurePreciseOffsets(index, lines, usePlayed)
    const offset = (usePlayed ? this.precisePlayedOffsets : this.preciseOffsets)[index] ?? 0
    // 当前行处于激活态，其自身高度按激活态计算（可能被挤成两行而更高），保证居中定位准确；
    // 而其之前各行一律用非激活高度累加，保证累计偏移不随播放推进而跳动。
    const itemHeight = useActiveHeight ? this.getActiveLineHeight(index) : this.getLineHeight(index)
    const target = paddingV + spaceHeight + offset + itemHeight * viewPosition - listHeight * viewPosition
    return Math.max(0, target)
  }

  /**
   * 连续平滑滚动偏移：基于精确播放时间 t(ms)，在当前行与下一行「居中偏移」之间线性插值，
   * 让歌词随演唱连续上移（卡拉OK 式），取代原来「每行到来才 scrollToIndex 跳变」的观感。
   * 行级高亮着色仍由 useLrcPlay 的 line 驱动；本函数只负责位置连续（每帧基于精确时间计算）。
   */
  getContinuousOffset(
    index: number,
    lines: { time: number; extendedLyrics?: unknown[] }[],
    t: number,
    listHeight: number,
    viewPosition = 0.5,
    paddingV = 0,
    spaceHeight = 0,
    usePlayed = false,
  ): number {
    // 连续滚动统一用非激活高度，保证插值起点/终点同基准、切行不突跳。
    // usePlayed：横屏下「当前行之前」全为已播放（bold）行，累计偏移须用 bold 档，否则高亮行持续偏低。
    const offsetI = this.getTargetOffsetPrecise(index, listHeight, lines, viewPosition, paddingV, spaceHeight, false, usePlayed)
    if (index + 1 >= lines.length) return offsetI
    const curTime = lines[index].time
    const nextTime = lines[index + 1].time
    const progress = nextTime > curTime ? (t - curTime) / (nextTime - curTime) : 0
    const offsetNext = this.getTargetOffsetPrecise(index + 1, listHeight, lines, viewPosition, paddingV, spaceHeight, false, usePlayed)
    return offsetI + progress * (offsetNext - offsetI)
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
