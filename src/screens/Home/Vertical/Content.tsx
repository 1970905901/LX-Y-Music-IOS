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
