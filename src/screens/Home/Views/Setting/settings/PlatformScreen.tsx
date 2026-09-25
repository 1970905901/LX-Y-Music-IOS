import { memo } from 'react'
import Section from '../components/Section'
import WyCookie from './Basic/WyCookie'
import TxCookie from './Basic/TxCookie'
import KgCookie from './Basic/KgCookie'
import SerpApiKey from './Basic/SerpApiKey'
import WebLoginBtn from './Basic/WebLoginBtn'

export default memo(() => {
  return (
    <Section sectionId="setting_platform">
      <WyCookie />
      <TxCookie />
      <KgCookie />
      <SerpApiKey />
      <WebLoginBtn />
    </Section>
  )
})
