import { View } from 'react-native'
import Aside from './Aside'
import PlayerBar from '@/components/player/PlayerBar'
import StatusBar from '@/components/common/StatusBar'
import Header from './Header'

import Main from './Main'
import { createStyle } from '@/utils/tools'

const styles = createStyle({
  container: {
    flex: 1,
    flexDirection: 'row',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
  },
  bodyWrap: {
    flex: 1,
  },
})

export default ({ componentId }: { componentId: string }) => {
  return (
    <>
      <StatusBar />
      <View style={styles.container}>
        <Aside />
        <View style={styles.content}>
          <Header />
          <View style={styles.bodyWrap}>
            <Main />
          </View>
        </View>
        {/* 迷你播放器移到 container 层：横屏下满宽悬浮在屏幕底部，横跨左栏导航 + 右栏内容 */}
        <PlayerBar componentId={componentId} isHome />
      </View>
    </>
  )
}
