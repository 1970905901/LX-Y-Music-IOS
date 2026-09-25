import { memo } from 'react'

import Section from '../../components/Section'
import AddMusicLocationType from './AddMusicLocationType'
import DiscoveryPlatformOrder from './DiscoveryPlatformOrder'
import IsClickPlayList from './IsClickPlayList'
import IsShowAlbumName from './IsShowAlbumName'
import IsShowInterval from './IsShowInterval'
import IsAutoSaveDailyRec from './IsAutoSaveDailyRec'

import MenuSettings from './MenuSettings'

export default memo(() => {
  return (
    <Section sectionId="setting_list">
      <IsClickPlayList />
      <IsShowAlbumName />
      <IsShowInterval />
      <IsAutoSaveDailyRec />
      <AddMusicLocationType />
      <MenuSettings />
      <DiscoveryPlatformOrder />
    </Section>
  )
})
