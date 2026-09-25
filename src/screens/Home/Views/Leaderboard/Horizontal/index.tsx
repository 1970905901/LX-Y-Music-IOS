import { useCallback, useEffect, useRef } from 'react'
import { View } from 'react-native'
import { createStyle } from '@/utils/tools'

import MusicList, { type MusicListType } from '../MusicList'
import HeaderBar, { type HeaderBarType } from '../Vertical/HeaderBar'
import { getLeaderboardSetting, saveLeaderboardSetting } from '@/utils/data'
import { getBoardsList } from '@/core/leaderboard'
import { setNavActiveId } from '@/core/common'
import PageTopInset from '@/components/common/PageTopInset'
import SwipeBackArea from '@/components/common/SwipeBackArea'

// 横屏排行榜页：平台切换与榜单选择已由推荐页的排行榜区块承担，
// 页头为「排行榜」大标题 + 当前榜单名（与竖屏一致），歌曲列表铺满展示。
export default () => {
  const musicListRef = useRef<MusicListType>(null)
  const headerBarRef = useRef<HeaderBarType>(null)
  const handleBackToDiscovery = useCallback(() => {
    setNavActiveId('nav_discovery')
  }, [])

  useEffect(() => {
    void getLeaderboardSetting().then(({ source, boardId }) => {
      void getBoardsList(source).then((list) => {
        const bound = list.find((l) => l.id == boardId)
        headerBarRef.current?.setBound(source, boardId, bound?.name ?? 'Unknown')
      })
      musicListRef.current?.loadList(source, boardId)
    })

    // 推荐页排行榜区块点卡片进入：页面已挂载时（切页不卸载）由事件实时切到目标榜单；
    // 未挂载时错过事件，由上方 getLeaderboardSetting 读取的持久化设置兜底。
    const handleShowBoard = ({ source, boardId }: { source: LX.OnlineSource, boardId: string }) => {
      void getBoardsList(source).then((list) => {
        const bound = list.find((l) => l.id == boardId)
        headerBarRef.current?.setBound(source, boardId, bound?.name ?? 'Unknown')
      })
      musicListRef.current?.loadList(source, boardId)
      void saveLeaderboardSetting({ source, boardId })
    }
    global.app_event.on('showBoardDetail', handleShowBoard)

    return () => {
      global.app_event.off('showBoardDetail', handleShowBoard)
    }
  }, [])

  return (
    <View style={styles.container}>
      <MusicList
        ref={musicListRef}
        header={
          <>
            <PageTopInset />
            <HeaderBar ref={headerBarRef} />
          </>
        }
      />
      <SwipeBackArea onBack={handleBackToDiscovery} />
    </View>
  )
}

const styles = createStyle({
  container: {
    width: '100%',
    flex: 1,
  },
})
