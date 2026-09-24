import { View } from 'react-native'
import PlayerBar from '@/components/player/PlayerBar'
import StatusBar from '@/components/common/StatusBar'
import Header from './Header'
import Main from './Main'
import ModernTabBar from '@/components/layout/ModernTabBar'
import { createStyle } from '@/utils/tools'

const styles = createStyle({
  container: {
    flex: 1,
  },
  bodyWrap: {
    flex: 1,
    overflow: 'hidden',
  },
})

export default ({ componentId }: { componentId: string }) => {
  return (
    <>
      <StatusBar />
      <View style={styles.container}>
        <View style={styles.bodyWrap}>
          <Header />
          <Main />
        </View>
        <ModernTabBar />
        <PlayerBar componentId={componentId} isHome />
      </View>
    </>
  )
}
