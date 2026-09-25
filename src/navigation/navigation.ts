import { Navigation } from 'react-native-navigation'


import {
  HOME_SCREEN,
  PLAY_DETAIL_SCREEN,
  SONGLIST_DETAIL_SCREEN,
  SIMILAR_SONGS_SCREEN,
  COMMENT_SCREEN, ARTIST_DETAIL_SCREEN, ALBUM_DETAIL_SCREEN, DOWNLOAD_MANAGER_SCREEN,
  SETTING_DETAIL_SCREEN,
} from './screenNames'

import themeState from '@/store/theme/state'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import commonState from '@/store/common/state'
import commonActions from '@/store/common/action'
import { NAV_SHEAR_NATIVE_IDS, COMPONENT_IDS } from '@/config/constant'
import { getStatusBarStyle } from './utils'
import { type ListInfoItem } from '@/store/songlist/state'

// const store = getStore()
// const getTheme = () => getter('common', 'theme')(store.getState())


// 集中管理各界面 push 的进行中状态，防止快速重复点击/滑动导致界面卡死。
const pendingPushes = new Set<string>()
const isTopScreen = (id: COMPONENT_IDS) => {
  const ids = commonState.componentIds
  return ids.length > 0 && ids[ids.length - 1]?.name === id
}
interface StartPushOptions {
  /** 允许顶层已是同类型页面时再次 push（如歌手详情互跳） */
  allowSameTop?: boolean
  /**
   * 顶层残留自愈：pop 事件丢失（转场被取消等）会让账本里残留“详情页在栈顶”的
   * 记录，此后用户在列表页点击会因 isTopScreen 命中而被静默吞掉（点了没反应）。
   * 开启后：命中同类型顶层时视为账本残留，清掉该条目并放行 push。
   * 仅用于“从列表页进入详情页”的场景——用户能点到列表，说明详情页必然不在栈顶。
   */
  recoverStaleTop?: boolean
}
const startPush = (id: COMPONENT_IDS, options: StartPushOptions = {}) => {
  if (pendingPushes.has(id)) return false
  if (isTopScreen(id)) {
    if (!options.allowSameTop && !options.recoverStaleTop) return false
    const ids = commonState.componentIds
    const stale = ids[ids.length - 1]
    if (stale) commonActions.removeComponentId(stale.id)
  }
  pendingPushes.add(id)
  // 安全兜底：即使 push 的 Promise 始终不结算（如 RNN 返回 undefined 或原生转场挂起），
  // 也确保锁最终释放，避免界面永久卡死只能重启。
  setTimeout(() => { endPush(id) }, 800)
  return true
}
const endPush = (id: COMPONENT_IDS) => { pendingPushes.delete(id) }
// pop 完成（返回按钮/系统返回）时统一处理：清账本条目 + 立即释放该类型页面的
// push 锁。pop 已完成即不存在进行中的同名 push；若不释放，用户“返回后立刻
// 再点同一入口”会在 800ms 兜底锁窗口内被静默吞掉（表现为点了没反应）。
export const handleScreenPopped = (componentId: string) => {
  const target = commonState.componentIds.find(item => item.id === componentId)
  commonActions.removeComponentId(componentId)
  if (target) endPush(target.name)
}
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
export function pushPlayDetailScreen(componentId: string) {
  if (!startPush(COMPONENT_IDS.playDetail)) return
  // 未载入任何歌曲时不打开播放详情页，避免空状态导致卡死
  if (!playerState.playMusicInfo.musicInfo) {
    endPush(COMPONENT_IDS.playDetail)
    return
  }
  requestAnimationFrame(() => {
    const theme = themeState.theme
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
          // 不配置 animations，走系统默认转场。RNN iOS 自定义转场依赖 uiManagerDidPerformMounting
          // 时序启动、被取消时永不回调 completeTransition：JS 空闲（未播放音乐）时 push 整栈卡死，
          // 转场期间被再次导航打断同样卡死。全 app 的 push/pop 统一禁用自定义转场。
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
          // 不配置 animations，走系统默认转场：自定义转场在 JS 空闲/被打断时会让整栈卡死
          //（详见 pushPlayDetailScreen 注释）。共享元素转场一并移除，封面 nativeID 保留无害。
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
          // 走系统默认转场，原因见 pushPlayDetailScreen 注释
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
  if (!startPush(COMPONENT_IDS.ARTIST_DETAIL, { allowSameTop: true })) return
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
        // 走系统默认转场，原因见 pushPlayDetailScreen 注释
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
        // 走系统默认转场，原因见 pushPlayDetailScreen 注释
      },
    },
  }),
    COMPONENT_IDS.ALBUM_DETAIL_SCREEN)
}

export function pushSettingDetailScreen(componentId: string, settingId: string) {
  if (!startPush(COMPONENT_IDS.SETTING_DETAIL, { recoverStaleTop: true })) return
  const theme = themeState.theme
  // 原生转场背景色需与页面实际背景一致，否则 push 转场瞬间颜色跳变（闪屏），
  // 判定方式与 pushPlayDetailScreen 一致：无背景图时页面实际是 c-main-background。
  const hasBgPic = !!(commonState.bgPic || settingState.setting['theme.customBgPicPath'])
  const componentBackgroundColor = hasBgPic ? theme['c-content-background'] : theme['c-main-background']
  void guardPush(Navigation.push(componentId, {
    component: {
      name: SETTING_DETAIL_SCREEN,
      passProps: {
        settingId,
      },
      options: {
        topBar: {
          visible: false,
          height: 0,
        },
        // 关闭侧滑返回：边缘滑动会打断转场，RNN iOS 自定义转场被取消时
        // 不回调 completeTransition，整个导航栈会失去交互（卡死）。
        gestureEnabled: false,
        statusBar: {
          drawBehind: true,
          visible: true,
          style: getStatusBarStyle(theme.isDark),
          backgroundColor: 'transparent',
        },
        layout: {
          orientation: ['portrait', 'landscape'],
          componentBackgroundColor,
          fitSystemWindows: false,
        },
        // 不配置 animations，走系统默认转场：RNN iOS 的自定义转场（ScreenAnimationController）
        // 依赖 uiManagerDidPerformMounting 时序、且被打断时永不调用 completeTransition，
        // 设置页高频进出极易触发整栈卡死。系统默认转场由 UIKit 处理打断，无此问题。
      },
    },
  }), COMPONENT_IDS.SETTING_DETAIL)
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
        // 走系统默认转场，原因见 pushPlayDetailScreen 注释
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
        // 走系统默认转场，原因见 pushPlayDetailScreen 注释
      },
    },
  }),
    COMPONENT_IDS.SIMILAR_SONGS_SCREEN)
}
