import { useEffect, useRef } from 'react';
import { showVideoPlayer } from '@/navigation/utils';
import { pause, play } from '@/core/player/player';
import playerState from '@/store/player/state';

// 监听“播放 MV”事件，改用 RNN 浮层（showOverlay）呈现视频，
// 使视频浮于播放详情页等所有页面之上，立即出现且可正常关闭。
export default () => {
  const wasPlayingRef = useRef(false)

  useEffect(() => {
    const handleShow = (url: string) => {
      // 打开 MV 前自动暂停音频，避免 MV 与歌曲同时出声
      wasPlayingRef.current = playerState.isPlay
      if (playerState.isPlay) void pause()
      showVideoPlayer(url, () => {
        // MV 关闭后，如果之前正在播放则自动恢复
        if (wasPlayingRef.current) play()
        wasPlayingRef.current = false
      });
    };
    global.app_event.on('showVideoPlayer', handleShow);
    return () => {
      global.app_event.off('showVideoPlayer', handleShow);
    };
  }, []);

  return null;
};
