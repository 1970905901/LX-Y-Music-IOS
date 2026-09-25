import { memo } from 'react'

import Section from '../../components/Section'
import MetaCache from './MetaCache'
import DislikeList from './DislikeList'
import Log from './Log'
// import MaxCache from './MaxCache'

export default memo(() => {
  return (
    <Section sectionId="setting_other">
      <MetaCache />
      <DislikeList />
      <Log />
      {/* <MaxCache /> */}
    </Section>
  )
})
