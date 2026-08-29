// @flow

import { Navigation } from 'react-native-navigation'

import {
  Home,
  PlayDetail,
  SonglistDetail,
  Comment,
  ArtistDetail, AlbumDetail,
  SimilarSongs,
  // Setting,
} from '@/screens'
import { Provider } from '@/store/Provider'
import {
  HOME_SCREEN,
  PLAY_DETAIL_SCREEN,
  SONGLIST_DETAIL_SCREEN,
  COMMENT_SCREEN,
  PACT_MODAL,
  ARTIST_DETAIL_SCREEN,
  SYNC_MODE_MODAL,
  ALBUM_DETAIL_SCREEN, DOWNLOAD_MANAGER_SCREEN,
  SIMILAR_SONGS_SCREEN,
  ANNOUNCEMENT_MODAL,
  TOAST_SCREEN,
  VIDEO_PLAYER_SCREEN,
  // SETTING_SCREEN,
} from './screenNames'
import PactModal from './components/PactModal'
import SyncModeModal from './components/SyncModeModal'
import AnnouncementModal from './components/AnnouncementModal'
import DownloadManager from "@/screens/DownloadManager";
import ToastOverlay from './components/Toast'
import VideoPlayer from './components/VideoPlayer'
function WrappedComponent(Component: any) {
  return function inject(props: Record<string, any>) {
    const EnhancedComponent = () => (
      <Provider>
        <Component {...props} />
      </Provider>
    )

    return <EnhancedComponent />
  }
}

export default () => {
  Navigation.registerComponent(HOME_SCREEN, () => WrappedComponent(Home))
  Navigation.registerComponent(PLAY_DETAIL_SCREEN, () => WrappedComponent(PlayDetail))
  Navigation.registerComponent(SONGLIST_DETAIL_SCREEN, () => WrappedComponent(SonglistDetail))
  Navigation.registerComponent(COMMENT_SCREEN, () => WrappedComponent(Comment))
  Navigation.registerComponent(PACT_MODAL, () => WrappedComponent(PactModal))
  Navigation.registerComponent(ARTIST_DETAIL_SCREEN, () => WrappedComponent(ArtistDetail))
  Navigation.registerComponent(ALBUM_DETAIL_SCREEN, () => WrappedComponent(AlbumDetail))
  Navigation.registerComponent(SYNC_MODE_MODAL, () => WrappedComponent(SyncModeModal))
  Navigation.registerComponent(DOWNLOAD_MANAGER_SCREEN, () => WrappedComponent(DownloadManager))
  Navigation.registerComponent(SIMILAR_SONGS_SCREEN, () => WrappedComponent(SimilarSongs))
  Navigation.registerComponent(ANNOUNCEMENT_MODAL, () => WrappedComponent(AnnouncementModal))
  // MV 视频播放浮层：浮于所有页面（含播放详情页）之上，避免被详情页遮盖
  Navigation.registerComponent(VIDEO_PLAYER_SCREEN, () => WrappedComponent(VideoPlayer))
  // 非阻塞 Toast 浮层：用于替代 iOS 上的 Alert.alert，避免连续 toast 弹原生 Alert 堆叠导致整页卡死
  Navigation.registerComponent(TOAST_SCREEN, () => WrappedComponent(ToastOverlay))
  // Navigation.registerComponent(SETTING_SCREEN, () => WrappedComponent(Setting))

  console.info('All screens have been registered...')
}
