import { View } from 'react-native'
import Content from './Content'
import PlayerBar from '@/components/player/PlayerBar'
import commonState from '@/store/common/state'

export default ({ componentId }: { componentId: string }) => {
  return (
    // 外层 flex:1 容器作为 PlayerBar 绝对定位的参照系，
    // 让胶囊能稳定浮在屏幕底部、不挤压 Content 高度。
    <View style={{ flex: 1 }}>
      <Content />
      <PlayerBar componentId={commonState.componentIds[commonState.componentIds.length - 1]?.id!} isHome />
    </View>
  )
}
