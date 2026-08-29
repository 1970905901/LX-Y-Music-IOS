import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native'
import { Navigation } from 'react-native-navigation'
import Video, { type VideoRef } from 'react-native-video'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'

// MV 视频播放浮层：通过 RNN showOverlay 渲染，浮于所有页面（含播放详情页）之上，
// 因此点击“播放 MV”后会立即出现在最上层，而不是被播放详情页遮盖、
// 直到关闭详情页才露出来。关闭浮层即卸载 Video 组件并停止播放，避免后台继续出声/卡顿。
const VideoPlayer = ({ componentId, url }: { componentId: string; url: string }) => {
  const theme = useTheme()
  const videoRef = useRef<VideoRef>(null)
  const [loading, setLoading] = useState(true)

  const handleClose = useCallback(() => {
    // 先暂停，避免 iOS 上卸载后仍残留音频
    try {
      videoRef.current?.pause?.()
    } catch {}
    void Navigation.dismissOverlay(componentId)
  }, [componentId])

  // 卸载时确保暂停，防止浮层被其他方式销毁后音频残留
  useEffect(() => {
    return () => {
      try {
        videoRef.current?.pause?.()
      } catch {}
    }
  }, [])

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.7}>
        <Text style={[styles.closeText, { color: theme['c-font'] }]}>✕</Text>
      </TouchableOpacity>
      {url ? (
        <Video
          ref={videoRef}
          source={{ uri: url }}
          style={styles.video}
          controls={true}
          resizeMode="contain"
          playInBackground={false}
          onLoadStart={() => setLoading(true)}
          onLoad={() => setLoading(false)}
          onError={() => handleClose()}
        />
      ) : null}
      {loading && <ActivityIndicator style={styles.loading} size="large" color="#FFF" />}
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
  },
  closeBtn: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 10,
    paddingTop: 20,
    paddingRight: 20,
    paddingLeft: 20,
    paddingBottom: 20,
  },
  closeText: {
    fontSize: 26,
    fontWeight: '700',
  },
  loading: {
    position: 'absolute',
  },
})

VideoPlayer.options = {
  layout: {
    componentBackgroundColor: 'transparent',
  },
  overlay: {
    interceptTouchOutside: false,
  },
  statusBar: {
    drawBehind: true,
    visible: true,
    style: 'light',
    backgroundColor: 'transparent',
  },
}

export default VideoPlayer
