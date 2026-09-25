import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { createStyle } from '@/utils/tools'

import MusicList, { type MusicListType } from '../MusicList'
import { getLeaderboardSetting, saveLeaderboardSetting } from '@/utils/data'
import PageTopInset from '@/components/common/PageTopInset'

// 横屏排行榜页：平台切换与榜单选择已由推荐页的排行榜区块承担，
// 原左侧边栏（LeftBar：平台下拉 + 榜单分组列表）已移除，铺满展示当前榜单歌曲。
export default () => {
  const musicListRef = useRef<MusicListType>(null)

  useEffect(() => {
    void getLeaderboardSetting().then(({ source, boardId }) => {
      musicListRef.current?.loadList(source, boardId)
    })

    // 推荐页排行榜区块点卡片进入：页面已挂载时（切页不卸载）由事件实时切到目标榜单；
    // 未挂载时错过事件，由上方 getLeaderboardSetting 读取的持久化设置兜底。
    const handleShowBoard = ({ source, boardId }: { source: LX.OnlineSource, boardId: string }) => {
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
      <MusicList ref={musicListRef} header={<PageTopInset />} />
    </View>
  )
}

const styles = createStyle({
  container: {
    width: '100%',
    flex: 1,
  },
})
