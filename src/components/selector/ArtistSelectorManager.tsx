import { useEffect, useRef, useState } from 'react'
import ArtistSelectorModal, { type ArtistSelectorModalType, type Artist } from './ArtistSelectorModal'

export default () => {
  const modalRef = useRef<ArtistSelectorModalType>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handleShow = (artists: Artist[], onSelect: (artist: Artist) => void) => {
      if (visible) {
        modalRef.current?.show(artists, onSelect)
      } else {
        setVisible(true)
        requestAnimationFrame(() => {
          modalRef.current?.show(artists, onSelect)
        })
      }
    }

    global.app_event.on('showArtistSelector', handleShow)

    return () => {
      global.app_event.off('showArtistSelector', handleShow)
    }
  }, [visible])

  return visible ? <ArtistSelectorModal ref={modalRef} /> : null
}
