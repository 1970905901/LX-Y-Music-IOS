import { useNavActiveId } from '@/store/common/hook'
import Header from './Header'
import Main from './Main'
import ModernTabBar from '@/components/layout/ModernTabBar'

const PAGE_OWNED_HEADER_IDS = new Set([
  'nav_discovery',
  'nav_play_history',
  'nav_songlist',
  'nav_search',
  'nav_love',
  'nav_setting',
  // 排行榜页接管页头：大标题与当前榜单名同行展示
  'nav_top',
  // 三大平台每日推荐接管页头：大标题与 tab 切换同行展示
  'nav_daily_rec',
  'nav_tx_daily_rec',
  'nav_kg_daily_rec',
  // 三大平台歌单页接管页头：大标题与 tab 切换同行展示
  'nav_my_playlist',
  'nav_tx_playlist',
  'nav_kg_playlist',
])

const Content = () => {
  const activeNavId = useNavActiveId()

  return (
    <>
      {PAGE_OWNED_HEADER_IDS.has(activeNavId) ? null : <Header />}
      <Main />
      <ModernTabBar />
    </>
  )
}

export default Content
