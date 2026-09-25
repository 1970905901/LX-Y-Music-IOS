import { useEffect } from 'react'

import { useHorizontalMode } from '@/utils/hooks'

import Vertical from './Vertical'
import Horizontal from './Horizontal'
import PageContent from '@/components/PageContent'
import StatusBar from '@/components/common/StatusBar'
import VideoPlayerManager from '@/components/VideoPlayerManager'
import { setComponentId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'

export default ({ componentId }: { componentId: string }) => {
  const isHorizontalMode = useHorizontalMode()

  useEffect(() => {
    setComponentId(COMPONENT_IDS.playDetail, componentId)
  }, [])

  return (
    <PageContent backgroundFadeIn>
      <StatusBar />
      {isHorizontalMode ? (
        <Horizontal componentId={componentId} />
      ) : (
        <Vertical componentId={componentId} />
      )}
      {/* MV 播放器宿主：播放详情页是 push 的原生页面，Home 被覆盖后脱离窗口，
          其上的 VideoPlayerManager 无法 presentFullscreenPlayer（点播放MV无反应），
          必须在窗口内的本页面再挂一份 */}
      <VideoPlayerManager />
    </PageContent>
  )
}
