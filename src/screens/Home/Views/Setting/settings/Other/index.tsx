import { memo } from 'react'

import Section from '../../components/Section'
import DislikeList from './DislikeList'
import Log from './Log'

export default memo(() => {
  return (
    <Section sectionId="setting_other">
      <DislikeList />
      <Log />
    </Section>
  )
})
