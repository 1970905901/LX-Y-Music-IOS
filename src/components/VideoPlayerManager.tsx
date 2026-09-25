import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Video, { type VideoRef } from 'react-native-video';
import { pause, play } from '@/core/player/player';
import playerState from '@/store/player/state';
import { syncNowPlayingState, syncNowPlayingMetadata } from '@/core/player/nowPlaying';

// 监听“播放 MV”事件，用 react-native-video 的 presentFullscreenPlayer 直接弹出
// iOS 系统全屏播放器（AVPlayerViewController），既浮于所有页面之上，又不会与
// 自定义浮层叠加出现“两个播放器重叠”。系统播放器自带关闭（Done）按钮。
// enabled：宿主页面在窗口上时才响应事件。presentFullscreenPlayer 依赖宿主视图
// 挂在窗口上（Home 被 push 的页面覆盖后脱离窗口，present 静默失败 = 点播放MV无反应），
// 因此 Home 与播放详情页各自挂载实例并按页面可见性启用，避免隐藏实例抢载视频源。
export default ({ enabled = true }: { enabled?: boolean }) => {
  const videoRef = useRef<VideoRef>(null);
  const [url, setUrl] = useState('');
  const wasPlayingRef = useRef(false);
  const shouldPresentRef = useRef(false);

  useEffect(() => {
    if (!enabled) return
    const handleShow = (u: string) => {
      // 打开 MV 前先暂停音频（等待暂停真正生效后再加载 MV），
      // 避免音频会话在 MV 弹出时仍处于播放态，导致控制中心/按钮状态错乱。
      wasPlayingRef.current = playerState.isPlay;
      shouldPresentRef.current = true;
      const openMv = () => setUrl(u);
      if (playerState.isPlay) {
        void pause().finally(openMv);
      } else {
        openMv();
      }
    };
    global.app_event.on('showVideoPlayer', handleShow);
    return () => {
      global.app_event.off('showVideoPlayer', handleShow);
    };
  }, [enabled]);

  // MV 关闭后，如果之前正在播放则自动恢复
  const handleDismiss = useCallback(() => {
    const shouldResume = wasPlayingRef.current;
    setUrl('');
    if (shouldResume) play();
    wasPlayingRef.current = false;
    // AVPlayerViewController 播放期间接管了控制中心（Now Playing），其 dismiss 是
    // 异步的，会在关闭后清空 MPNowPlayingInfoCenter。这里延迟重新发布歌曲的
    // 元数据与播放状态，避免被系统播放器 dismiss 的清理覆盖，导致关闭 MV 后
    // 控制中心 / 锁屏没有音频显示。
    setTimeout(() => {
      syncNowPlayingMetadata(true);
      void syncNowPlayingState(shouldResume ? 'play' : 'pause');
    }, 500);
  }, []);

  // 视频加载完成后立即弹出系统全屏播放器
  const handleLoad = useCallback(() => {
    if (shouldPresentRef.current) {
      shouldPresentRef.current = false;
      videoRef.current?.presentFullscreenPlayer?.();
    }
  }, []);

  if (!url || !enabled) return null;

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
