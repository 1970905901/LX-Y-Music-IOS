import { memo } from 'react'
import Section from '../components/Section'
import { useI18n } from '@/lang/i18n'
import WyCookie from './Basic/WyCookie'
import TxCookie from './Basic/TxCookie'
import KgCookie from './Basic/KgCookie'
import SerpApiKey from './Basic/SerpApiKey'
import WebLoginBtn from './Basic/WebLoginBtn'

export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('setting_platform')} sectionId="setting_platform">
      <WyCookie />
      <TxCookie />
      <KgCookie />
      <SerpApiKey />
      <WebLoginBtn />
    </Section>
  )
})
