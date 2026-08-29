// 音频时钟（锚点外推）
//
// 歌词/进度条的实时同步瓶颈不在算法，而在“时钟源”：原实现每 80ms 通过 Bridge
// 调 getPosition() 取原生位置，每次 JS↔Native 往返有 ~20ms 异步延迟，且 JS 线程
// 繁忙时 Promise 回调排队，稳态滞后达 100~250ms。
//
// 本模块改为「锚点外推」：只在 play/seek/buffering/rate 变化时取一次原生位置
// （anchorPosition + anchorSystem 单调时钟），之后每帧用
//   position = anchorPosition + (performance.now() - anchorSystem) * rate
// 在 JS 线程外推当前位置。每帧（~16ms）即可拿到平滑的音频位置，且不再受 Bridge
// 延迟/JS 排队影响。调用方需每隔 ~1s 用原生位置 recalibrate 一次，防止长期漂移。
class AudioClock {
  private anchorPositionMs = 0
  private anchorSystemMs = 0
  private rate = 1
  private playing = false
  // holding：暂停外推、固定显示 holdMs（seek 目标 / buffering 起点）。
  // 用于「跳转/缓冲期间歌词按住目标值，不随外推超前/滞后」。
  private holding = false
  private holdMs = 0

  reset() {
    this.anchorPositionMs = 0
    this.anchorSystemMs = 0
    this.rate = 1
    this.playing = false
    this.holding = false
    this.holdMs = 0
  }

  /** 以原生真实位置重置锚点，后续按时间外推（播放中）。 */
  setAnchor(positionMs: number, rate = this.rate, playing = true) {
    this.anchorPositionMs = positionMs
    this.anchorSystemMs = performance.now()
    this.rate = rate
    this.playing = playing
    this.holding = false
  }

  /** 暂停外推，固定显示某位置（seek 目标 / buffering 起点）。 */
  hold(ms: number) {
    this.holding = true
    this.holdMs = ms
  }

  /** 从指定位置恢复外推（playerPlaying 事件后用引擎真实位置调用）。 */
  resume(positionMs: number, rate = this.rate) {
    this.holding = false
    this.anchorPositionMs = positionMs
    this.anchorSystemMs = performance.now()
    this.rate = rate
    this.playing = true
  }

  /** 播放速率变化：以当前外推位置为新的锚点，避免外推跳变。 */
  setRate(rate: number) {
    const now = this.getTime()
    this.rate = rate
    this.anchorPositionMs = now * 1000
    this.anchorSystemMs = performance.now()
  }

  /** 播放/暂停切换：以当前外推位置为新的锚点，保持位置连续。 */
  setPlaying(playing: boolean) {
    if (playing === this.playing) return
    const now = this.getTime()
    this.anchorPositionMs = now * 1000
    this.anchorSystemMs = performance.now()
    this.playing = playing
  }

  /** 当前外推位置（秒）。holding 时返回固定值，暂停时返回锚点位置。 */
  getTime(): number {
    if (this.holding) return this.holdMs / 1000
    if (!this.playing) return this.anchorPositionMs / 1000
    const elapsed = performance.now() - this.anchorSystemMs
    return (this.anchorPositionMs + elapsed * this.rate) / 1000
  }
}

export const audioClock = new AudioClock()
export default audioClock
