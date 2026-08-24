import { memo } from 'react'
import Section from '../components/Section'
import { useI18n } from '@/lang/i18n'
import Theme from './Theme/Theme'
import IsAutoTheme from './Theme/IsAutoTheme'
import IsDynamicBg from './Theme/IsDynamicBg'
import IsSidebarDynamicBg from './Theme/IsSidebarDynamicBg'
import IsMylistDynamicBg from './Theme/IsMylistDynamicBg'
import IsLandscapeStretch from './Theme/IsLandscapeStretch'
import IsFontShadow from './Theme/IsFontShadow'
import Blur from './Theme/Blur'
import CustomBg from './Theme/CustomBg'
import PicOpacity from './Theme/PicOpacity'
import SectionOpacity from './Theme/SectionOpacity'
import SubContainerOpacity from './Theme/SubContainerOpacity'

export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('setting_theme')} sectionId="setting_theme">
      <Theme />
      <IsAutoTheme />
      <IsDynamicBg />
      <IsSidebarDynamicBg />
      <IsMylistDynamicBg />
      <IsLandscapeStretch />
      <CustomBg />
      <PicOpacity />
      <Blur />
      <SectionOpacity />
      <SubContainerOpacity />
      <IsFontShadow />
    </Section>
  )
})
