import { memo } from 'react'
import Section from '../components/Section'
import WyCookie from './Basic/WyCookie'
import TxCookie from './Basic/TxCookie'
import KgCookie from './Basic/KgCookie'
import SerpApiKey from './Basic/SerpApiKey'
import WebLoginBtn from './Basic/WebLoginBtn'
import SonglistCacheSync from './Basic/SonglistCacheSync'

export default memo(() => {
  return (
    <Section>
      <WyCookie />
      <TxCookie />
      <KgCookie />
      <SerpApiKey />
      <WebLoginBtn />
      <SonglistCacheSync />
    </Section>
  )
})
