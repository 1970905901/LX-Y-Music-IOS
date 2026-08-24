import { MUSIC_TOGGLE_MODE } from '@/config/constant'
import { updateSetting } from '@/core/common'
import AsyncStorage from '@react-native-async-storage/async-storage'
import playerState from '@/store/player/state'
import { lxmHeadlessServer } from '@/core/visualizer/LxmHeadlessServer'

export type PlayMode = 'listLoop' | 'singleLoop' | 'random' | 'list' | 'none'
type SyncCallback = (type: string, data: any) => void

export class WebViewSyncManager {
  private syncCallbacks: SyncCallback[] = []
  private isSwitchingTrack = false
  private lastSwitchTime = 0
  private expectedSongId = ''
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private playlist: Array<{ id: string; title: string; artist: string; index: number }> = []
  private currentIndex = -1
  private playMode: PlayMode = 'listLoop'
  private dispatchLock = false

  private static SWITCH_DEBOUNCE_MS = 800
  private static POLL_INTERVAL = 150
  private static POLL_TIMEOUT = 8000

  constructor(webViewRef: React.RefObject<any>) {
    lxmHeadlessServer.setWebViewRef(webViewRef)
    this.loadPlayMode()
  }

  addSyncCallback(cb: SyncCallback) { this.syncCallbacks.push(cb) }

  activate() {}
  deactivate() { this.isSwitchingTrack = false; this.expectedSongId = ''; if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null } }

  private canSwitchTrack() {
    if (this.isSwitchingTrack) return false
    if (Date.now() - this.lastSwitchTime < WebViewSyncManager.SWITCH_DEBOUNCE_MS) return false
    return true
  }

  private getCurrentUIId() { return (playerState.playMusicInfo as any)?.musicInfo?.id || '' }

  private markSwitchStart(id: string) { this.isSwitchingTrack = true; this.lastSwitchTime = Date.now(); this.expectedSongId = id }
  private markSwitchEnd() { this.isSwitchingTrack = false; this.expectedSongId = ''; if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null } }

  private async switchToTrack(newIndex: number) {
    const listId = playerState.playMusicInfo?.listId
    const item = this.playlist[newIndex]
    if (!listId || !item) return
    this.lastDispatchedId = ''
    this.markSwitchStart(item.id)
    try {
      const { playListHeadlessServer } = await import('@/core/player/player')
      await playListHeadlessServer(listId, newIndex)
      this.pollDataReady(item.id)
    } catch {
      this.markSwitchEnd()
    }
  }

  private lastDispatchedId = ''

  private pollDataReady(expectedId: string) {
    if (this.lastDispatchedId === expectedId) return
    if (this.pollTimer) clearTimeout(this.pollTimer)
    const t0 = Date.now()
    const poll = () => {
      const uiId = this.getCurrentUIId()
      if (uiId === expectedId) { this.markSwitchEnd(); this.lastDispatchedId = expectedId; setTimeout(() => this.dispatch(), 100); return }
      if (Date.now() - t0 > WebViewSyncManager.POLL_TIMEOUT) { this.markSwitchEnd(); this.lastDispatchedId = expectedId; this.dispatch(); return }
      this.pollTimer = setTimeout(poll, WebViewSyncManager.POLL_INTERVAL)
    }
    this.pollTimer = setTimeout(poll, WebViewSyncManager.POLL_INTERVAL)
  }

  onTrackChanged() {
    if (this.isSwitchingTrack) return
    const id = this.getCurrentUIId()
    if (id) this.pollDataReady(id)
  }

  setReady(ready: boolean) {
    lxmHeadlessServer.setReady(ready)
    if (ready) this.syncCallbacks.forEach(cb => cb('ready', {}))
  }

  private getNextIndex(direction: 'next' | 'prev'): number {
    if (this.playlist.length === 0) return -1
    if (direction === 'prev') return (this.currentIndex - 1 + this.playlist.length) % this.playlist.length
    switch (this.playMode) {
      case 'singleLoop': return this.currentIndex
      case 'random': {
        if (this.playlist.length <= 1) return 0
        let next: number
        do { next = Math.floor(Math.random() * this.playlist.length) } while (next === this.currentIndex)
        return next
      }
      case 'list': return this.currentIndex + 1 < this.playlist.length ? this.currentIndex + 1 : -1
      case 'listLoop':
      default: return (this.currentIndex + 1) % this.playlist.length
    }
  }

  handleWebViewMessage(event: any) {
    try {
      const data = JSON.parse(event.nativeEvent.data)
      switch (data.type) {
        case 'ready': this.setReady(true); break
        case 'playbackState': if (!this.isSwitchingTrack && data.ended) this.handleEnded(); break
        case 'prev': { if (this.canSwitchTrack()) { const i = this.getNextIndex('prev'); if (i >= 0) this.switchToTrack(i) } break }
        case 'next': { if (this.canSwitchTrack()) { const i = this.getNextIndex('next'); if (i >= 0) this.switchToTrack(i) } break }
        case 'playFromList': if (data.index != null && this.canSwitchTrack()) this.switchToTrack(data.index); break
        case 'playMode': this.setPlayMode(data.mode || 'listLoop'); break
        case 'needTrackData': if (!this.isSwitchingTrack) this.dispatch(); break
        case 'exitSync': this.deactivate(); break
      }
      this.syncCallbacks.forEach(cb => cb(data.type, data))
    } catch {}
  }

  private handleEnded() {
    if (!this.canSwitchTrack()) return
    const i = this.getNextIndex('next')
    if (i >= 0) this.switchToTrack(i)
  }

  private async dispatch() {
    if (this.dispatchLock) return
    this.dispatchLock = true
    try {
      const pMusicInfo = (playerState.playMusicInfo as any)?.musicInfo
      if (!pMusicInfo) return
      const uiId = pMusicInfo.id || ''
      if (this.expectedSongId && uiId !== this.expectedSongId) return

      const [url, lrc] = await Promise.all([
        lxmHeadlessServer.getSongUrl(),
        lxmHeadlessServer.getLrc(),
      ])
      if (!url) return

      const list = await lxmHeadlessServer.getPlaylist()
      this.playlist = list
      this.currentIndex = list.findIndex(i => i.title === (pMusicInfo.name || ''))
      if (this.currentIndex < 0) this.currentIndex = 0

      lxmHeadlessServer.send('loadAndPlay', {
        id: uiId, title: pMusicInfo.name || '', singer: pMusicInfo.singer || '',
        url, pic: pMusicInfo.meta?.picUrl || '',
        duration: this.parseInterval(pMusicInfo.interval), album: pMusicInfo.meta?.albumName || '',
        lrc: lrc || '',
      })
      if (list.length > 0) {
        lxmHeadlessServer.send('loadPlaylist', { list, currentIndex: this.currentIndex })
      }
      lxmHeadlessServer.send('playMode', { mode: this.playMode })
    } finally {
      this.dispatchLock = false
    }
  }

  async setPlayMode(mode: PlayMode) {
    this.playMode = mode
    try {
      await AsyncStorage.setItem('viz_play_mode', mode)
      const map: Record<string, string> = { singleLoop: MUSIC_TOGGLE_MODE.singleLoop, random: MUSIC_TOGGLE_MODE.random, list: MUSIC_TOGGLE_MODE.list }
      await updateSetting({ 'player.togglePlayMethod': map[mode] || MUSIC_TOGGLE_MODE.listLoop })
      lxmHeadlessServer.send('playMode', { mode })
    } catch {}
  }

  private async loadPlayMode() {
    try { const s = await AsyncStorage.getItem('viz_play_mode'); if (s && ['listLoop', 'singleLoop', 'random', 'list'].includes(s)) this.playMode = s as PlayMode } catch {}
  }

  private parseInterval(s: string | null | undefined): number {
    if (!s || typeof s !== 'string') return 0
    const p = s.split(':')
    return p.length === 2 ? (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0) : 0
  }

  destroy() {
    this.deactivate()
    try {
      lxmHeadlessServer.send('exitSync', {})
      this.webViewRef.current?.injectJavaScript('window.pauseAudio()')
    } catch {}
    this.syncCallbacks = []
    this.playlist = []
    this.lastDispatchedId = ''
  }
}
