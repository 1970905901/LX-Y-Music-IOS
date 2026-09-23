import { memo } from 'react'

import Section from '../../components/Section'
import Source from './Source'
import SourceName from './SourceName'
import Language from './Language'
import FontSize from './FontSize'
import ShareType from './ShareType'
import IsHomePageScroll from './IsHomePageScroll'
import IsAllowProgressBarSeek from './IsAllowProgressBarSeek'
import IsShowBackBtn from './IsShowBackBtn'
import IsShowExitBtn from './IsShowExitBtn'
import DrawerLayoutPosition from './DrawerLayoutPosition'
import IsShowMyListSubMenu from './IsShowMyListSubMenu'
import IsNewListUI from './IsNewListUI'
import { useI18n } from '@/lang/i18n'
import NavMenu from "@/screens/Home/Views/Setting/settings/Basic/NavMenu.tsx";

export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('setting_basic')} sectionId="setting_basic">
      <IsNewListUI />
      {global.lx.isCarMode ? (
        <>
          <IsShowBackBtn />
          <IsShowExitBtn />
        </>
      ) : null}
      <IsShowMyListSubMenu />
      <IsHomePageScroll />
      <IsAllowProgressBarSeek />
      <DrawerLayoutPosition />
      <NavMenu />
      <Language />
      <FontSize />
      <ShareType />
      <Source />
      <SourceName />
    </Section>
  )
})
