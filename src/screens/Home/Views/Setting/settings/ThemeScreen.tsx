import { memo } from 'react'
import Section from '../components/Section'
import Theme from './Theme/Theme'
import ThemeMode from './Theme/ThemeMode'
import IsDynamicBg from './Theme/IsDynamicBg'
import IsMylistDynamicBg from './Theme/IsMylistDynamicBg'
import IsLandscapeStretch from './Theme/IsLandscapeStretch'
import IsFontShadow from './Theme/IsFontShadow'
import Blur from './Theme/Blur'
import CustomBg from './Theme/CustomBg'
import PicOpacity from './Theme/PicOpacity'
import MiniPlayerOpacity from './Theme/MiniPlayerOpacity'
import SubContainerOpacity from './Theme/SubContainerOpacity'

export default memo(() => {
  return (
    <Section sectionId="setting_theme">
      <Theme />
      <ThemeMode />
      <IsDynamicBg />
      <IsMylistDynamicBg />
      <IsLandscapeStretch />
      <CustomBg />
      <PicOpacity />
      <Blur />
      <MiniPlayerOpacity />
      <SubContainerOpacity />
      <IsFontShadow />
    </Section>
  )
})
