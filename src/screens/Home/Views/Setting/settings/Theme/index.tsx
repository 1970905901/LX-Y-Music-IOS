import { memo } from 'react'

import Section from '../../components/Section'
import Theme from './Theme'
import ThemeMode from './ThemeMode'

import IsDynamicBg from './IsDynamicBg'
import IsFontShadow from './IsFontShadow'
import Blur from "@/screens/Home/Views/Setting/settings/Theme/Blur.tsx";
import CustomBg from "@/screens/Home/Views/Setting/settings/Theme/CustomBg.tsx";
import MiniPlayerOpacity from "@/screens/Home/Views/Setting/settings/Theme/MiniPlayerOpacity.tsx";
import PicOpacity from "@/screens/Home/Views/Setting/settings/Theme/PicOpacity.tsx";
import SectionOpacity from "@/screens/Home/Views/Setting/settings/Theme/SectionOpacity.tsx";
import SubContainerOpacity from "@/screens/Home/Views/Setting/settings/Theme/SubContainerOpacity.tsx";
import { useI18n } from '@/lang/i18n'

export default memo(() => {
  const t = useI18n()
  return (
    <Section title={t('setting_theme')} sectionId="setting_theme">
      <Theme />
      <ThemeMode />
      <IsDynamicBg />
      <CustomBg />
      <PicOpacity />
      <Blur />
      <MiniPlayerOpacity />
      <SectionOpacity />
      <SubContainerOpacity />
      <IsFontShadow />
    </Section>
  )
})
