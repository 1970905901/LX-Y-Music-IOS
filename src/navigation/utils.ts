import { Navigation } from 'react-native-navigation'
import { VERSION_MODAL, PACT_MODAL, SYNC_MODE_MODAL, ANNOUNCEMENT_MODAL } from './screenNames'
import themeState from '@/store/theme/state'

const pendingOverlays = new Set<string>()

export const getStatusBarStyle = (isDark: boolean) => (isDark ? 'light' : 'dark')

// RNN dismissOverlay 偶发失败（重复 dismiss / 竞态时原生侧抛错且 Promise reject）。
// 透明 overlay 一旦残留，interceptTouchOutside: true 会拦截全屏触摸，
// 表现为整页点不动的“假死”，故失败时记录并重试一次。
export const dismissOverlay = async(compId: string) => {
  try {
    await Navigation.dismissOverlay(compId)
  } catch (err) {
    console.warn('[navigation] dismissOverlay failed, retrying:', compId, err)
    try {
      await Navigation.dismissOverlay(compId)
    } catch (retryErr) {
      console.error('[navigation] dismissOverlay retry failed:', compId, retryErr)
    }
  }
}

// pop 不带自定义转场：RNN iOS 的自定义转场被取消（如动画期间再次导航）或 JS 空闲时
// 永不调用 completeTransition，会把整个导航栈卡死。全 app 的 push/pop 统一走系统默认
// 动画，由 UIKit 处理打断，无此问题（详见 navigation.ts pushPlayDetailScreen 注释）。
export const pop = async(compId: string) => Navigation.pop(compId)
export const popToRoot = async(compId: string) => Navigation.popToRoot(compId)
export const popTo = async(compId: string) => Navigation.popTo(compId)

export const showPactModal = () => {
  if (pendingOverlays.has(PACT_MODAL)) return
  pendingOverlays.add(PACT_MODAL)
  setTimeout(() => pendingOverlays.delete(PACT_MODAL), 500)
  const theme = themeState.theme

  // overlay 展示失败必须兜底重试：协议弹窗是首次安装的「准入」弹窗，一旦静默失败
  // （窗口未就绪、转场竞态等），用户会在未同意协议的情况下直接使用，且要到下次启动才会再弹。
  // 重试间隔取去抖窗口之后（600ms），最多 3 次；成功时 Promise resolve，不再重试。
  const show = (attempt: number) => {
    const handleFail = (err: unknown) => {
      console.error('[Pact] showOverlay failed:', attempt, err)
      if (attempt >= 3) return
      setTimeout(() => { show(attempt + 1) }, 600)
    }
    try {
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
      }).catch(handleFail)
    } catch (err) {
      handleFail(err)
    }
  }
  show(1)
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
