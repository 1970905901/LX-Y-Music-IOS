import { memo } from 'react'

import Section from '../../components/Section'
import IsSavePlayTime from './IsSavePlayTime'
import PlayHighQuality from './PlayHighQuality'
import IsHandleAudioFocus from './IsHandleAudioFocus'
import IsEnableAudioOffload from './IsEnableAudioOffload'
import IsEnableAudioPreload from './IsEnableAudioPreload'
import UseNativeFlacPlayer from './UseNativeFlacPlayer'
import IsAutoCleanPlayedList from './IsAutoCleanPlayedList'
import IsAutoSkipOnError from './IsAutoSkipOnError'
import IsShowLyricTranslation from './IsShowLyricTranslation'
import IsShowLyricRoma from './IsShowLyricRoma'
import IsShowBluetoothLyric from './IsShowBluetoothLyric'
import IsS2T from './IsS2T'
import ClearCache from './ClearCache'
import IsAutoPlayOnReturn from './IsAutoPlayOnReturn'

export default memo(() => {
  return (
    <Section sectionId="setting_player">
      <IsSavePlayTime />
      <IsAutoPlayOnReturn />
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
      <ClearCache />
      <PlayHighQuality />
    </Section>
  )
})
