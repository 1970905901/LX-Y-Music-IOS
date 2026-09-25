// @flow

import { Navigation } from 'react-native-navigation'

import {
  Home,
  PlayDetail,
  SonglistDetail,
  Comment,
  ArtistDetail, AlbumDetail,
  SimilarSongs,
  SettingDetail,
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
  SETTING_DETAIL_SCREEN,
  ANNOUNCEMENT_MODAL,
  TOAST_SCREEN,
  // SETTING_SCREEN,
} from './screenNames'
import PactModal from './components/PactModal'
import SyncModeModal from './components/SyncModeModal'
import AnnouncementModal from './components/AnnouncementModal'
import DownloadManager from '@/screens/DownloadManager'
import ToastOverlay from './components/Toast'
function WrappedComponent(Component: any) {
  return function inject(props: Record<string, any>) {
    return (
      <Provider>
        <Component {...props} />
      </Provider>
    )
  }
}

const HomeProvider = WrappedComponent(Home)
const PlayDetailProvider = WrappedComponent(PlayDetail)
const SonglistDetailProvider = WrappedComponent(SonglistDetail)
const CommentProvider = WrappedComponent(Comment)
const ArtistDetailProvider = WrappedComponent(ArtistDetail)
const AlbumDetailProvider = WrappedComponent(AlbumDetail)
const SimilarSongsProvider = WrappedComponent(SimilarSongs)
const PactModalProvider = WrappedComponent(PactModal)
const SyncModeModalProvider = WrappedComponent(SyncModeModal)
const AnnouncementModalProvider = WrappedComponent(AnnouncementModal)
const DownloadManagerProvider = WrappedComponent(DownloadManager)
const SettingDetailProvider = WrappedComponent(SettingDetail)
const ToastOverlayProvider = WrappedComponent(ToastOverlay)

export default () => {
  Navigation.registerComponent(HOME_SCREEN, () => HomeProvider)
  Navigation.registerComponent(PLAY_DETAIL_SCREEN, () => PlayDetailProvider)
  Navigation.registerComponent(SONGLIST_DETAIL_SCREEN, () => SonglistDetailProvider)
  Navigation.registerComponent(COMMENT_SCREEN, () => CommentProvider)
  Navigation.registerComponent(PACT_MODAL, () => PactModalProvider)
  Navigation.registerComponent(ARTIST_DETAIL_SCREEN, () => ArtistDetailProvider)
  Navigation.registerComponent(ALBUM_DETAIL_SCREEN, () => AlbumDetailProvider)
  Navigation.registerComponent(SYNC_MODE_MODAL, () => SyncModeModalProvider)
  Navigation.registerComponent(DOWNLOAD_MANAGER_SCREEN, () => DownloadManagerProvider)
  Navigation.registerComponent(SIMILAR_SONGS_SCREEN, () => SimilarSongsProvider)
  Navigation.registerComponent(SETTING_DETAIL_SCREEN, () => SettingDetailProvider)
  Navigation.registerComponent(ANNOUNCEMENT_MODAL, () => AnnouncementModalProvider)
  // 非阻塞 Toast 浮层：用于替代 iOS 上的 Alert.alert，避免连续 toast 弹原生 Alert 堆叠导致整页卡死
  Navigation.registerComponent(TOAST_SCREEN, () => ToastOverlayProvider)
  // Navigation.registerComponent(SETTING_SCREEN, () => WrappedComponent(Setting))

  console.info('All screens have been registered...')
}
