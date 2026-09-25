import { memo } from 'react'

import Section from '../../components/Section'
import IsShowHotSearch from './IsShowHotSearch'
import IsShowHistorySearch from './IsShowHistorySearch'
import BilibiliMultiPage from './BilibiliMultiPage'
import QualityShowHighest from './QualityShowHighest'
import SearchSourceFilter from './SearchSourceFilter'


export default memo(() => {
  return (
    <Section sectionId="setting_search">
      <IsShowHotSearch />
      <IsShowHistorySearch />
      <BilibiliMultiPage />
      <QualityShowHighest />
      <SearchSourceFilter />
    </Section>
  )
})
