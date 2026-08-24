import { memo } from 'react'

import Section from '../../components/Section'
import ResourceCache from './ResourceCache'
import MetaCache from './MetaCache'
import DislikeList from './DislikeList'
import Log from './Log'
import IsShowStartupGreeting from './IsShowStartupGreeting'
import HideNavigationBar from '../Basic/HideNavigationBar'
// import MaxCache from './MaxCache'
import { useI18n } from '@/lang'

export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('setting_other')} sectionId="setting_other">
      <HideNavigationBar />
      <IsShowStartupGreeting />
      <ResourceCache />
      <MetaCache />
      <DislikeList />
      <Log />
      {/* <MaxCache /> */}
    </Section>
  )
})
