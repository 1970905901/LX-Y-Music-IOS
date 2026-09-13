import { memo, useRef } from 'react'
import Btn from './Btn'
import SoundEffectPopup, { type SoundEffectPopupType } from '@/screens/PlayDetail/components/SoundEffectPopup'

export default memo(() => {
  const soundEffectPopupRef = useRef<SoundEffectPopupType>(null)
  return (
    <>
      <Btn icon="slider" onPress={() => soundEffectPopupRef.current?.show()} />
      <SoundEffectPopup ref={soundEffectPopupRef} />
    </>
  )
})
