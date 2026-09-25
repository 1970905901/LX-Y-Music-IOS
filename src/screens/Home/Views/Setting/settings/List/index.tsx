import { memo } from 'react'

import Section from '../../components/Section'
import AddMusicLocationType from './AddMusicLocationType'
import IsClickPlayList from './IsClickPlayList'
import IsShowAlbumName from './IsShowAlbumName'
import IsShowInterval from './IsShowInterval'
import IsAutoSaveDailyRec from './IsAutoSaveDailyRec';

import MenuSettings from "@/screens/Home/Views/Setting/settings/List/MenuSettings.tsx";

export default memo(() => {

  return (
    <Section sectionId="setting_list">
      <IsClickPlayList />
      <IsShowAlbumName />
      <IsShowInterval />
      <IsAutoSaveDailyRec />
      <AddMusicLocationType />
      <MenuSettings />
    </Section>
  )
})
