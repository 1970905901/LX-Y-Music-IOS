import { useEffect } from 'react';
import { showVideoPlayer } from '@/navigation/utils';

// 监听“播放 MV”事件，改用 RNN 浮层（showOverlay）呈现视频，
// 使视频浮于播放详情页等所有页面之上，立即出现且可正常关闭。
export default () => {
  useEffect(() => {
    const handleShow = (url: string) => {
      showVideoPlayer(url);
    };
    global.app_event.on('showVideoPlayer', handleShow);
    return () => {
      global.app_event.off('showVideoPlayer', handleShow);
    };
  }, []);

  return null;
};
