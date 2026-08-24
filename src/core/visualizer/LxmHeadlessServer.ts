import { NativeModules } from 'react-native'
import { getMusicUrl, getLyricInfo } from '@/core/music/online'
import { getListMusicSync } from '@/utils/listManage'
import playerState from '@/store/player/state'

const { LocalProxy } = NativeModules

const SOURCE_REFERERS: Record<string, string> = {
  wy: 'https://music.163.com/',
  tx: 'https://y.qq.com/',
  kg: 'https://www.kuwo.cn/',
  mg: 'https://music.migu.cn/',
  bilibili: 'https://www.bilibili.com/',
}

class LxmHeadlessServer {
  private webViewRef: React.RefObject<any> = null
  private isReady = false
  private pendingMessages: string[] = []
  private proxyPort = -1

  setWebViewRef(ref: React.RefObject<any>) { this.webViewRef = ref }

  async initProxy() {
    if (this.proxyPort > 0) return this.proxyPort
    try {
      this.proxyPort = await LocalProxy.start()
      return this.proxyPort
    } catch {
      return -1
    }
  }

  proxyUrl(url: string): string {
    if (this.proxyPort <= 0 || !url.startsWith('http')) return url
    const mi = (playerState.playMusicInfo as any)?.musicInfo
    const source = mi?.source || ''
    let referer = SOURCE_REFERERS[source] || ''
    if (source === 'bilibili') {
      const bvid = (mi?.meta as any)?._bilibiliData?.bvid || (mi?.meta as any)?.albumName || ''
      if (bvid) referer = `https://www.bilibili.com/video/${bvid}`
    }
    return `http://127.0.0.1:${this.proxyPort}/proxy?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(referer)}`
  }

  stopProxy() {
    if (this.proxyPort > 0) {
      LocalProxy.stop()
      this.proxyPort = -1
    }
  }

  setReady(ready: boolean) {
    this.isReady = ready
    if (ready) {
      this.initProxy()
      if (this.pendingMessages.length > 0) {
        this.pendingMessages.forEach(m => this.sendRaw(m))
        this.pendingMessages = []
      }
    }
  }

  private sendRaw(json: string) {
    try {
      const js = `window.__handleRNMessage && window.__handleRNMessage(${JSON.stringify(json)})`
      if (!this.webViewRef?.current) return
      this.webViewRef.current.injectJavaScript(js)
    } catch {}
  }

  send(type: string, data: Record<string, any> = {}) {
    if (type === 'loadAndPlay' && data.url && data.url.includes('bilivideo.com') && !data.url.includes('mcdn.bilivideo')) {
      data.url = this.proxyUrl(data.url)
    }
    const msg = JSON.stringify({ type, ...data })
    if (!this.isReady) { this.pendingMessages.push(msg); return }
    this.sendRaw(msg)
  }

  private static QUALITY_FALLBACK = ['320k', '128k'] as const

  async getSongUrl(): Promise<string> {
    const pMusicInfo = (playerState.playMusicInfo as any)?.musicInfo
    if (!pMusicInfo) return ''

    const available = Object.keys((pMusicInfo.meta as any)?._qualitys ?? {}) as string[]
    const qualitiesToTry = LxmHeadlessServer.QUALITY_FALLBACK.filter(q => available.includes(q) || q === '128k')

    for (const q of qualitiesToTry) {
      try {
        const url = await getMusicUrl({ musicInfo: pMusicInfo, quality: q as any, isRefresh: false, allowToggleSource: false })
        if (url && url.length > 10) return url
      } catch {}
    }

    return ''
  }

  async getPlaylist() {
    try {
      const listId = playerState.playMusicInfo?.listId
      if (!listId) return []
      const list = getListMusicSync(listId)
      if (!list?.length) return []
      return list.map((t: any, i: number) => ({ id: String(t.id || ''), title: t.name || t.title || '', artist: t.singer || t.artist || '', index: i }))
    } catch {
      return []
    }
  }

  async getLrc(): Promise<string> {
    const pMusicInfo = (playerState.playMusicInfo as any)?.musicInfo
    if (!pMusicInfo) return ''

    const cached = (playerState as any).musicInfo?.lrc
    if (cached && cached.length > 10) return cached

    try {
      const info = await getLyricInfo({ musicInfo: pMusicInfo as any, isRefresh: false, allowToggleSource: false })
      const lrcText = info?.lyric || ''
      if (lrcText && lrcText.length > 10) return lrcText
    } catch {}

    return ''
  }

}

export const lxmHeadlessServer = new LxmHeadlessServer()
