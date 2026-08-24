import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { View, StatusBar, BackHandler } from 'react-native'
import { Navigation } from 'react-native-navigation'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { usePlayMusicInfo } from '@/store/player/hook'
import { setComponentId, removeComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import { createStyle } from '@/utils/tools'
import { WebViewSyncManager } from './WebViewSyncManager'

const WEBVIEW_ASSETS = 'file:///android_asset/sonic-topography/index.html'

export default memo(({ componentId }: { componentId: string }) => {
  const webViewRef = useRef<WebView>(null)
  const syncRef = useRef<WebViewSyncManager | null>(null)
  const [ready, setReady] = useState(false)
  const [jsReady, setJsReady] = useState(false)
  const playMusicInfo = usePlayMusicInfo()
  const lastTrackRef = useRef('')

  useEffect(() => {
    setComponentId(COMPONENT_IDS.visualizer, componentId)
    return () => { removeComponentId(componentId) }
  }, [componentId])

  useEffect(() => {
    syncRef.current = new WebViewSyncManager(webViewRef)
    return () => {
      try {
        webViewRef.current?.injectJavaScript('window.pauseAudio&&window.pauseAudio()')
      } catch {}
      syncRef.current?.destroy()
      syncRef.current = null
    }
  }, [])

  useEffect(() => {
    const onBackPress = () => {
      try {
        webViewRef.current?.injectJavaScript('window.pauseAudio&&window.pauseAudio()')
      } catch {}
      syncRef.current?.destroy()
      setTimeout(() => {
        Navigation.pop(componentId)
      }, 150)
      return true
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress)
    return () => sub.remove()
  }, [componentId])

  useEffect(() => {
    if (!ready || !jsReady) return
    syncRef.current?.setReady(true)
    syncRef.current?.activate()
    const t1 = setTimeout(() => syncRef.current?.onTrackChanged(), 500)
    return () => { clearTimeout(t1) }
  }, [ready, jsReady])

  useEffect(() => {
    if (!ready || !jsReady || !playMusicInfo) return
    const key = `${playMusicInfo.musicInfo?.name || ''}_${playMusicInfo.musicInfo?.singer || ''}`
    if (key !== lastTrackRef.current && key !== '_') {
      lastTrackRef.current = key
      setTimeout(() => syncRef.current?.onTrackChanged(), 100)
    }
  }, [playMusicInfo, ready, jsReady])

  const onMsg = useCallback((e: WebViewMessageEvent) => { syncRef.current?.handleWebViewMessage(e) }, [])
  const onLoadEnd = useCallback(() => setReady(true), [])
  const onReady = useCallback(() => setJsReady(true), [])

  useEffect(() => { syncRef.current?.addSyncCallback((t) => { if (t === 'ready') onReady() }) }, [onReady])

  return (
    <View style={s.root}>
      <StatusBar hidden />
      <WebView
        ref={webViewRef}
        source={{ uri: WEBVIEW_ASSETS, headers: { 'Cache-Control': 'no-cache' } }}
        style={s.wv}
        onMessage={onMsg}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        automaticallyAdjustContentInsets={false}
        mixedContentMode="always"
        originWhitelist={['*']}
        allowFileAccess
        allowUniversalAccessFromFileURLs
        onLoadEnd={onLoadEnd}
        setWebContentsDebuggingEnabled
        androidLayerType="hardware"
      />
    </View>
  )
})

const s = createStyle({ root: { flex: 1, backgroundColor: '#000' }, wv: { flex: 1 } })
