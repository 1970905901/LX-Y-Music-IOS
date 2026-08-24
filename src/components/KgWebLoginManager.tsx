import { useEffect, useRef, useState } from 'react';
import KgWebLoginModal, { type KgWebLoginModalType } from './KgWebLoginModal';

export default () => {
  const modalRef = useRef<KgWebLoginModalType>(null);
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

    global.app_event.on('showKgWebLogin', handleShow);
    return () => {
      global.app_event.off('showKgWebLogin', handleShow);
    };
  }, [visible]);

  return visible ? <KgWebLoginModal ref={modalRef} /> : null;
};