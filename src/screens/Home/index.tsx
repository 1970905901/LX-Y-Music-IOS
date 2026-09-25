import {useCallback, useEffect, useRef, useState} from 'react'
import { useHorizontalMode } from '@/utils/hooks'
import PageContent from '@/components/PageContent'
import {setComponentId, setNavActiveId} from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import { usePageVisible } from '@/store/common/hook'
import Vertical from './Vertical'
import Horizontal from './Horizontal'
import { navigations } from '@/navigation'
import ArtistSelectorManager from '@/components/ArtistSelectorManager'
import settingState from '@/store/setting/state'
import {useI18n} from "@/lang";
import {BackHandler} from "react-native";
import {toast} from "@/utils/tools.ts";
import commonState from '@/store/common/state'
import {useBackHandler} from "@/utils/hooks/useBackHandler.ts";

import { setSearchText as setSearchState } from '@/core/search/search'
import DownloadBall from "@/components/DownloadBall";
import YouTubeLoginManager from "@/components/YouTubeLoginManager.tsx";
import VideoPlayerManager from "@/components/VideoPlayerManager.tsx";
interface Props {
  componentId: string
}

// Home 的 MV 播放器宿主：仅在 Home 页面在窗口上时启用。
// Home 被 push 的页面（播放详情等）覆盖后视图树脱离窗口，present 无法执行；
// 且禁用后其隐藏的 1x1 Video 不会抢载 MV 源，避免与窗口内实例出现双声道。
const HomeVideoPlayerManager = () => {
  const [visible, setVisible] = useState(true)
  usePageVisible([COMPONENT_IDS.home], useCallback((v) => { setVisible(v) }, []))
  return <VideoPlayerManager enabled={visible} />
}

export default ({ componentId }: Props) => {
  const isHorizontalMode = useHorizontalMode()
  const t = useI18n()
  const lastBackPressed = useRef(0)
  useEffect(() => {
    setComponentId(COMPONENT_IDS.home, componentId)

    if (settingState.setting['player.startupPushPlayDetailScreen']) {
      navigations.pushPlayDetailScreen(componentId)
    }

    const handleGlobalSearch = (text: string) => {
      setSearchState(text)
      setNavActiveId('nav_search')
    }

    global.app_event.on('triggerSearch', handleGlobalSearch)

    return () => {
      global.app_event.off('triggerSearch', handleGlobalSearch)
    }

  }, [componentId])

  useBackHandler(
    useCallback(() => {
      if (commonState.componentIds.length > 1) {
        return false;
      }

      if (commonState.navActiveId === 'nav_setting') {
        return false
      }

      if (commonState.navActiveId === 'nav_play_history') {
        setNavActiveId(commonState.lastNavActiveId)
        return true
      }

      const now = Date.now()
      if (lastBackPressed.current && now - lastBackPressed.current < 2000) {
        BackHandler.exitApp()
        return true
      }

      lastBackPressed.current = now
      toast(t('exit_app_tip_double_press'))
      return true
    }, [t])
  )

  return (
    <>
      <PageContent>{isHorizontalMode ? <Horizontal componentId={componentId} /> : <Vertical componentId={componentId} />}</PageContent>
      <ArtistSelectorManager />
      {/* 网易/QQ/酷狗登录弹窗管理器已迁至 SettingDetail：RN Modal 仅在其宿主视图
          挂在窗口上时才会呈现（RCTModalHostView 的 shouldBePresented 检查 self.window），
          Home 被 push 的原生页面覆盖后视图树脱离窗口，挂在 Home 里的弹窗永远无法呈现，
          表现为设置详情页里的登录按钮点了没反应。 */}
      {/*<YouTubeLoginManager />*/}
      <HomeVideoPlayerManager />
      <DownloadBall />
    </>
  )}
