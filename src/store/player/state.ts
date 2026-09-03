export interface InitState {
  playMusicInfo: {
    /**
     * 当前播放歌曲的列表 id
     */
    musicInfo: LX.Player.PlayMusicInfo['musicInfo'] | null
    /**
     * 当前播放歌曲的列表 id
     */
    listId: LX.Player.PlayMusicInfo['listId'] | null
    /**
     * 是否属于 “稍后播放”
     */
    isTempPlay: boolean
  }
  playInfo: LX.Player.PlayInfo
  musicInfo: LX.Player.MusicInfo

  isPlay: boolean
  volume: number
  playRate: number
  statusText: string

  /**
   * 当前实际播放的音质（如 'flac' | 'flac24bit' | 'hires' 等）。
   * 用于判断 seek 冻结同步逻辑仅对高于 flac 的音质生效。
   */
  quality: LX.Quality | null

  playedList: LX.Player.PlayMusicInfo[]
  tempPlayList: LX.Player.PlayMusicInfo[]

  loadErrorPicUrl: string

  progress: {
    nowPlayTime: number
    maxPlayTime: number
    progress: number
    nowPlayTimeStr: string
    maxPlayTimeStr: string
  }

  lastLyric: string | undefined
}

const state: InitState = {
  playInfo: {
    playIndex: -1,
    playerListId: null,
    playerPlayIndex: -1,
  },
  playMusicInfo: {
    listId: null,
    musicInfo: null,
    isTempPlay: false,
  },
  musicInfo: {
    id: null,
    pic: null,
    lrc: null,
    tlrc: null,
    rlrc: null,
    lxlrc: null,
    rawlrc: null,
    // url: null,
    name: '',
    alias: '',
    singer: '',
    album: '',
  },

  isPlay: false,
  volume: 1,
  playRate: 1,
  statusText: '',
  quality: null,
  loadErrorPicUrl: '',

  playedList: [],
  tempPlayList: [],

  progress: {
    nowPlayTime: 0,
    maxPlayTime: 0,
    progress: 0,
    nowPlayTimeStr: '00:00',
    maxPlayTimeStr: '00:00',
  },

  lastLyric: undefined,
}

export default state
