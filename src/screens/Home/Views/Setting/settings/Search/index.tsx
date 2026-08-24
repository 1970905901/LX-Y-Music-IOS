import { memo } from 'react'

import Section from '../../components/Section'
import IsShowHotSearch from './IsShowHotSearch'
import IsShowHistorySearch from './IsShowHistorySearch'
import BilibiliMultiPage from './BilibiliMultiPage'
import QualityShowHighest from './QualityShowHighest'
import SearchSourceFilter from './SearchSourceFilter'

import { useI18n } from '@/lang'

export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('setting_search')} sectionId="setting_search">
      <IsShowHotSearch />
      <IsShowHistorySearch />
      <BilibiliMultiPage />
      <QualityShowHighest />
      <SearchSourceFilter />
    </Section>
  )
})