import { memo } from 'react'

import Section from '../../components/Section'
import Theme from './Theme'
import ThemeMode from './ThemeMode'

import IsDynamicBg from './IsDynamicBg'
import IsFontShadow from './IsFontShadow'
import Blur from '@/screens/Home/Views/Setting/settings/Theme/Blur.tsx'
import CustomBg from '@/screens/Home/Views/Setting/settings/Theme/CustomBg.tsx'
import PicOpacity from '@/screens/Home/Views/Setting/settings/Theme/PicOpacity.tsx'
import SectionOpacity from '@/screens/Home/Views/Setting/settings/Theme/SectionOpacity.tsx'
import SubContainerOpacity from '@/screens/Home/Views/Setting/settings/Theme/SubContainerOpacity.tsx'

export default memo(() => {
  return (
    <Section sectionId="setting_theme">
      <Theme />
      <ThemeMode />
      <IsDynamicBg />
      <CustomBg />
      <PicOpacity />
      <Blur />
      <SectionOpacity />
      <SubContainerOpacity />
      <IsFontShadow />
    </Section>
  )
})
