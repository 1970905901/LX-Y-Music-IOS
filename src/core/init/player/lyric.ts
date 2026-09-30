import { init as initLyricPlayer, toggleTranslation, toggleRoma, play, pause, stop, setLyric, setPlaybackRate, seek, onLyricPlay } from '@/core/lyric'
import playerState from '@/store/player/state'
import { updateMetaData } from '@/plugins/player'
import { setLastLyric } from '@/core/player/playInfo'
import { getCurrentLyricLines } from '@/plugins/lyric'
import { setNowPlayingLyrics } from '@/utils/nativeModules/nowPlaying'
import settingState from '@/store/setting/state'
import { Platform } from 'react-native'

// 「显示蓝牙歌词」取值：开 = 把当前歌词行推送到系统媒体信息（控制中心/锁屏/车机/音箱
// 读的都是同一份 MPNowPlayingInfoCenter），关 = 只显示歌名·歌手。
// 用取值函数而非模块级快照：开关在设置页可随时切换，模块加载时读一次会拿到旧值。
// 默认开：设置未初始化（undefined）时也视为开，故只把显式 false 当作关闭。
const isShowBluetoothLyric = () => settingState.setting['player.isShowBluetoothLyric'] ?? true

// 最近一次「真实」歌词行（与开关无关地记录），供重新打开开关时立即补发当前行。
// 不能复用 playerState.lastLyric：关闭开关时它被有意写成 undefined（避免后续重发
// 路径把旧行写回 artist），若拿它当「当前行」会丢失真实行号。
let realCurrentLyric: string | undefined

/**
 * 应用「显示蓝牙歌词」开关（设置页切换时立即调用，无需等下一首/下一次歌词加载）。
 * 两条独立通路都要重新对齐，缺一不可：
 * 1) 原生歌词时间轴：关 → 传空数组（清行 + 停时钟），开 → 补交当前时间轴；
 * 2) JS 逐行元数据（artist）：关 → 立即用 undefined 重发一次，把卡片上残留的歌词行清掉；
 *    开 → 用当前真实行（realCurrentLyric）重发，避免要等下一行变化才恢复显示。
 * 必须在 iOS 下才有意义（其他平台走系统通知栏，不接受歌词行）。
 */
export const applyBluetoothLyricSetting = () => {
  if (Platform.OS != 'ios') return
  const on = isShowBluetoothLyric()
  if (on) {
    if (playerState.musicInfo.lrc) void setNowPlayingLyrics(getCurrentLyricLines())
    setLastLyric(realCurrentLyric)
    if (playerState.playMusicInfo.musicInfo) {
      void updateMetaData(playerState.musicInfo, playerState.isPlay, realCurrentLyric, true)
    }
  } else {
    void setNowPlayingLyrics([])
    // 清掉 state.lastLyric，否则后续 pause/play/调速等任一重发路径都会把旧歌词再写回 artist
    setLastLyric(undefined)
    if (playerState.playMusicInfo.musicInfo) {
      void updateMetaData(playerState.musicInfo, playerState.isPlay, undefined, true)
    }
  }
}


export default async(setting: LX.AppSetting) => {
  await initLyricPlayer()
  await Promise.all([
    setPlaybackRate(setting['player.playbackRate']),
    toggleTranslation(setting['player.isShowLyricTranslation']),
    toggleRoma(setting['player.isShowLyricRoma']),
  ])

  if (Platform.OS == 'ios') {
    let prevLyric: string | undefined
    onLyricPlay((line, text) => {
      // 无论开关如何都记录真实当前行：关闭期间「音箱只显示歌名」不应导致
      // 重新打开后丢失行号（否则要等下一行变化才恢复歌词显示）。
      realCurrentLyric = text || undefined
      // 蓝牙歌词关闭：不把歌词行交给元数据发布链路，artist 传 undefined（媒体卡片只留歌名·歌手）。
      // 注意仍要更新 prevLyric，否则重新打开开关时首行会因「与上次相同」被跳过。
      const lyric = isShowBluetoothLyric() ? realCurrentLyric : undefined
      if (lyric === prevLyric) return
      prevLyric = lyric
      setLastLyric(lyric)
      if (playerState.playMusicInfo.musicInfo) {
        void updateMetaData(playerState.musicInfo, playerState.isPlay, lyric, true)
      }
    })
  }


  // 歌词加载完成：iOS 侧在解析完成后把整条时间轴交给原生 NSTimer 驱动控制中心
  // 歌词（原生按锚点外推位置直接写 MPNowPlayingInfoCenter，不依赖 JS 定时器——
  // 下拉控制中心/锁屏时 App inactive，JS 定时器停转，歌词会冻结在打开前那行）。
  // 无歌词的歌（musicInfo.lrc 为空）传空数组，清掉原生侧残留的上一首时间轴。
  // 蓝牙歌词关闭时同样传空数组：原生 tick 与 JS 逐行钩子是两条独立通路，
  // 只关 JS 一侧的话，原生时钟仍会把歌词写进 artist（车机照样显示歌词）。
  global.app_event.on('lyricUpdated', () => {
    if (Platform.OS == 'ios') {
      void setLyric().then(() => {
        const lines = playerState.musicInfo.lrc && isShowBluetoothLyric() ? getCurrentLyricLines() : []
        void setNowPlayingLyrics(lines)
      })
    } else {
      setLyric()
    }
  })

  global.app_event.on('play', play)
  global.app_event.on('pause', pause)
  global.app_event.on('stop', stop)
  global.app_event.on('error', pause)
  global.app_event.on('seekLyric', seek)
  global.app_event.on('musicToggled', () => {
    // 切歌清掉「真实当前行」：否则在切歌瞬间打开蓝牙歌词开关，会把上一首的
    // 最后一行当作当前行补发出去（媒体卡片出现张冠李戴的那句歌词）。
    realCurrentLyric = undefined
    stop()
  })
}
