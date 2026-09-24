import { memo, useEffect, useState } from 'react'
import { ScrollView } from 'react-native'
import { subscribeScrollLock } from '@/utils/scrollLock'

import Basic from '../settings/Basic'
import Player from '../settings/Player'
import Search from '../settings/Search'
import List from '../settings/List'
import Sync from '../settings/Sync'
import Download from '../settings/Download'
import Backup from '../settings/Backup'
import Other from '../settings/Other'
import About from '../settings/About'
import ThemeScreen from '../settings/ThemeScreen'
import PlatformScreen from '../settings/PlatformScreen'
import { createStyle } from '@/utils/tools'
import { designSpacing } from '@/theme/DesignTokens'
import { SETTING_SCREENS, type SettingScreenIds } from '../Main'

const styles = createStyle({
  content: {
    paddingLeft: designSpacing.md,
    paddingRight: designSpacing.md,
    paddingTop: designSpacing.md,
    paddingBottom: designSpacing.lg,
    flex: 0,
    backgroundColor: 'transparent',
  },
})

const ListItem = memo(
  ({ id }: { id: SettingScreenIds }) => {
    switch (id) {
      case 'theme':
        return <ThemeScreen />
      case 'platform':
        return <PlatformScreen />
      case 'player':
        return <Player />
      case 'search':
        return <Search />
      case 'list':
        return <List />
      case 'download':
        return <Download />
      case 'sync':
        return <Sync />
      case 'backup':
        return <Backup />
      case 'other':
        return <Other />
      case 'about':
        return <About />
      case 'basic':
        return <Basic />
    }
  },
  () => true,
)

export default () => {
  const [scrollLocked, setScrollLocked] = useState(false)
  useEffect(() => subscribeScrollLock(setScrollLocked), [])

  return (
    <ScrollView keyboardShouldPersistTaps={'always'} contentContainerStyle={styles.content} scrollEnabled={!scrollLocked}>
      {SETTING_SCREENS.map(id => <ListItem id={id} key={id} />)}
    </ScrollView>
  )
}
