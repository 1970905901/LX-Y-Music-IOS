import { memo } from 'react'

import Section from '../../components/Section'
import Part from './Part'
// import MaxCache from './MaxCache'

export default memo(() => {
  return (
    <Section>
      <Part />
      {/* <MaxCache /> */}
    </Section>
  )
})
