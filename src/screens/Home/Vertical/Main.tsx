import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import {Keyboard, View} from 'react-native'
import Search from '../Views/Search'
import SongList from '../Views/SongList'
import Mylist from '../Views/Mylist'
import Leaderboard from '../Views/Leaderboard'
import Setting from '../Views/Setting'
import commonState, { type InitState as CommonState } from '@/store/common/state'
import { createStyle } from '@/utils/tools'
import PagerView, {
  type PageScrollStateChangedNativeEvent,
  type PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view'
import { setNavActiveId } from '@/core/common'
import settingState from '@/store/setting/state'
import DailyRec from '../Views/DailyRec'
import TXDailyRec from '../Views/DailyRec/TXDailyRec'
import MyPlaylist from '../Views/MyPlaylist'
import FollowedArtists from '../Views/FollowedArtists'
import SubscribedAlbums from '../Views/SubscribedAlbums';
import {NAV_MENUS, NAV_GROUPS, type NAV_ID_Type, getEffectiveFlatOrder} from "@/config/constant.ts";
import {useSettingValue} from "@/store/setting/hook.ts";
import PlayHistory from '../Views/PlayHistory'
import { useTheme } from '@/store/theme/hook'
import OneDrive from '../Views/OneDrive'
import WebDAV from '../Views/WebDAV'

import LocalDownload from '../Views/LocalDownload'
import TXPlaylist from '../Views/TxPlaylist'
import KgPlaylist from '../Views/KgPlaylist'
import KgDailyRec from '../Views/KgDailyRec'

const hideKeys = ['list.isShowAlbumName', 'list.isShowInterval'] as Readonly<
  Array<keyof LX.AppSetting>
>

const SearchPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_search')
  const component = useMemo(() => <Search />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_search') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.off('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}
const SongListPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_songlist')
  const component = useMemo(() => <SongList />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_songlist') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.on('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
  // return activeId == 1 || activeId == 0  ? SongList : null
}
const PlayHistoryOverlay = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_play_history')
  const component = useMemo(() => <PlayHistory />, [])
  const theme = useTheme()
  useEffect(() => {
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      requestAnimationFrame(() => {
        setVisible(id == 'nav_play_history')
      })
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
    }
  }, [])

  return visible ? (
    <View style={{ ...styles.historyOverlay, backgroundColor: theme['c-content-background'] }}>
      {component}
    </View>
  ) : null
}

const isMenuVisible = (id: NAV_ID_Type, navStatus: Partial<Record<NAV_ID_Type, boolean>>) => (
  id !== 'nav_play_history' && (id === 'nav_setting' || (navStatus[id] ?? true))
)
const LeaderboardPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_top')
  const component = useMemo(() => <Leaderboard />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_top') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.on('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}

const DailyRecPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_daily_rec')
  const component = useMemo(() => <DailyRec />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_daily_rec') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.on('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}

const TXDailyRecPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_tx_daily_rec')
  const component = useMemo(() => <TXDailyRec />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_tx_daily_rec') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.on('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}

const MylistPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_love')
  const component = useMemo(() => <Mylist />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_love') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.on('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}

const MyPlaylistPage = () => {
    const [visible, setVisible] = useState(commonState.navActiveId == 'nav_my_playlist')
    const component = useMemo(() => <MyPlaylist />, [])
    useEffect(() => {
        let currentId: CommonState['navActiveId'] = commonState.navActiveId
          const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
            currentId = id
              if (id == 'nav_my_playlist') {
                requestAnimationFrame(() => {
                    setVisible(true)
                  })
              }
          }
        const handleHide = () => {
            if (currentId != 'nav_setting') return
            setVisible(false)
          }
        const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
            if (keys.some((k) => hideKeys.includes(k))) handleHide()
          }
        global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
        global.state_event.on('themeUpdated', handleHide)
        global.state_event.on('languageChanged', handleHide)
        global.state_event.on('configUpdated', handleConfigUpdated)

        return () => {
            global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
            global.state_event.off('themeUpdated', handleHide)
            global.state_event.off('languageChanged', handleHide)
            global.state_event.on('configUpdated', handleConfigUpdated)
          }
      }, [])

  return visible ? component : null
}

const FollowedArtistsPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_followed_artists')
  const component = useMemo(() => <FollowedArtists />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_followed_artists') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.on('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}

const SubscribedAlbumsPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_subscribed_albums');
  const component = useMemo(() => <SubscribedAlbums />, []);
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId;
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id;
      if (id == 'nav_subscribed_albums') {
        requestAnimationFrame(() => {
          setVisible(true);
        });
      }
    };
    const handleHide = () => {
      if (currentId != 'nav_setting') return;
      setVisible(false);
    };
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.on('configUpdated', handleConfigUpdated)
    }
  }, []);
  return visible ? component : null;
};

const OneDrivePage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_onedrive')
  const component = useMemo(() => <OneDrive />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_onedrive') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.off('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}

const WebDAVPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_webdav')
  const component = useMemo(() => <WebDAV />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_webdav') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.off('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}

const LocalDownloadPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_local_download')
  const component = useMemo(() => <LocalDownload />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_local_download') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.off('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}

const TXPlaylistPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_tx_playlist')
  const component = useMemo(() => <TXPlaylist />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_tx_playlist') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.off('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}

const KgPlaylistPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_kg_playlist')
  const component = useMemo(() => <KgPlaylist />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_kg_playlist') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.off('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}

const KgDailyRecPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_kg_daily_rec')
  const component = useMemo(() => <KgDailyRec />, [])
  useEffect(() => {
    let currentId: CommonState['navActiveId'] = commonState.navActiveId
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      currentId = id
      if (id == 'nav_kg_daily_rec') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    const handleHide = () => {
      if (currentId != 'nav_setting') return
      setVisible(false)
    }
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.some((k) => hideKeys.includes(k))) handleHide()
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    global.state_event.on('themeUpdated', handleHide)
    global.state_event.on('languageChanged', handleHide)
    global.state_event.on('configUpdated', handleConfigUpdated)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
      global.state_event.off('themeUpdated', handleHide)
      global.state_event.off('languageChanged', handleHide)
      global.state_event.off('configUpdated', handleConfigUpdated)
    }
  }, [])

  return visible ? component : null
}

const SettingPage = () => {
  const [visible, setVisible] = useState(commonState.navActiveId == 'nav_setting')
  const component = useMemo(() => <Setting />, [])
  useEffect(() => {
    const handleNavIdUpdate = (id: CommonState['navActiveId']) => {
      if (id == 'nav_setting') {
        requestAnimationFrame(() => {
          setVisible(true)
        })
      }
    }
    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)

    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
    }
  }, [])
  return visible ? component : null
}

const Main = () => {
  const pagerViewRef = useRef<ComponentRef<typeof PagerView>>(null);
  const [activeNavId, setActiveNavIdState] = useState(commonState.navActiveId)
  const navStatus = useSettingValue('common.navStatus');
  const navOrder = useSettingValue('common.navOrder');
  const navFlatOrder = useSettingValue('common.navFlatOrder');
  const navGroupEnabled = useSettingValue('common.navGroupEnabled');

  // 与侧边栏（DrawerNav）保持同一套“有效顺序”，否则二者不一致时点击侧边栏项会跳错页面。
  // 分组开启用 navOrder；否则优先用用户在“侧边栏导航”里自定义过的扁平顺序 navFlatOrder，
  // 都没有再回退 navOrder。
  // 注意：分组开启时 DrawerNav 会通过 NAV_GROUPS 显示 group children（如云盘下的 OneDrive/WebDAV），
  // 如果老用户的 navOrder 里缺少这些子项，必须补进 PagerView 页面列表，否则点击会 fallback 到第一页。
  const effectiveOrder = useMemo(() => {
    if (!navGroupEnabled) return getEffectiveFlatOrder(navFlatOrder, navOrder);
    const allMenuIds = NAV_MENUS.map(m => m.id)
    // 过滤已废弃的菜单 id，避免老用户持久化顺序里的残留项渲染成未知页面
    const baseOrder = (navOrder || []).filter((id: string) => allMenuIds.includes(id)) as NAV_ID_Type[];
    const groupChildIds = NAV_GROUPS.flatMap(g => g.children) as NAV_ID_Type[];
    const missing = groupChildIds.filter(id => !baseOrder.includes(id));
    return missing.length ? [...baseOrder, ...missing] : baseOrder;
  }, [navGroupEnabled, navFlatOrder, navOrder]);

  const visibleNavs = useMemo(() => {
    return effectiveOrder.filter((id: NAV_ID_Type) => isMenuVisible(id, navStatus)).map((id: NAV_ID_Type) => {
      const menuInfo = NAV_MENUS.find(menu => menu.id === id);
      return menuInfo || { id, icon: 'unknown' };
    });
  }, [navStatus, effectiveOrder]);

  const { viewMap, indexMap } = useMemo(() => {
    const viewMap: Partial<Record<NAV_ID_Type, number>> = {};
    const indexMap: NAV_ID_Type[] = [];
    visibleNavs.forEach((nav: { id: NAV_ID_Type }, index: number) => {
      viewMap[nav.id] = index;
      indexMap.push(nav.id);
    });
    return { viewMap, indexMap };
  }, [visibleNavs]);

  const getInitialIndex = () => {
    let idx = viewMap[commonState.navActiveId];
    if (idx == null && visibleNavs.length > 0) {
      idx = 0;
    }
    return idx ?? 0;
  };
  const activeIndexRef = useRef(getInitialIndex());
  // 页面集（id + 顺序）签名：分组开关 / 侧边栏显隐变化时会改变页面集合。
  // iOS 上对运行中的 PagerView 原位重排子页面并立即 setPage，存在原生侧
  // “index out of bounds” 崩溃（release 下表现为整个 App 白屏）。用 key 让
  // 页面集变化时整体重建 PagerView 实例，initialPage 直接落到当前页，彻底避开该竞争。
  const pagerKey = useMemo(() => `${navGroupEnabled ? 'g' : 'f'}|${visibleNavs.map(n => n.id).join('|')}`, [visibleNavs, navGroupEnabled]);
  // remount 时的初始页：以当前导航 id 在新顺序中的位置为准
  const initialPageIndex = useMemo(() => viewMap[commonState.navActiveId] ?? 0, [viewMap]);

  const onPageSelected = useCallback(({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    activeIndexRef.current = nativeEvent.position;
    const selectedId = indexMap[activeIndexRef.current]
    if (!selectedId) return
    if (selectedId) setActiveNavIdState(selectedId)
    // 播放历史是抽屉底部入口调起的全屏浮层，不属于 PagerView 页面；
    // 用户 swipe 切页时不应把它覆盖回我的列表。
    if (commonState.navActiveId !== 'nav_play_history' && activeIndexRef.current !== viewMap[commonState.navActiveId]) {
      setNavActiveId(selectedId);
    }
  }, [indexMap, viewMap]);

  const onPageScrollStateChanged = useCallback(
    ({ nativeEvent }: PageScrollStateChangedNativeEvent) => {
      Keyboard.dismiss();
      const idle = nativeEvent.pageScrollState == 'idle';
      if (global.lx.homePagerIdle != idle) global.lx.homePagerIdle = idle;
    },
    []
  );

  useEffect(() => {
    // 播放历史是浮层，不是 PagerView 的页面；visibleNavs 变化时不要把它重置到第一页
    if (commonState.navActiveId === 'nav_play_history') return
    let index = viewMap[commonState.navActiveId];
    if (index == null && visibleNavs.length > 0) {
      index = 0;
      activeIndexRef.current = index;
      if (visibleNavs[0]) {
        setNavActiveId(visibleNavs[0].id);
      }
    } else if (index != null) {
      // 防御：索引必须在当前页面集范围内，避免对原生 pager 下发越界页码
      if (index >= visibleNavs.length) return
      activeIndexRef.current = index;
      pagerViewRef.current?.setPageWithoutAnimation(index);
    }
  }, [viewMap, visibleNavs]);

  useEffect(() => {
    const handleConfigUpdated = (keys: Array<keyof LX.AppSetting>) => {
      if (keys.includes('common.navStatus')) {
        // 播放历史是浮层，不在可见菜单列表里，但不应被导航状态变更重置
        if (commonState.navActiveId === 'nav_play_history') return
        const isActiveVisible = isMenuVisible(commonState.navActiveId, navStatus);
        if (!isActiveVisible && visibleNavs.length > 0) {
          setNavActiveId(visibleNavs[0].id);
        }
      }
    };
    global.state_event.on('configUpdated', handleConfigUpdated);
    return () => {
      global.state_event.off('configUpdated', handleConfigUpdated);
    };
  }, [navStatus, visibleNavs]);

  useEffect(() => {
    const handleUpdate = (id: CommonState['navActiveId']) => {
      setActiveNavIdState(id)
      pagerViewRef.current?.setScrollEnabled(!!settingState.setting['common.homePageScroll'] && id !== 'nav_play_history');
      // 播放历史是浮层，切到它时不要同步 PagerView 页面，否则 setPageWithoutAnimation(0)
      // 会触发 onPageSelected，进而把 navActiveId 又覆盖成我的列表。
      if (id === 'nav_play_history') return
      let index = viewMap[id];
      if (index == null && visibleNavs.length > 0) {
        index = 0;
      }
      // 防御：索引必须在当前页面集范围内，避免对原生 pager 下发越界页码
      if (index != null && index < visibleNavs.length && activeIndexRef.current !== index) {
        activeIndexRef.current = index;
        pagerViewRef.current?.setPageWithoutAnimation(index);
      }
    };
    const handleConfigUpdate = (
      keys: Array<keyof LX.AppSetting>,
      setting: Partial<LX.AppSetting>
    ) => {
      if (!keys.includes('common.homePageScroll')) return;
      const activeId = commonState.navActiveId;
      pagerViewRef.current?.setScrollEnabled(!!settingState.setting['common.homePageScroll'] && activeId !== 'nav_play_history');
    };

    global.state_event.on('navActiveIdUpdated', handleUpdate);
    global.state_event.on('configUpdated', handleConfigUpdate);
    return () => {
      global.state_event.off('navActiveIdUpdated', handleUpdate);
      global.state_event.off('configUpdated', handleConfigUpdate);
    };
  }, [viewMap, visibleNavs]);

  const pages = useMemo(() => {
    const pageComponents: Partial<Record<NAV_ID_Type, ReactNode>> = {
      nav_search: <SearchPage />,
      nav_songlist: <SongListPage />,
      nav_top: <LeaderboardPage />,
      nav_love: <MylistPage />,
      nav_daily_rec: <DailyRecPage />,
      nav_tx_daily_rec: <TXDailyRecPage />,
      nav_followed_artists: <FollowedArtistsPage />,
      nav_subscribed_albums: <SubscribedAlbumsPage />,
      nav_my_playlist: <MyPlaylistPage />,
      nav_onedrive: <OneDrivePage />,
      nav_webdav: <WebDAVPage />,
      nav_local_download: <LocalDownloadPage />,
      nav_tx_playlist: <TXPlaylistPage />,
      nav_kg_playlist: <KgPlaylistPage />,
      nav_kg_daily_rec: <KgDailyRecPage />,
      nav_setting: <SettingPage />,
    };

    return visibleNavs.map((nav: { id: NAV_ID_Type }) => (
      <View collapsable={false} key={nav.id} style={styles.pageStyle}>
        {pageComponents[nav.id] ?? null}
      </View>
    ));
  }, [visibleNavs]);

  return (
    <View style={styles.container}>
      <PagerView
        key={pagerKey}
        ref={pagerViewRef}
        initialPage={initialPageIndex}
        offscreenPageLimit={1}
        onPageSelected={onPageSelected}
        onPageScrollStateChanged={onPageScrollStateChanged}
        scrollEnabled={settingState.setting['common.homePageScroll'] && activeNavId !== 'nav_play_history'}
        style={styles.pagerView}
      >
        {pages}
      </PagerView>
      <PlayHistoryOverlay />
    </View>
  );
};

const styles = createStyle({
  container: {
    flex: 1,
  },
  pagerView: {
    flex: 1,
    overflow: 'hidden',
  },
  historyOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
    // iOS-only 项目，移除 Android 专属的 elevation，避免 iOS 侧样式/层级歧义
  },
  pageStyle: {
    // alignItems: 'center',
    // padding: 20,
  },
})

export default Main
