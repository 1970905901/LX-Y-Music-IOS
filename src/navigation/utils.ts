import { Navigation } from 'react-native-navigation'
import { VERSION_MODAL, PACT_MODAL, SYNC_MODE_MODAL, ANNOUNCEMENT_MODAL, VIDEO_PLAYER_SCREEN } from './screenNames'
import themeState from '@/store/theme/state'

const pendingOverlays = new Set<string>()

export const getStatusBarStyle = (isDark: boolean) => (isDark ? 'light' : 'dark')

export const dismissOverlay = async (compId: string) => Navigation.dismissOverlay(compId)

export const pop = async (compId: string) => Navigation.pop(compId)
export const popToRoot = async (compId: string) => Navigation.popToRoot(compId)
export const popTo = async (compId: string) => Navigation.popTo(compId)

export const showPactModal = () => {
  if (pendingOverlays.has(PACT_MODAL)) return
  pendingOverlays.add(PACT_MODAL)
  setTimeout(() => pendingOverlays.delete(PACT_MODAL), 500)
  const theme = themeState.theme

  void Navigation.showOverlay({
    component: {
      name: PACT_MODAL,
      options: {
        layout: {
          componentBackgroundColor: 'transparent',
        },
        overlay: {
          interceptTouchOutside: true,
        },
        statusBar: {
          drawBehind: true,
          visible: true,
          style: getStatusBarStyle(theme.isDark),
          backgroundColor: 'transparent',
        },
        navigationBar: {
          // visible: false,
          backgroundColor: theme['c-content-background'],
        },
        // animations: {

        //   showModal: {
        //     enter: {
        //       enabled: true,
        //       alpha: {
        //         from: 0,
        //         to: 1,
        //         duration: 300,
        //       },
        //     },
        //     exit: {
        //       enabled: true,
        //       alpha: {
        //         from: 1,
        //         to: 0,
        //         duration: 300,
        //       },
        //     },
        //   },
        // },
      },
    },
  })
}

export const showVersionModal = () => {
  if (pendingOverlays.has(VERSION_MODAL)) return
  pendingOverlays.add(VERSION_MODAL)
  setTimeout(() => pendingOverlays.delete(VERSION_MODAL), 500)
  const theme = themeState.theme

  void Navigation.showOverlay({
    component: {
      name: VERSION_MODAL,
      options: {
        layout: {
          componentBackgroundColor: 'transparent',
        },
        overlay: {
          interceptTouchOutside: true,
        },
        statusBar: {
          drawBehind: true,
          visible: true,
          style: getStatusBarStyle(theme.isDark),
          backgroundColor: 'transparent',
        },
        navigationBar: {
          // visible: false,
          backgroundColor: theme['c-content-background'],
        },
        // animations: {

        //   showModal: {
        //     enter: {
        //       enabled: true,
        //       alpha: {
        //         from: 0,
        //         to: 1,
        //         duration: 300,
        //       },
        //     },
        //     exit: {
        //       enabled: true,
        //       alpha: {
        //         from: 1,
        //         to: 0,
        //         duration: 300,
        //       },
        //     },
        //   },
        // },
      },
    },
  })
}

export const showSyncModeModal = () => {
  if (pendingOverlays.has(SYNC_MODE_MODAL)) return
  pendingOverlays.add(SYNC_MODE_MODAL)
  setTimeout(() => pendingOverlays.delete(SYNC_MODE_MODAL), 500)
  const theme = themeState.theme

  void Navigation.showOverlay({
    component: {
      name: SYNC_MODE_MODAL,
      options: {
        layout: {
          componentBackgroundColor: 'transparent',
        },
        overlay: {
          interceptTouchOutside: true,
        },
        statusBar: {
          drawBehind: true,
          visible: true,
          style: getStatusBarStyle(theme.isDark),
          backgroundColor: 'transparent',
        },
        navigationBar: {
          // visible: false,
          backgroundColor: theme['c-content-background'],
        },
        // animations: {

        //   showModal: {
        //     enter: {
        //       enabled: true,
        //       alpha: {
        //         from: 0,
        //         to: 1,
        //         duration: 300,
        //       },
        //     },
        //     exit: {
        //       enabled: true,
        //       alpha: {
        //         from: 1,
        //         to: 0,
        //         duration: 300,
        //       },
        //     },
        //   },
        // },
      },
    },
  })
}

// export const showToast = (text) => {
//   Navigation.showOverlay({
//     component: {
//       name: TOAST_SCREEN,
//     },
//   })
// }

// MV 视频播放：作为浮层显示在所有页面（含播放详情页）之上，
// 避免被详情页遮盖导致“点播放 MV 后不立即出现、关闭详情页才露出、且后台持续出声卡顿”。
export const showVideoPlayer = (url: string, onDismiss?: () => void) => {
  if (pendingOverlays.has(VIDEO_PLAYER_SCREEN)) return
  pendingOverlays.add(VIDEO_PLAYER_SCREEN)
  setTimeout(() => pendingOverlays.delete(VIDEO_PLAYER_SCREEN), 500)
  const theme = themeState.theme

  void Navigation.showOverlay({
    component: {
      name: VIDEO_PLAYER_SCREEN,
      passProps: { url, onDismiss },
      options: {
        layout: {
          componentBackgroundColor: 'transparent',
        },
        overlay: {
          interceptTouchOutside: false,
        },
        statusBar: {
          drawBehind: true,
          visible: true,
          style: getStatusBarStyle(theme.isDark),
          backgroundColor: 'transparent',
        },
      },
    },
  })
}

export const showAnnouncementModal = () => {
  if (pendingOverlays.has(ANNOUNCEMENT_MODAL)) return
  pendingOverlays.add(ANNOUNCEMENT_MODAL)
  setTimeout(() => pendingOverlays.delete(ANNOUNCEMENT_MODAL), 500)
  console.log('[Announcement] showAnnouncementModal called')
  const theme = themeState.theme
  console.log('[Announcement] Theme loaded:', !!theme)

  try {
    void Navigation.showOverlay({
      component: {
        name: ANNOUNCEMENT_MODAL,
        options: {
          layout: {
            componentBackgroundColor: 'transparent',
          },
          overlay: {
            interceptTouchOutside: true,
          },
          statusBar: {
            drawBehind: true,
            visible: true,
            style: getStatusBarStyle(theme.isDark),
            backgroundColor: 'transparent',
          },
          navigationBar: {
            backgroundColor: theme['c-content-background'],
          },
        },
      },
    }).then(() => {
      console.log('[Announcement] Overlay shown successfully')
    }).catch((err) => {
      console.error('[Announcement] Failed to show overlay:', err)
    })
  } catch (err) {
    console.error('[Announcement] Exception showing overlay:', err)
  }
}
