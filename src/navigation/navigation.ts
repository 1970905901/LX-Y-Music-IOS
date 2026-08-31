import { Navigation } from 'react-native-navigation'


import {
  HOME_SCREEN,
  PLAY_DETAIL_SCREEN,
  SONGLIST_DETAIL_SCREEN,
  SIMILAR_SONGS_SCREEN,
  COMMENT_SCREEN, ARTIST_DETAIL_SCREEN, ALBUM_DETAIL_SCREEN, DOWNLOAD_MANAGER_SCREEN,
} from './screenNames'

import themeState from '@/store/theme/state'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import commonState from '@/store/common/state'
import { NAV_SHEAR_NATIVE_IDS, COMPONENT_IDS } from '@/config/constant'
import { getStatusBarStyle } from './utils'
import { windowSizeTools } from '@/utils/windowSizeTools'
import { type ListInfoItem } from '@/store/songlist/state'

// const store = getStore()
// const getTheme = () => getter('common', 'theme')(store.getState())


// 集中管理各界面 push 的进行中状态，防止快速重复点击/滑动导致界面卡死。
const pendingPushes = new Set<string>()
const isTopScreen = (id: COMPONENT_IDS) => {
  const ids = commonState.componentIds
  return ids.length > 0 && ids[ids.length - 1]?.name === id
}
const startPush = (id: COMPONENT_IDS, allowSameTop = false) => {
  if (pendingPushes.has(id)) return false
  if (!allowSameTop && isTopScreen(id)) return false
  pendingPushes.add(id)
  // 安全兜底：即使 push 的 Promise 始终不结算（如 RNN 返回 undefined 或原生转场挂起），
  // 也确保锁最终释放，避免界面永久卡死只能重启。
  setTimeout(() => { endPush(id) }, 3000)
  return true
}
const endPush = (id: COMPONENT_IDS) => { pendingPushes.delete(id) }
const guardPush = async (promise: Promise<string> | undefined, id: COMPONENT_IDS): Promise<void> => {
  try {
    await promise
  } catch {}
  endPush(id)
}

// 方向策略（一个包适配 iPhone/iPad）：
// 各页面已显式声明 orientation: ['portrait', 'landscape']，实际可旋转范围由系统级
// Info.plist 裁决——iPhone 系统仅竖屏 -> 实际只能竖屏；iPad 系统竖横均支持 -> 可竖可横
// （横屏时走响应式横屏布局）。不再提供手动横屏开关。
// 注意：RNN 只识别 options.layout.orientation，写在 options 顶层不会生效。


export async function pushHomeScreen() {
  // iOS 安全区适配：默认给所有 screen 顶部/底部均保留安全区。
  // 顶部安全区刘海/状态栏由 RNN 原生统一处理，避免 SizeView 在 iOS 上
  // StatusBar.currentHeight 为 0 导致 Header 被刘海遮挡。
  Navigation.setDefaultOptions({
    layout: {
      // @ts-expect-error RNN 运行期支持的安全区选项，当前类型未声明
      safeAreaInsets: {
        top: 'always',
        bottom: 'always',
      },
    },
  })

  /*
    Navigation.setDefaultOptions({
      topBar: {
        background: {
          color: '#039893',
        },
        title: {
          color: 'white',
        },
        backButton: {
          title: '', // Remove previous screen name from back button
          color: 'white',
        },
        buttonColor: 'white',
      },
      statusBar: {
        style: 'light',
      },
      layout: {
        orientation: ['portrait'],
      },
      bottomTabs: {
        titleDisplayMode: 'alwaysShow',
      },
      bottomTab: {
        textColor: 'gray',
        selectedTextColor: 'black',
        iconColor: 'gray',
        selectedIconColor: 'black',
      },
    })
  */

  const theme = themeState.theme

  return Navigation.setRoot({
    root: {
      stack: {
        children: [
          {
            component: {
              name: HOME_SCREEN,
              options: {
                topBar: {
                  visible: false,
                  height: 0,
                  drawBehind: false,
                },
                statusBar: {
                  drawBehind: true,
                  visible: true,
                  style: getStatusBarStyle(theme.isDark),
                  backgroundColor: 'transparent',
                },
                navigationBar: {
          visible: true,
          backgroundColor: theme['c-content-background'],
        },
                layout: {
                  orientation: ['portrait', 'landscape'],
                  componentBackgroundColor: theme['c-content-background'],
                  fitSystemWindows: false,
                  // @ts-expect-error RNN 运行期支持的安全区选项，当前类型未声明
                  safeAreaInsets: {
                    top: 'always',
                    bottom: 'always',
                  },
                },
                gestureEnabled: false,
              },
            },
          },
        ],
      },
    },
  })
}
export function pushPlayDetailScreen(componentId: string, skipAnimation = false) {
  if (!startPush(COMPONENT_IDS.playDetail)) return
  // 未载入任何歌曲时不打开播放详情页，避免空状态导致卡死
  if (!playerState.playMusicInfo.musicInfo) {
    endPush(COMPONENT_IDS.playDetail)
    return
  }
  /*
    Navigation.setDefaultOptions({
      topBar: {
        background: {
          color: '#039893',
        },
        title: {
          color: 'white',
        },
        backButton: {
          title: '', // Remove previous screen name from back button
          color: 'white',
        },
        buttonColor: 'white',
      },
      statusBar: {
        style: 'light',
      },
      layout: {
        orientation: ['portrait'],
      },
      bottomTabs: {
        titleDisplayMode: 'alwaysShow',
      },
      bottomTab: {
        textColor: 'gray',
        selectedTextColor: 'black',
        iconColor: 'gray',
        selectedIconColor: 'black',
      },
    })
  */
  requestAnimationFrame(() => {
    const theme = themeState.theme
    // 不使用 sharedElementTransitions / elementTransitions：iOS 上 RNN 共享元素转场会把
    // 封面 Image 在原生层劫持成中间态（巨大、错位、静止），导致竖屏播放页封面异常。
    // 进入/返回统一用整页 alpha 淡入淡出：更接近原生全屏播放器（如系统音乐）的柔和过渡，
    // 且能消除默认右侧滑入“白屏滑入”的生硬跳变。背景白→彩的淡入仍由 PageContent 负责，
    // 与整页 alpha 同步，形成“淡现 + 底色渐显”的连贯观感。
    const playDetailAnimations = skipAnimation
      ? { push: {}, pop: { content: { alpha: { from: 1, to: 0, duration: 300 } } } }
      : {
          push: { content: { alpha: { from: 0, to: 1, duration: 350 } } },
          pop: { content: { alpha: { from: 1, to: 0, duration: 300 } } },
        }

    // 原生转场背景色需与页面实际背景一致，否则 push 转场瞬间颜色跳变（闪屏）。
    // PageContent 有背景图时实际背景是 c-content-background（模糊封面 + 底色），
    // 无背景图时内容层用 c-main-background，两者在深色主题下色值不同，需动态匹配。
    const hasBgPic = !!(commonState.bgPic || settingState.setting['theme.customBgPicPath'])
    const componentBackgroundColor = hasBgPic ? theme['c-content-background'] : theme['c-main-background']

    void guardPush(Navigation.push(componentId, {
      component: {
        name: PLAY_DETAIL_SCREEN,
        options: {
          topBar: {
            visible: false,
            height: 0,
            drawBehind: false,
          },
          statusBar: {
            drawBehind: true,
            visible: true,
            style: getStatusBarStyle(theme.isDark),
            backgroundColor: 'transparent',
          },
          navigationBar: {
            visible: true,
            backgroundColor: theme['c-content-background'],
          },
          layout: {
            orientation: ['portrait', 'landscape'],
            componentBackgroundColor,
                  fitSystemWindows: false,
                  // @ts-expect-error RNN 运行期支持的安全区选项，当前类型未声明
                  safeAreaInsets: {
                    top: 'always',
                    bottom: 'always',
                  },
          },
          ...(playDetailAnimations ? { animations: playDetailAnimations } : {}),
        },
      },
    }),
      COMPONENT_IDS.playDetail)
  })
}

export function pushSonglistDetailScreen(componentId: string, info: ListInfoItem) {
  if (!startPush(COMPONENT_IDS.songlistDetail)) return
  const theme = themeState.theme

  requestAnimationFrame(() => {
    void guardPush(Navigation.push(componentId, {
      component: {
        name: SONGLIST_DETAIL_SCREEN,
        passProps: {
          info,
        },
        options: {
          topBar: {
            visible: false,
            height: 0,
            drawBehind: false,
          },
          statusBar: {
            drawBehind: true,
            visible: true,
            style: getStatusBarStyle(theme.isDark),
            backgroundColor: 'transparent',
          },
          navigationBar: {
            visible: true,
            backgroundColor: theme['c-content-background'],
          },
          layout: {
            orientation: ['portrait', 'landscape'],
            componentBackgroundColor: theme['c-content-background'],
                  fitSystemWindows: false,
                  // @ts-expect-error RNN 运行期支持的安全区选项，当前类型未声明
                  safeAreaInsets: {
                    top: 'always',
                    bottom: 'always',
                  },
          },
          animations: {
            push: {
              sharedElementTransitions: [
                {
                  fromId: `${NAV_SHEAR_NATIVE_IDS.songlistDetail_pic}_from_${info.id}`,
                  toId: `${NAV_SHEAR_NATIVE_IDS.songlistDetail_pic}_to_${info.id}`,
                  interpolation: { type: 'spring' },
                },
              ],
              elementTransitions: [
                {
                  id: NAV_SHEAR_NATIVE_IDS.songlistDetail_title,
                  alpha: {
                    from: 0, // We don't declare 'to' value as that is the element's current alpha value, here we're essentially animating from 0 to 1
                    duration: 300,
                  },
                  translationX: {
                    from: 16, // Animate translationX from 16dp to 0dp
                    duration: 300,
                  },
                },
              ],
              // content: {
              //   scaleX: {
              //     from: 1.2,
              //     to: 1,
              //     duration: 200,
              //   },
              //   scaleY: {
              //     from: 1.2,
              //     to: 1,
              //     duration: 200,
              //   },
              //   alpha: {
              //     from: 0,
              //     to: 1,
              //     duration: 200,
              //   },
              // },
            },
            pop: {
              sharedElementTransitions: [
                {
                  fromId: `${NAV_SHEAR_NATIVE_IDS.songlistDetail_pic}_to_${info.id}`,
                  toId: `${NAV_SHEAR_NATIVE_IDS.songlistDetail_pic}_from_${info.id}`,
                  interpolation: { type: 'spring' },
                },
              ],
              elementTransitions: [
                {
                  id: NAV_SHEAR_NATIVE_IDS.songlistDetail_title,
                  alpha: {
                    to: 0, // We don't declare 'to' value as that is the element's current alpha value, here we're essentially animating from 0 to 1
                    duration: 300,
                  },
                  translationX: {
                    to: 16, // Animate translationX from 16dp to 0dp
                    duration: 300,
                  },
                },
              ],
              // content: {
              //   alpha: {
              //     from: 1,
              //     to: 0,
              //     duration: 200,
              //   },
              // },
            },
          },
        },
      },
    }),
      COMPONENT_IDS.songlistDetail)
  })
}
export function pushCommentScreen(componentId: string) {
  if (!startPush(COMPONENT_IDS.comment)) return
  /*
    Navigation.setDefaultOptions({
      topBar: {
        background: {
          color: '#039893',
        },
        title: {
          color: 'white',
        },
        backButton: {
          title: '', // Remove previous screen name from back button
          color: 'white',
        },
        buttonColor: 'white',
      },
      statusBar: {
        style: 'light',
      },
      layout: {
        orientation: ['portrait'],
      },
      bottomTabs: {
        titleDisplayMode: 'alwaysShow',
      },
      bottomTab: {
        textColor: 'gray',
        selectedTextColor: 'black',
        iconColor: 'gray',
        selectedIconColor: 'black',
      },
    })
  */
  requestAnimationFrame(() => {
    const theme = themeState.theme

    void guardPush(Navigation.push(componentId, {
      component: {
        name: COMMENT_SCREEN,
        options: {
          topBar: {
            visible: false,
            height: 0,
            drawBehind: false,
          },
          statusBar: {
            drawBehind: true,
            visible: true,
            style: getStatusBarStyle(theme.isDark),
            backgroundColor: 'transparent',
          },
          navigationBar: {
            visible: true,
            backgroundColor: theme['c-content-background'],
          },
          layout: {
            orientation: ['portrait', 'landscape'],
            componentBackgroundColor: theme['c-content-background'],
                  fitSystemWindows: false,
                  // @ts-expect-error RNN 运行期支持的安全区选项，当前类型未声明
                  safeAreaInsets: {
                    top: 'always',
                    bottom: 'always',
                  },
          },
          animations: {
            push: {
              content: {
                translationX: {
                  from: windowSizeTools.getSize().width,
                  to: 0,
                  duration: 300,
                },
              },
            },
            pop: {
              content: {
                translationX: {
                  from: 0,
                  to: windowSizeTools.getSize().width,
                  duration: 300,
                },
              },
            },
          },
        },
      },
    }),
      COMPONENT_IDS.comment)
  })
}

// export function pushSettingScreen(componentId: string) {
//   /*
//     Navigation.setDefaultOptions({
//       topBar: {
//         background: {
//           color: '#039893',
//         },
//         title: {
//           color: 'white',
//         },
//         backButton: {
//           title: '', // Remove previous screen name from back button
//           color: 'white',
//         },
//         buttonColor: 'white',
//       },
//       statusBar: {
//         style: 'light',
//       },
//       layout: {
//         orientation: ['portrait'],
//       },
//       bottomTabs: {
//         titleDisplayMode: 'alwaysShow',
//       },
//       bottomTab: {
//         textColor: 'gray',
//         selectedTextColor: 'black',
//         iconColor: 'gray',
//         selectedIconColor: 'black',
//       },
//     })
//   */
//     const theme = themeState.theme

//     void Navigation.push(componentId, {
//       component: {
//         name: SETTING_SCREEN,
//         options: {
//           topBar: {
//             visible: false,
//             height: 0,
//             drawBehind: false,
//           },
//           statusBar: {
//             drawBehind: true,
//             visible: true,
//             style: getStatusBarStyle(theme.isDark),
//             backgroundColor: 'transparent',
//           },
//           navigationBar: {
//             // visible: false,
//             backgroundColor: theme['c-content-background'],
//           },
//           layout: {
//             componentBackgroundColor: theme['c-content-background'],
//             fitSystemWindows: false,
//           },
//           animations: {
//             push: {
//               content: {
//                 translationX: {
//                   from: windowSizeTools.getSize().width,
//                   to: 0,
//                   duration: 300,
//                 },
//               },
//             },
//             pop: {
//               content: {
//                 translationX: {
//                   from: 0,
//                   to: windowSizeTools.getSize().width,
//                   duration: 300,
//                 },
//               },
//             },
//           },
//         },
//       },
//   })
// }

/*
export function pushSingleScreenApp() {
  Navigation.setRoot({
    root: {
      stack: {
        children: [{
          component: {
            name: SINGLE_APP_SCREEN,
            options: {
              topBar: {
                title: {
                  text: 'SINGLE SCREEN APP',
                },
                leftButtons: [
                  {
                    id: 'nav_user_btn',
                    icon: require('assets/icons/ic_nav_user.png'),
                    color: 'white',
                  },
                ],
                rightButtons: [
                  {
                    id: 'nav_logout_btn',
                    icon: require('assets/icons/ic_nav_logout.png'),
                    color: 'white',
                  },
                ],
              },
            },
          },
        }],
      },
    },
  })
}

export function pushTabBasedApp() {
  Navigation.setRoot({
    root: {
      bottomTabs: {
        children: [{
          stack: {
            children: [{
              component: {
                name: TAB1_SCREEN,
                options: {
                  topBar: {
                    title: {
                      text: 'TAB 1',
                    },
                    leftButtons: [
                      {
                        id: 'nav_user_btn',
                        icon: require('assets/icons/ic_nav_user.png'),
                        color: 'white',
                      },
                    ],
                    rightButtons: [
                      {
                        id: 'nav_logout_btn',
                        icon: require('assets/icons/ic_nav_logout.png'),
                        color: 'white',
                      },
                    ],
                  },
                },
              },
            }],
            options: {
              bottomTab: {
                icon: require('assets/icons/ic_tab_home.png'),
                testID: 'FIRST_TAB_BAR_BUTTON',
                text: 'Tab1',
              },
            },
          },
        },
        {
          stack: {
            children: [{
              component: {
                name: TAB2_SCREEN,
                options: {
                  topBar: {
                    title: {
                      text: 'TAB 2',
                    },
                    leftButtons: [
                      {
                        id: 'nav_user_btn',
                        icon: require('assets/icons/ic_nav_user.png'),
                        color: 'white',
                      },
                    ],
                    rightButtons: [
                      {
                        id: 'nav_logout_btn',
                        icon: require('assets/icons/ic_nav_logout.png'),
                        color: 'white',
                      },
                    ],
                  },
                },
              },
            }],
            options: {
              bottomTab: {
                icon: require('assets/icons/ic_tab_menu.png'),
                testID: 'SECOND_TAB_BAR_BUTTON',
                text: 'Tab2',
              },
            },
          },
        }],
      },
    },
  })
}
 */
export function pushArtistDetailScreen(componentId: string, artistInfo: { id: string, mid?: string, name: string, picUrl?: string, source?: string }) {
  // allowSameTop: 允许从「歌手详情页」跳转到另一个「歌手详情页」（如相似歌手入口），
  // 否则 startPush 会因 isTopScreen(ARTIST_DETAIL) 直接拦截，导致相似歌手点击无响应。
  if (!startPush(COMPONENT_IDS.ARTIST_DETAIL, true)) return
  const theme = themeState.theme
  void guardPush(Navigation.push(componentId, {
    component: {
      name: ARTIST_DETAIL_SCREEN,
      passProps: {
        artistInfo,
      },
      options: {
        topBar: {
          visible: false,
          height: 0,
        },
        statusBar: {
          drawBehind: true,
          visible: true,
          style: getStatusBarStyle(theme.isDark),
          backgroundColor: 'transparent',
        },
        layout: {
          orientation: ['portrait', 'landscape'],
          componentBackgroundColor: theme['c-content-background'],
                  fitSystemWindows: false,
        },
        animations: {
          push: {
            content: {
              translationX: {
                from: windowSizeTools.getSize().width,
                to: 0,
                duration: 200,
              },
            },
          },
          pop: {
            content: {
              translationX: {
                from: 0,
                to: windowSizeTools.getSize().width,
                duration: 200,
              },
            },
          },
        },
      },
    },
  }),
    COMPONENT_IDS.ARTIST_DETAIL)
}

export function pushAlbumDetailScreen(componentId: string, albumInfo: any) {
  if (!startPush(COMPONENT_IDS.ALBUM_DETAIL_SCREEN)) return
  const theme = themeState.theme
  void guardPush(Navigation.push(componentId, {
    component: {
      name: ALBUM_DETAIL_SCREEN,
      passProps: {
        albumInfo,
      },
      options: {
        topBar: {
          visible: false,
          height: 0,
        },
        statusBar: {
          drawBehind: true,
          visible: true,
          style: getStatusBarStyle(theme.isDark),
          backgroundColor: 'transparent',
        },
        layout: {
          orientation: ['portrait', 'landscape'],
          componentBackgroundColor: theme['c-content-background'],
                  fitSystemWindows: false,
        },
        animations: {
          push: {
            content: {
              translationX: {
                from: windowSizeTools.getSize().width,
                to: 0,
                duration: 200,
              },
            },
          },
          pop: {
            content: {
              translationX: {
                from: 0,
                to: windowSizeTools.getSize().width,
                duration: 200,
              },
            },
          },
        },
      },
    },
  }),
    COMPONENT_IDS.ALBUM_DETAIL_SCREEN)
}


export function pushDownloadManagerScreen(componentId: string) {
  if (!startPush(COMPONENT_IDS.DOWNLOAD_MANAGER)) return
  const theme = themeState.theme;
  void guardPush(Navigation.push(componentId, {
    component: {
      name: DOWNLOAD_MANAGER_SCREEN,
      options: {
        topBar: {
          visible: false,
          height: 0,
        },
        statusBar: {
          drawBehind: true,
          visible: true,
          style: getStatusBarStyle(theme.isDark),
          backgroundColor: 'transparent',
        },
        layout: {
          orientation: ['portrait', 'landscape'],
          componentBackgroundColor: theme['c-content-background'],
                  fitSystemWindows: false,
        },
        animations: {
          push: {
            content: {
              translationX: {
                from: windowSizeTools.getSize().width,
                to: 0,
                duration: 200,
              },
            },
          },
          pop: {
            content: {
              translationX: {
                from: 0,
                to: windowSizeTools.getSize().width,
                duration: 200,
              },
            },
          },
        },
      },
    },
  }),
    COMPONENT_IDS.DOWNLOAD_MANAGER)
}



export function pushSimilarSongsScreen(componentId: string, similarSongs: LX.Music.MusicInfoOnline[]) {
  if (!startPush(COMPONENT_IDS.SIMILAR_SONGS_SCREEN)) return
  const theme = themeState.theme
  void guardPush(Navigation.push(componentId, {
    component: {
      name: SIMILAR_SONGS_SCREEN,
      passProps: {
        similarSongs,
      },
      options: {
        topBar: {
          visible: false,
          height: 0,
        },
        statusBar: {
          drawBehind: true,
          visible: true,
          style: getStatusBarStyle(theme.isDark),
          backgroundColor: 'transparent',
        },
        layout: {
          orientation: ['portrait', 'landscape'],
          componentBackgroundColor: theme['c-content-background'],
                  fitSystemWindows: false,
        },
        animations: {
          push: {
            content: {
              translationX: {
                from: windowSizeTools.getSize().width,
                to: 0,
                duration: 200,
              },
            },
          },
          pop: {
            content: {
              translationX: {
                from: 0,
                to: windowSizeTools.getSize().width,
                duration: 200,
              },
            },
          },
        },
      },
    },
  }),
    COMPONENT_IDS.SIMILAR_SONGS_SCREEN)
}
