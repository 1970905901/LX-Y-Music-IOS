import { useEffect, useRef, useState } from 'react';
import YouTubeLoginModal, { type YouTubeLoginModalType } from './YouTubeLoginModal';

export default () => {
  const modalRef = useRef<YouTubeLoginModalType>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleShow = () => {
      if (visible) {
        modalRef.current?.show();
      } else {
        setVisible(true);
        requestAnimationFrame(() => {
          modalRef.current?.show();
        });
      }
    };

    global.app_event.on('showYouTubeLogin', handleShow);
    return () => {
      global.app_event.off('showYouTubeLogin', handleShow);
    };
  }, [visible]);

  return visible ? <YouTubeLoginModal ref={modalRef} /> : null;
};
