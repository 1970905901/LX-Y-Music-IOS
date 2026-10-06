import { memo } from 'react'

import Section from '../../components/Section'
import IsSavePlayTime from './IsSavePlayTime'
import IsAutoPlayOnStartup from './IsAutoPlayOnStartup'
import IsAutoCleanPlayedList from './IsAutoCleanPlayedList'
import IsAutoSkipOnError from './IsAutoSkipOnError'
import IsHandleAudioFocus from './IsHandleAudioFocus'
import IsEnableAudioOffload from './IsEnableAudioOffload'
import IsEnableAudioPreload from './IsEnableAudioPreload'
import UseNativeFlacPlayer from './UseNativeFlacPlayer'
import IsShowLyricTranslation from './IsShowLyricTranslation'
import IsShowLyricRoma from './IsShowLyricRoma'
import IsShowBluetoothLyric from './IsShowBluetoothLyric'
import IsS2T from './IsS2T'
import CardSelfCheck from './CardSelfCheck'
import ClearCache from './ClearCache'
import PlayHighQuality from './PlayHighQuality'

export default memo(() => {
  return (
    <Section>
      <IsSavePlayTime />
      <IsAutoPlayOnStartup />
      <IsAutoCleanPlayedList />
      <IsAutoSkipOnError />
      <IsHandleAudioFocus />
      <IsEnableAudioOffload />
      <IsEnableAudioPreload />
      <UseNativeFlacPlayer />
      <IsShowLyricTranslation />
      <IsShowLyricRoma />
      <IsShowBluetoothLyric />
      <IsS2T />
      <CardSelfCheck />
      <ClearCache />
      <PlayHighQuality />
    </Section>
  )
})
