import { useEffect, useMemo, useState } from 'react'
import Search from '../Views/Search'
import SongList from '../Views/SongList'
import Mylist from '../Views/Mylist'
import Leaderboard from '../Views/Leaderboard'
import Setting from '../Views/Setting'
import commonState, { type InitState as CommonState } from '@/store/common/state'
import DailyRec from '../Views/DailyRec'
import TXDailyRec from '../Views/DailyRec/TXDailyRec'
import MyPlaylist from '../Views/MyPlaylist'
import SubscribedAlbums from "@/screens/Home/Views/SubscribedAlbums"
import FollowedArtists from "@/screens/Home/Views/FollowedArtists"
import PlayHistory from '../Views/PlayHistory'
import WebDAV from '../Views/WebDAV'

import LocalDownload from '../Views/LocalDownload'
import TXPlaylist from '../Views/TxPlaylist'
import KgPlaylist from '../Views/KgPlaylist'
import KgDailyRec from '../Views/KgDailyRec'
import LandscapeCentered from '@/components/LandscapeCentered'

// 已做精细横屏（Vertical/Horizontal 双组件或自带 useHorizontalMode 横屏处理）的子页面不在此限宽；
// 其余纯竖屏子页面在 iPad 横屏右栏内统一限宽居中，避免列表行被拉得过长。竖屏不受任何影响（Main 仅横屏挂载）。
const EXCLUDED_LANDSCAPE_IDS = new Set([
  'nav_top',
  'nav_setting',
  'nav_subscribed_albums',
  'nav_followed_artists',
])

const Main = () => {
  const [id, setId] = useState(commonState.navActiveId)

  useEffect(() => {
    const handleUpdate = (id: CommonState['navActiveId']) => {
      requestAnimationFrame(() => {
        setId(id)
      })
    }
    global.state_event.on('navActiveIdUpdated', handleUpdate)
    return () => {
      global.state_event.off('navActiveIdUpdated', handleUpdate)
    }
  }, [])

  const component = useMemo(() => {
    switch (id) {
      case 'nav_play_history':
        return <PlayHistory />
      case 'nav_daily_rec':
        return <DailyRec />
      case 'nav_tx_daily_rec':
        return <TXDailyRec />
      case 'nav_my_playlist':
        return <MyPlaylist />
      case 'nav_songlist':
        return <SongList />
      case 'nav_top':
        return <Leaderboard />
      case 'nav_followed_artists':
        return <FollowedArtists />
      case 'nav_subscribed_albums':
        return <SubscribedAlbums />
      case 'nav_webdav':
        return <WebDAV />
      case 'nav_local_download':
        return <LocalDownload />
      case 'nav_tx_playlist':
        return <TXPlaylist />
      case 'nav_kg_playlist':
        return <KgPlaylist />
      case 'nav_kg_daily_rec':
        return <KgDailyRec />
      case 'nav_love':
        return <Mylist />
      case 'nav_setting':
        return <Setting />
      case 'nav_search':
      default:
        return <Search />
    }
  }, [id])

  return EXCLUDED_LANDSCAPE_IDS.has(id) ? component : <LandscapeCentered>{component}</LandscapeCentered>
}

export default Main
