import { forwardRef, useImperativeHandle, useMemo, useState } from 'react'

import Basic from './settings/Basic'
import Player from './settings/Player'
import LyricDesktop from './settings/LyricDesktop'
import Search from './settings/Search'
import List from './settings/List'
import Download from './settings/Download'
import Sync from './settings/Sync'
import Backup from './settings/Backup'
import Other from './settings/Other'
import Version from './settings/Version'
import About from './settings/About'
import ThemeScreen from './settings/ThemeScreen'
import PlatformScreen from './settings/PlatformScreen'

export const SETTING_SCREENS = [
  'basic',
  'theme',
  'platform',
  'player',
  'lyric_desktop',
  'search',
  'list',
  'download',
  'sync',
  'backup',
  'other',
  'version',
  'about',
] as const

export type SettingScreenIds = (typeof SETTING_SCREENS)[number]

export interface MainType {
  setActiveId: (id: SettingScreenIds) => void
}

const Main = forwardRef<MainType, {}>((props, ref) => {
  const [id, setId] = useState(global.lx.settingActiveId)

  useImperativeHandle(ref, () => ({
    setActiveId(id) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setId(id)
        })
      })
    },
  }))

  const component = useMemo(() => {
    switch (id) {
      case 'theme':
        return <ThemeScreen />
      case 'platform':
        return <PlatformScreen />
      case 'player':
        return <Player />
      case 'lyric_desktop':
        return <LyricDesktop />
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
      case 'version':
        return <Version />
      case 'about':
        return <About />
      case 'basic':
      default:
        return <Basic />
    }
  }, [id])

  return component
})

export default Main
