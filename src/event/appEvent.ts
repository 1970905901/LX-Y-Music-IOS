import Event from './Event'
import { type Source as SonglistSource } from '@/store/songlist/state'
import { type SearchType } from '@/store/search/state'
import DownloadTask = LX.Download.DownloadTask

// {
//   // sync: {
//   //   send_action_list: 'send_action_list',
//   //   handle_action_list: 'handle_action_list',
//   //   send_sync_list: 'send_sync_list',
//   //   handle_sync_list: 'handle_sync_list',
//   // },
// }

export class AppEvent extends Event {
  // configUpdate() {
  //   this.emit('configUpdate')
  // }

  focus() {
    this.emit('focus')
  }

  /**
   * My list updated
   */
  mylistUpdated(
    lists: Array<LX.List.MyDefaultListInfo | LX.List.MyLoveListInfo | LX.List.UserListInfo>,
  ) {
    this.emit('mylistUpdated', lists)
  }

  /**
   * My list toggled
   */
  mylistToggled(id: string) {
    this.emit('listToggled', id)
  }

  /**
   * Music info toggled
   */
  musicToggled() {
    this.emit('musicToggled')
  }

  /**
   * Manually change progress
   * @param progress progress
   */
  setProgress(progress: number, maxPlayTime?: number) {
    this.emit('setProgress', progress, maxPlayTime)
  }

  /**
   * 进度条拖动状态切换（开始/结束），用于暂停逐秒歌词重锚，避免把预览高亮拽回音频旧位置。
   */
  progressDragState(isDrag: boolean) {
    this.emit('progressDragState', isDrag)
  }

  /**
   * 音频 seek 完成后，用实际落点让歌词引擎重新对齐。
   * 参考 Q-1515/lx-music-mobile ios-adaptation：歌词由引擎内部 ticker 自行推进，
   * seek 结束后必须显式通知歌词跳转到引擎真实位置，否则快进/快退后歌词与音频脱节。
   */
  seekLyric(time: number) {
    this.emit('seekLyric', time)
  }

  /**
   * Set volume level
   * @param volume volume level
   */
  setVolume(volume: number) {
    this.emit('setVolume', volume)
  }

  /**
   * Set whether to mute
   * @param isMute whether to mute
   */
  setVolumeIsMute(isMute: boolean) {
    this.emit('setVolumeIsMute', isMute)
  }

  play() {
    this.emit('play')
  }

  pause() {
    this.emit('pause')
  }

  stop() {
    this.emit('stop')
  }

  error() {
    this.emit('error')
  }

  playerPlaying() {
    this.emit('playerPlaying')
  }

  playerPause() {
    this.emit('playerPause')
  }

  // playerStop() {
  //   this.emit('playerStop')
  // }

  playerEnded() {
    this.emit('playerEnded')
  }

  playerError() {
    this.emit('playerError')
  }

  // playerLoadeddata() {
  //   this.emit('playerLoadeddata')
  // }

  playerLoadstart() {
    this.emit('playerLoadstart')
  }

  // playerCanplay() {
  //   this.emit('playerCanplay')
  // }

  playerEmptied() {
    this.emit('playerEmptied')
  }

  playerWaiting() {
    this.emit('playerWaiting')
  }

  picUpdated() {
    this.emit('picUpdated')
  }

  webdavPicUpdated(musicId: string, picUrl: string) {
    this.emit('webdavPicUpdated', musicId, picUrl)
  }

  lyricUpdated() {
    this.emit('lyricUpdated')
  }

  lyricOffsetUpdate() {
    this.emit('lyricOffsetUpdate')
  }

  myListMusicUpdate(ids: string[]) {
    if (!ids.length) return
    this.emit('myListMusicUpdate', ids)
  }

  downloadListUpdate() {
    this.emit('downloadListUpdate')
  }

  musicInfoUpdate(musicInfo: LX.Music.MusicInfo) {
    this.emit('musicInfoUpdate', musicInfo)
  }

  playHistoryUpdated() {
    this.emit('playHistoryUpdated')
  }

  changeMenuVisible(visible: boolean) {
    this.emit('changeMenuVisible', visible)
  }

  /**
   * Search type changed event
   * @param type
   */
  searchTypeChanged(type: SearchType) {
    this.emit('searchTypeChanged', type)
  }

  searchDeepLink(keyword: string, source: string, type: string) {
    this.emit('searchDeepLink', keyword, source, type)
  }

  openSonglistImport() {
    this.emit('openSonglistImport')
  }

  changeLoveListVisible(visible: boolean) {
    this.emit('changeLoveListVisible', visible)
  }

  showSonglistTagList(source: SonglistSource, activeId: string) {
    this.emit('showSonglistTagList', source, activeId)
  }

  /**
   * 显示指定榜单：推荐页排行榜区块点击榜单卡片时调用。排行榜页一旦挂载就不会因
   * 切页而卸载（页面 visible 门控只在进入时置 true），仅靠“先存设置再跳转”无法
   * 更新已挂载实例，必须通过事件实时切换到目标榜单。
   */
  showBoardDetail(info: { source: LX.OnlineSource, boardId: string }) {
    this.emit('showBoardDetail', info)
  }

  hideSonglistTagList() {
    this.emit('hideSonglistTagList')
  }

  songlistTagInfoChange(name: string, id: string) {
    this.emit('songlistTagInfoChange', name, id)
  }

  selectSyncMode(mode: LX.Sync.ModeType) {
    this.emit('selectSyncMode', mode)
  }

  showArtistSelector(artists: any[], onSelect: (artist: any) => void) {
    this.emit('showArtistSelector', artists, onSelect)
  }

  triggerSearch(text: string) {
    this.emit('triggerSearch', text)
  }

  download_list_changed() {
    this.emit('download_list_changed')
  }

  download_task_add(task: DownloadTask) {
    this.emit('download_task_add', task)
  }

  download_progress_update(payload: { id: string, progress: DownloadTask['progress'] }) {
    this.emit('download_progress_update', payload)
  }

  download_status_update(payload: { id: string, status: DownloadTask['status'], errorMsg?: string }) {
    this.emit('download_status_update', payload)
  }

  download_metadata_update(payload: { id: string, metadataStatus: DownloadTask['metadataStatus'] }) {
    this.emit('download_metadata_update', payload)
  }

  /**
   * 实际音质确定（请求音质不支持而降级时）。
   * 单独发一个事件而不是让列表行去监听 download_list_changed：后者每次进度回调都会发，
   * 列表行若跟着做 O(n) 查找会随下载进度产生无谓开销（耗电）。
   */
  download_quality_update(payload: { id: string, actualQuality: LX.Quality }) {
    this.emit('download_quality_update', payload)
  }

  show_download_ball() {
    this.emit('show_download_ball')
  }

  playlist_updated(data: { source: string, listId: string }) {
    this.emit('playlist_updated', data)
  }

  showPlaylist() {
    this.emit('showPlaylist')
  }

  switchToLyricPage() {
    this.emit('switchToLyricPage')
  }

  showWebLogin() {
    this.emit('showWebLogin')
  }

  showTxWebLogin() {
    this.emit('showTxWebLogin')
  }

  showKgWebLogin() {
    this.emit('showKgWebLogin')
  }
}

type EventMethods = Omit<EventType, keyof Event>

declare class EventType extends AppEvent {
  on<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): any
  off<K extends keyof EventMethods>(event: K, listener: EventMethods[K]): any
}

export type AppEventTypes = Omit<EventType, keyof Omit<Event, 'on' | 'off'>>
export const createAppEventHub = (): AppEventTypes => {
  return new AppEvent()
}
