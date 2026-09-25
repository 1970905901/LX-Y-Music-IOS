import { View } from 'react-native'
import PlayerBar from '@/components/player/PlayerBar'
import StatusBar from '@/components/common/StatusBar'
import Header from './Header'
import Main from './Main'
import ModernTabBar from '@/components/layout/ModernTabBar'
import { createStyle } from '@/utils/tools'
import { useNavActiveId } from '@/store/common/hook'

const styles = createStyle({
  container: {
    flex: 1,
  },
  bodyWrap: {
    flex: 1,
    overflow: 'hidden',
  },
})

const PAGE_OWNED_HEADER_IDS = new Set([
  'nav_discovery',
  'nav_play_history',
  'nav_songlist',
  'nav_search',
  'nav_love',
  'nav_setting',
  // 排行榜页接管页头：大标题与当前榜单名同行展示
  'nav_top',
])

export default ({ componentId }: { componentId: string }) => {
  const activeNavId = useNavActiveId()

  return (
    <>
      <StatusBar />
      <View style={styles.container}>
        <View style={styles.bodyWrap}>
          {PAGE_OWNED_HEADER_IDS.has(activeNavId) ? null : <Header />}
          <Main />
        </View>
        <ModernTabBar />
        <PlayerBar componentId={componentId} isHome />
      </View>
    </>
  )
}
