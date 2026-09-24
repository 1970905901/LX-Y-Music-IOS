import { useNavActiveId } from '@/store/common/hook'
import Header from './Header'
import Main from './Main'
import ModernTabBar from '@/components/layout/ModernTabBar'

const Content = () => {
  const activeNavId = useNavActiveId()

  return (
    <>
      {activeNavId === 'nav_discovery' || activeNavId === 'nav_play_history' ? null : <Header />}
      <Main />
      <ModernTabBar />
    </>
  )
}

export default Content
