import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Video, { type VideoRef } from 'react-native-video';
import { pause, play } from '@/core/player/player';
import playerState from '@/store/player/state';

// 监听“播放 MV”事件，用 react-native-video 的 presentFullscreenPlayer 直接弹出
// iOS 系统全屏播放器（AVPlayerViewController），既浮于所有页面之上，又不会与
// 自定义浮层叠加出现“两个播放器重叠”。系统播放器自带关闭（Done）按钮。
export default () => {
  const videoRef = useRef<VideoRef>(null);
  const [url, setUrl] = useState('');
  const wasPlayingRef = useRef(false);
  const shouldPresentRef = useRef(false);

  useEffect(() => {
    const handleShow = (u: string) => {
      // 打开 MV 前自动暂停音频，避免 MV 与歌曲同时出声
      wasPlayingRef.current = playerState.isPlay;
      if (playerState.isPlay) void pause();
      shouldPresentRef.current = true;
      setUrl(u);
    };
    global.app_event.on('showVideoPlayer', handleShow);
    return () => {
      global.app_event.off('showVideoPlayer', handleShow);
    };
  }, []);

  // MV 关闭后，如果之前正在播放则自动恢复
  const handleDismiss = useCallback(() => {
    setUrl('');
    if (wasPlayingRef.current) play();
    wasPlayingRef.current = false;
  }, []);

  // 视频加载完成后立即弹出系统全屏播放器
  const handleLoad = useCallback(() => {
    if (shouldPresentRef.current) {
      shouldPresentRef.current = false;
      videoRef.current?.presentFullscreenPlayer?.();
    }
  }, []);

  if (!url) return null;

  return (
    <View style={styles.container}>
      <Video
        ref={videoRef}
        source={{ uri: url }}
        style={styles.video}
        controls={true}
        resizeMode="contain"
        playInBackground={false}
        onLoad={handleLoad}
        onError={handleDismiss}
        onFullscreenPlayerDidDismiss={handleDismiss}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
  video: {
    width: 1,
    height: 1,
  },
});
