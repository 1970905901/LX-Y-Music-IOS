// seek 冻结期静音标志：快进/快退且音频尚未缓冲追平目标时为 true，
// 用于阻止播放器在原生 'playing' 事件中提前恢复音量，保证“追上同步后才有声音”。
let isSeekMuting = false

export const setSeekMuting = (value: boolean) => {
  isSeekMuting = value
}

export const isSeekMutingActive = () => isSeekMuting
