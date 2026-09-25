import { memo } from 'react'

import Section from '../../components/Section'
import Source from './Source'
import SourceName from './SourceName'
import Language from './Language'
import FontSize from './FontSize'
import ShareType from './ShareType'
import IsAllowProgressBarSeek from './IsAllowProgressBarSeek'
import IsShowBackBtn from './IsShowBackBtn'
import IsShowExitBtn from './IsShowExitBtn'
import DrawerLayoutPosition from './DrawerLayoutPosition'

export default memo(() => {

  return (
    <Section sectionId="setting_basic">
      {global.lx.isCarMode ? (
        <>
          <IsShowBackBtn />
          <IsShowExitBtn />
        </>
      ) : null}
      <IsAllowProgressBarSeek />
      <DrawerLayoutPosition />
      <Language />
      <FontSize />
      <ShareType />
      <Source />
      <SourceName />
    </Section>
  )
})
